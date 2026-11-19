import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, Provider } from '@prisma/client';
import { cfg } from '../common/config';
import { notFound, unavailable } from '../common/errors';
import { FlagsService } from '../control-plane/control-plane-public';
import { KiorlyClient, KiorlyHttpError, KiorlyTransientError } from '../kiorly/kiorly-public';
import { MarketService } from '../market/market-public';
import { PrismaService } from '../prisma/prisma.service';
import { detectEmergency, EMERGENCY_GUIDANCE, isSpecialtyCode, mapSymptomToSpecialties, normalizeText, SPECIALTY_CODES, SPECIALTY_LABELS } from '../safety/safety-public';
import { mapProviderDto } from './provider-mapper';

export interface SearchParams {
  q?: string; specialty?: string; governorate?: string; area?: string; minFee?: number; maxFee?: number; gender?: string; language?: string; minRating?: number;
  acceptsDeposit?: boolean; nextAvailable?: 'today' | 'tomorrow' | 'week'; sort?: 'earliest' | 'distance' | 'rating' | 'fee'; lat?: number; lng?: number; maxDistanceKm?: number; page?: number; pageSize?: number;
}
export interface Slot { startsAt: string; endsAt: string }
const SYNC_CURSOR = 'catalog.sync.cursor';

@Injectable()
export class CatalogService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('catalog');
  private slotCache = new Map<string, { at: number; slots: Slot[] }>();
  private timer?: NodeJS.Timeout;
  constructor(private readonly prisma: PrismaService, private readonly kiorly: KiorlyClient, private readonly flags: FlagsService, private readonly markets: MarketService) {}

  onModuleInit() {
    if (!cfg().jobsEnabled) return;
    // KXM-DS-07: every 5 minutes
    this.timer = setInterval(() => void this.syncOnce().catch((e) => this.log.warn(`provider sync failed: ${e.message}`)), 5 * 60_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  // ───────────── sync (KXM-DS-07) ─────────────

  /** Pull providers with updatedSince cursor; idempotent; never regresses a newer source version. */
  async syncOnce(opts: { full?: boolean } = {}): Promise<{ upserted: number; skipped: number; pages: number }> {
    const cursorRow = await this.prisma.kvState.findUnique({ where: { key: SYNC_CURSOR } });
    const since = opts.full ? undefined : (cursorRow?.value as any)?.updatedSince;
    let page = 1, upserted = 0, skipped = 0, maxUpdated = since ? new Date(since) : new Date(0);
    const seen: string[] = [];
    for (;;) {
      const { data } = await this.kiorly.listProviders({ updatedSince: since, page, pageSize: 100 });
      for (const dto of data.items ?? []) {
        const row = mapProviderDto(dto);
        seen.push(row.id);
        const existing = await this.prisma.provider.findUnique({ where: { id: row.id }, select: { sourceVersion: true } });
        if (existing && existing.sourceVersion > row.sourceVersion) { skipped++; continue; }
        const { id, raw, ...rest } = row;
        await this.prisma.provider.upsert({ where: { id }, create: { id, raw, ...rest } as any, update: { raw, ...rest, syncedAt: new Date() } as any });
        this.invalidateSlots(row.clinicianId);
        upserted++;
        const u = new Date(row.sourceVersion);
        if (u > maxUpdated) maxUpdated = u;
      }
      if (page * (data.pageSize ?? 100) >= (data.total ?? 0) || !(data.items ?? []).length) break;
      page++;
    }
    if (opts.full) await this.prisma.provider.updateMany({ where: { id: { notIn: seen }, status: { in: ['LIVE', 'PAUSED'] } }, data: { status: 'DELISTED' } });
    if (maxUpdated.getTime() > 0) await this.prisma.kvState.upsert({ where: { key: SYNC_CURSOR }, create: { key: SYNC_CURSOR, value: { updatedSince: new Date(maxUpdated.getTime() - 1000).toISOString() } }, update: { value: { updatedSince: new Date(maxUpdated.getTime() - 1000).toISOString() } } });
    return { upserted, skipped, pages: page };
  }

  invalidateSlots(clinicianId?: string) {
    if (!clinicianId) return void this.slotCache.clear();
    for (const k of this.slotCache.keys()) if (k.includes(`|${clinicianId}|`)) this.slotCache.delete(k);
  }

  // ───────────── reads ─────────────

  async getRow(id: string): Promise<Provider> {
    const p = await this.prisma.provider.findUnique({ where: { id } });
    if (!p) throw notFound('PROVIDER_NOT_FOUND', 'Provider not found');
    return p;
  }

  /** Public profile (KXM-PR-01/02/04): photo, titles, specialty, languages, fees, clinic, verification, cancellation policy. */
  async profile(id: string) {
    const p = await this.getRow(id);
    await this.markets.assertLive(p.market);
    const raw: any = p.raw ?? {};
    const prov = raw.provider ?? {};
    const marketplaceOn = await this.flags.isEnabled('kiorex.marketplace', { market: p.market });
    return {
      id: p.id, status: p.status, bookable: p.status === 'LIVE' && marketplaceOn, nameEn: p.nameEn, nameAr: p.nameAr, specialty: p.specialty, subSpecialties: p.subSpecialties, languages: p.languages, gender: p.gender,
      titleEn: prov.titleEn ?? null, titleAr: prov.titleAr ?? null, photoUrl: prov.photoUrl ?? prov.photoRelativePath ?? null, verified: p.status === 'LIVE', // only verified (LIVE) listings are bookable (ON-03)
      fees: (prov.fees ?? []).map((f: any) => ({ typeId: f.appointmentTypeId, nameEn: f.nameEn, nameAr: f.nameAr, amountMinor: Math.round(Number(f.amount) * 100), currency: f.currency })),
      clinic: { id: p.clinicId, ...(raw.clinic ?? {}), phone: raw.clinic?.phone ?? null },
      rating: { average: p.ratingAvg, count: p.ratingCount },
      cancellationPolicy: prov.cancellationPolicy ?? raw.cancellationPolicy ?? null,
      acceptsDeposit: p.acceptsDeposit,
      shareUrl: `${cfg().publicBaseUrl.replace(/:\d+$/, '')}/doctors/${p.id}`,
    };
  }

  /** Deposit policy for a visit type. NEEDS_HUMAN (KX-12): amounts are never invented; 0 = no deposit. */
  depositFor(p: Provider, typeId: string): { required: boolean; amountMinor: number } {
    const f = ((p.raw as any)?.provider?.fees ?? []).find((x: any) => x.appointmentTypeId === typeId);
    if (f?.depositAmount) return { required: true, amountMinor: Math.round(Number(f.depositAmount) * 100) };
    if (f?.depositRequired && cfg().depositDefaultMinor > 0) return { required: true, amountMinor: cfg().depositDefaultMinor };
    if (p.acceptsDeposit && cfg().depositDefaultMinor > 0) return { required: true, amountMinor: cfg().depositDefaultMinor };
    return { required: false, amountMinor: 0 };
  }
  feeFor(p: Provider, typeId: string): number | null {
    const f = ((p.raw as any)?.provider?.fees ?? []).find((x: any) => x.appointmentTypeId === typeId);
    return f ? Math.round(Number(f.amount) * 100) : null;
  }

  /** Slots from Kiorly's engine, cached 60 s (KXM-BK-01). */
  async slots(p: Provider, typeId: string, from: Date, to: Date): Promise<Slot[]> {
    const key = `${p.clinicId}|${p.clinicianId}|${typeId}|${from.toISOString().slice(0, 13)}|${to.toISOString().slice(0, 13)}`;
    const hit = this.slotCache.get(key);
    if (hit && Date.now() - hit.at < cfg().slotCacheTtlMs) return hit.slots;
    try {
      const { data } = await this.kiorly.slots(p.clinicId, { clinicianId: p.clinicianId, typeId, from: from.toISOString(), to: to.toISOString() });
      const slots: Slot[] = ((data as any)?.slots ?? data ?? []).map((s: any) => ({ startsAt: s.startsAt, endsAt: s.endsAt }));
      this.slotCache.set(key, { at: Date.now(), slots });
      return slots;
    } catch (e) {
      if (e instanceof KiorlyHttpError && e.status === 404) throw notFound('LISTING_NOT_LIVE', 'Listing is not live');
      if (e instanceof KiorlyTransientError) throw unavailable('CLINIC_SYSTEM_BUSY', 'Clinic system busy, try again shortly');
      throw e;
    }
  }

  async search(q: SearchParams) {
    const emergency = detectEmergency(q.q);
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(30, Math.max(1, q.pageSize ?? 10));
    if (emergency.emergency) {
      await this.track('emergency_guidance_shown', { code: emergency.categories[0] });
      return { emergency: { ...EMERGENCY_GUIDANCE, categories: emergency.categories }, items: [], total: 0, page, pageSize, specialties: [] };
    }
    const mapped = q.q ? mapSymptomToSpecialties(q.q) : [];
    const live = await this.markets.liveMarkets(); // market.<cc>.live gate: non-live countries are hidden from search
    if (!live.length) return { items: [], total: 0, page, pageSize, sort: q.sort ?? 'earliest', specialties: [], marketsLive: [] as string[] };
    const where: Prisma.Sql[] = [Prisma.sql`p.status = 'LIVE'`, Prisma.sql`p.market IN (${Prisma.join(live)})`];
    const specialty = q.specialty && isSpecialtyCode(q.specialty) ? q.specialty : q.specialty;
    if (specialty) where.push(Prisma.sql`p.specialty = ${specialty}`);
    if (q.q?.trim()) {
      const n = normalizeText(q.q);
      const toks = n.split(' ').filter((t) => t.length >= 2);
      const like = toks.length ? Prisma.join(toks.map((t) => Prisma.sql`p."searchText" ILIKE ${'%' + t + '%'}`), ' AND ') : Prisma.sql`TRUE`;
      const specs = mapped.length ? Prisma.sql`OR p.specialty IN (${Prisma.join(mapped)})` : Prisma.empty;
      where.push(Prisma.sql`((${like}) OR similarity(p."searchText", ${n}) > 0.25 ${specs})`);
    }
    if (q.governorate) where.push(Prisma.sql`lower(p.governorate) = ${q.governorate.toLowerCase()}`);
    if (q.area) where.push(Prisma.sql`lower(p.area) = ${q.area.toLowerCase()}`);
    if (q.minFee !== undefined) where.push(Prisma.sql`p."maxFeeMinor" >= ${Math.round(q.minFee * 100)}`);
    if (q.maxFee !== undefined) where.push(Prisma.sql`p."minFeeMinor" <= ${Math.round(q.maxFee * 100)}`);
    if (q.gender) where.push(Prisma.sql`p.gender = ${q.gender.toUpperCase()}`);
    if (q.language) where.push(Prisma.sql`${q.language.toLowerCase()} = ANY(p.languages)`);
    if (q.minRating !== undefined) where.push(Prisma.sql`p."ratingAvg" >= ${q.minRating}`);
    if (q.acceptsDeposit !== undefined) where.push(Prisma.sql`p."acceptsDeposit" = ${q.acceptsDeposit}`);
    const hasGeo = q.lat !== undefined && q.lng !== undefined;
    const dist = hasGeo
      ? Prisma.sql`(6371 * acos(least(1, cos(radians(${q.lat})) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(${q.lng})) + sin(radians(${q.lat})) * sin(radians(p.latitude)))))`
      : Prisma.sql`NULL::float`;
    if (hasGeo && q.maxDistanceKm) where.push(Prisma.sql`p.latitude IS NOT NULL AND ${dist} <= ${q.maxDistanceKm}`);
    const sort = q.sort ?? 'earliest';
    const order = sort === 'distance' && hasGeo ? Prisma.sql`distance ASC NULLS LAST` : sort === 'rating' ? Prisma.sql`p."ratingAvg" DESC, p."ratingCount" DESC` : sort === 'fee' ? Prisma.sql`p."minFeeMinor" ASC NULLS LAST` : Prisma.sql`p."ratingAvg" DESC, p."ratingCount" DESC`;
    const whereSql = Prisma.join(where, ' AND ');
    const slotSort = sort === 'earliest' || !!q.nextAvailable;
    const limit = slotSort ? 60 : pageSize;
    const offset = slotSort ? 0 : (page - 1) * pageSize;
    const rows = await this.prisma.$queryRaw<(Provider & { distance: number | null })[]>(Prisma.sql`SELECT p.*, ${dist} AS distance FROM "Provider" p WHERE ${whereSql} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`);
    const totalRow = await this.prisma.$queryRaw<{ c: bigint }[]>(Prisma.sql`SELECT count(*)::bigint c FROM "Provider" p WHERE ${whereSql}`);
    let total = Number(totalRow[0]?.c ?? 0);

    const marketplaceOn = await this.flags.isEnabled('kiorex.marketplace', { market: 'EG' });
    const orgOk = new Map<string, boolean>();
    const visible: typeof rows = [];
    for (const r of rows) {
      if (r.tenantId) {
        if (!orgOk.has(r.tenantId)) { const d = await this.flags.evaluate('clinic.kiorex_listing', { market: r.market, orgId: r.tenantId }); orgOk.set(r.tenantId, d.effective || d.reason === 'DEPENDENCY_OFF'); }
        if (!orgOk.get(r.tenantId)) { total--; continue; }
      }
      visible.push(r);
    }
    const items = await Promise.all(visible.map(async (r) => {
      const fees = ((r.raw as any)?.provider?.fees ?? []) as any[];
      const typeId = fees[0]?.appointmentTypeId;
      let nextSlots: Slot[] | null = null;
      let slotsUnavailable = false;
      if (marketplaceOn && typeId) {
        try {
          const from = new Date();
          nextSlots = (await this.slots(r, typeId, from, new Date(from.getTime() + 7 * 86400_000))).slice(0, 3);
        } catch { slotsUnavailable = true; }
      }
      return {
        id: r.id, nameEn: r.nameEn, nameAr: r.nameAr, clinicNameEn: r.clinicNameEn, clinicNameAr: r.clinicNameAr, specialty: r.specialty, governorate: r.governorate, area: r.area,
        minFeeMinor: r.minFeeMinor, maxFeeMinor: r.maxFeeMinor, currency: r.currency, rating: { average: r.ratingAvg, count: r.ratingCount }, acceptsDeposit: r.acceptsDeposit, languages: r.languages, gender: r.gender,
        distanceKm: r.distance, verified: true, bookable: marketplaceOn && !!typeId, defaultTypeId: typeId ?? null, nextSlots, slotsUnavailable, sponsored: false,
        ...(marketplaceOn ? {} : { clinicPhone: (r.raw as any)?.clinic?.phone ?? null }),
      };
    }));
    let out = items;
    if (q.nextAvailable) {
      const end = new Date();
      end.setUTCHours(23, 59, 59, 999);
      if (q.nextAvailable === 'tomorrow') end.setUTCDate(end.getUTCDate() + 1);
      if (q.nextAvailable === 'week') end.setUTCDate(end.getUTCDate() + 7);
      out = out.filter((i) => i.nextSlots?.[0] && new Date(i.nextSlots[0].startsAt) <= end);
      total = out.length;
    }
    if (slotSort) {
      out.sort((a, b) => (a.nextSlots?.[0] ? new Date(a.nextSlots[0].startsAt).getTime() : Infinity) - (b.nextSlots?.[0] ? new Date(b.nextSlots[0].startsAt).getTime() : Infinity));
      out = out.slice((page - 1) * pageSize, page * pageSize);
    }
    await this.track('results_viewed', { code: q.q ? 'keyword' : 'browse', specialtyCode: specialty ?? mapped[0] });
    return { items: out, total, page, pageSize, sort, specialties: mapped.map((c) => ({ code: c, ...SPECIALTY_LABELS[c] })) };
  }

  specialties() {
    return SPECIALTY_CODES.map((code) => ({ code, ...SPECIALTY_LABELS[code] }));
  }

  // ───────────── analytics (KXM-DS-08) — never records free text ─────────────

  async track(name: string, d: { specialtyCode?: string; providerId?: string; code?: string; market?: string } = {}) {
    await this.prisma.analyticsEvent.create({ data: { name, specialtyCode: d.specialtyCode, providerId: d.providerId, code: d.code, market: d.market ?? 'EG' } }).catch(() => undefined);
  }

  async recordProfileView(providerId: string) {
    const p = await this.getRow(providerId);
    const date = new Date(new Date().toISOString().slice(0, 10));
    await this.prisma.profileViewDaily.upsert({ where: { providerId_date: { providerId: p.id, date } }, create: { providerId: p.id, date, views: 1 }, update: { views: { increment: 1 }, pushedAt: null } });
    return { ok: true };
  }

  /** Daily push of completed days; re-sending a day replaces it on Kiorly (idempotent). */
  async pushProfileViews(): Promise<{ pushed: number }> {
    const today = new Date(new Date().toISOString().slice(0, 10));
    const rows = await this.prisma.profileViewDaily.findMany({ where: { pushedAt: null, date: { lt: today } } });
    if (!rows.length) return { pushed: 0 };
    const providers = await this.prisma.provider.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.providerId))] } } });
    const byProv = new Map(providers.map((p) => [p.id, p]));
    const byClinic = new Map<string, { clinicianId: string; date: string; views: number }[]>();
    for (const r of rows) {
      const p = byProv.get(r.providerId);
      if (!p) continue;
      const list = byClinic.get(p.clinicId) ?? [];
      list.push({ clinicianId: p.clinicianId, date: r.date.toISOString().slice(0, 10), views: r.views });
      byClinic.set(p.clinicId, list);
    }
    let pushed = 0;
    for (const [clinicId, items] of byClinic) {
      for (let i = 0; i < items.length; i += 400) {
        const chunk = items.slice(i, i + 400);
        await this.kiorly.syncProfileViews({ clinicId, items: chunk });
        pushed += chunk.length;
      }
    }
    await this.prisma.profileViewDaily.updateMany({ where: { pushedAt: null, date: { lt: today } }, data: { pushedAt: new Date() } });
    return { pushed };
  }

  /** KXM-OP-01: provider directory with listing status mirrored from Kiorly. */
  async opsList(q: { status?: string; q?: string; take?: number; page?: number }) {
    const take = Math.min(q.take ?? 50, 200);
    const where: Prisma.ProviderWhereInput = { ...(q.status ? { status: q.status } : {}), ...(q.q ? { searchText: { contains: normalizeText(q.q) } } : {}) };
    const [total, rows] = await Promise.all([this.prisma.provider.count({ where }), this.prisma.provider.findMany({ where, orderBy: { syncedAt: 'desc' }, take, skip: ((q.page ?? 1) - 1) * take, select: { id: true, clinicId: true, clinicianId: true, status: true, nameEn: true, nameAr: true, specialty: true, governorate: true, ratingAvg: true, ratingCount: true, sourceVersion: true, syncedAt: true } })]);
    return { total, items: rows };
  }

  async updateRating(providerId: string, avg: number, count: number) {
    await this.prisma.provider.updateMany({ where: { id: providerId }, data: { ratingAvg: avg, ratingCount: count } });
  }
}
