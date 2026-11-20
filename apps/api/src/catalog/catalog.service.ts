import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, Provider } from '@prisma/client';
import { cfg } from '../common/config';
import { ApiError, badRequest, conflict, notFound, unavailable } from '../common/errors';
import { FlagsService } from '../control-plane/control-plane-public';
import { KiorlyClient, KiorlyHttpError, KiorlyTransientError } from '../kiorly/kiorly-public';
import { MarketService } from '../market/market-public';
import { PrismaService } from '../prisma/prisma.service';
import { detectEmergency, EMERGENCY_GUIDANCE, isSpecialtyCode, mapSymptomToSpecialties, normalizeText, SPECIALTY_CODES, SPECIALTY_LABELS } from '../safety/safety-public';
import { CARE_TYPES, CareType, careTypeOf, mapProviderDto, normalizeDistrict, ServiceLocation } from './provider-mapper';

export interface SearchParams {
  q?: string; specialty?: string; governorate?: string; area?: string; minFee?: number; maxFee?: number; gender?: string; language?: string; minRating?: number;
  acceptsDeposit?: boolean; nextAvailable?: 'today' | 'tomorrow' | 'week'; sort?: 'earliest' | 'distance' | 'rating' | 'fee'; lat?: number; lng?: number; maxDistanceKm?: number; page?: number; pageSize?: number;
  /** Rev 2.3 (KXMDS01/02): care type category, visit location filter and the patient's district (home search). */
  careType?: string; serviceLocation?: string; district?: string; profession?: string;
}
export interface Slot { startsAt: string; endsAt: string; serviceLocation?: ServiceLocation; district?: string | null }
export interface SlotQuery { serviceLocation?: ServiceLocation; district?: string; lat?: number; lng?: number; fresh?: boolean }
/** KXMDS01: flag that gates each non-doctor care type (Doctors are always on). */
export const CARE_TYPE_FLAG: Record<CareType, string | null> = { DOCTORS: null, PHYSIOTHERAPY: 'kiorex.category.physiotherapy', HOME_NURSING: 'kiorex.category.nursing' };
export const CARE_TYPE_LABELS: Record<CareType, { en: string; ar: string }> = {
  DOCTORS: { en: 'Doctors', ar: 'أطباء' }, PHYSIOTHERAPY: { en: 'Physiotherapy', ar: 'علاج طبيعي' }, HOME_NURSING: { en: 'Home nursing', ar: 'تمريض منزلي' },
};
/** Profession-naming badge (KXMPR01). Draft AR/EN labels: NEEDS_HUMAN review (the Arabic Nurse product name is Q12; these are generic profession words). */
export const PROFESSION_BADGES: Record<string, { en: string; ar: string }> = {
  PHYSICIAN: { en: 'Verified doctor', ar: 'طبيب موثّق' }, DENTIST: { en: 'Verified dentist', ar: 'طبيب أسنان موثّق' },
  PHYSIOTHERAPIST: { en: 'Verified physiotherapist', ar: 'أخصائي علاج طبيعي موثّق' }, NURSE: { en: 'Verified nurse', ar: 'ممرض موثّق' },
};
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
      fees: (prov.fees ?? []).map((f: any) => { const home = this.feeLocation(p, f) === 'HOME'; const sur = home ? Math.round(Number(f.homeSurcharge ?? 0) * 100) : 0; return { typeId: f.appointmentTypeId, nameEn: f.nameEn, nameAr: f.nameAr, amountMinor: Math.round(Number(f.amount) * 100), currency: f.currency, serviceLocation: home ? 'HOME' : 'IN_CLINIC', homeSurchargeMinor: sur, totalMinor: Math.round(Number(f.amount) * 100) + sur }; }),
      clinic: { id: p.clinicId, ...(raw.clinic ?? {}), phone: raw.clinic?.phone ?? null },
      rating: { average: p.ratingAvg, count: p.ratingCount },
      cancellationPolicy: prov.cancellationPolicy ?? raw.cancellationPolicy ?? null,
      acceptsDeposit: p.acceptsDeposit,
      profession: p.profession, careType: p.careType, edition: p.edition, professionBadge: p.profession ? PROFESSION_BADGES[p.profession] ?? null : null, verificationRegister: p.verificationRegister,
      categoryEnabled: (await this.careTypeEnabled(p.careType as CareType, p.market)).enabled,
      serviceLocations: p.serviceLocations, assignsClinician: p.assignsClinician,
      // coverage DISTRICTS only (KXMDS05): the provider's home address is never part of the projection
      homeVisit: { enabled: this.isHomeEnabled(p) && (await this.flags.isEnabled('kiorex.home_visits', { market: p.market })), coverageDistricts: p.coverageDistricts, homeSurchargeMinor: this.isHomeEnabled(p) ? p.homeSurchargeMinor ?? 0 : null },
      shareUrl: `${cfg().publicBaseUrl.replace(/:\d+$/, '')}/doctors/${p.id}`,
    };
  }

  /** Deposit policy for a visit type. NEEDS_HUMAN (KX-12): amounts are never invented; 0 = no deposit. */
  depositFor(p: Provider, typeId: string, o: { home?: boolean } = {}): { required: boolean; amountMinor: number; policy?: 'HOME_DEFAULT_REQUIRED_AMOUNT_UNSET' } {
    const f = ((p.raw as any)?.provider?.fees ?? []).find((x: any) => x.appointmentTypeId === typeId);
    if (f?.depositAmount) return { required: true, amountMinor: Math.round(Number(f.depositAmount) * 100) };
    // BR54: a deposit is required BY DEFAULT for home visits. The amount is a business decision (KX-12, NEEDS_HUMAN) and is never invented: HOME_DEPOSIT_DEFAULT_MINOR (else DEPOSIT_DEFAULT_MINOR); 0 = unset => no deposit collected and the booking says so.
    if (o.home) {
      const amt = cfg().homeDepositDefaultMinor || cfg().depositDefaultMinor;
      return amt > 0 ? { required: true, amountMinor: amt } : { required: false, amountMinor: 0, policy: 'HOME_DEFAULT_REQUIRED_AMOUNT_UNSET' };
    }
    if (f?.depositRequired && cfg().depositDefaultMinor > 0) return { required: true, amountMinor: cfg().depositDefaultMinor };
    if (p.acceptsDeposit && cfg().depositDefaultMinor > 0) return { required: true, amountMinor: cfg().depositDefaultMinor };
    return { required: false, amountMinor: 0 };
  }
  feeFor(p: Provider, typeId: string): number | null {
    const f = ((p.raw as any)?.provider?.fees ?? []).find((x: any) => x.appointmentTypeId === typeId);
    return f ? Math.round(Number(f.amount) * 100) : null;
  }

  /** Slots from Kiorly's engine, cached 60 s (KXM-BK-01). */
  async slots(p: Provider, typeId: string, from: Date, to: Date, opts: SlotQuery = {}): Promise<Slot[]> {
    const home = opts.serviceLocation === 'HOME';
    const district = home ? opts.district : undefined;
    // the cache key carries location + district (never coordinates or an address)
    const key = `${p.clinicId}|${p.clinicianId}|${typeId}|${from.toISOString().slice(0, 13)}|${to.toISOString().slice(0, 13)}|${home ? `HOME:${district ?? ''}` : 'IN_CLINIC'}`;
    const hit = this.slotCache.get(key);
    if (!opts.fresh && hit && Date.now() - hit.at < cfg().slotCacheTtlMs) return hit.slots;
    try {
      const { data } = await this.kiorly.slots(p.clinicId, { clinicianId: p.clinicianId, typeId, from: from.toISOString(), to: to.toISOString(), ...(home ? { serviceLocation: 'HOME', district, lat: opts.lat, lng: opts.lng } : {}) });
      const slots: Slot[] = ((data as any)?.slots ?? data ?? []).map((s: any) => ({ startsAt: s.startsAt, endsAt: s.endsAt, serviceLocation: (s.serviceLocation === 'HOME' || home ? 'HOME' : 'IN_CLINIC') as ServiceLocation, district: s.district ?? (home ? district ?? null : null) }));
      this.slotCache.set(key, { at: Date.now(), slots });
      return slots;
    } catch (e) {
      if (e instanceof KiorlyHttpError && e.status === 404) throw notFound('LISTING_NOT_LIVE', 'Listing is not live');
      if (e instanceof KiorlyHttpError && e.status === 422 && (e.code === 'OUT_OF_COVERAGE' || e.body?.code === 'OUT_OF_COVERAGE')) throw await this.outOfCoverage(p, district ?? e.body?.district, e.body?.alternatives);
      if (e instanceof KiorlyTransientError) throw unavailable('CLINIC_SYSTEM_BUSY', 'Clinic system busy, try again shortly');
      throw e;
    }
  }

  /** KXMHV02: 422 OUT_OF_COVERAGE with an explanation, the provider's covered districts and in-zone alternatives (never an address). */
  async outOfCoverage(p: Provider, district?: string | null, alternatives?: unknown): Promise<ApiError> {
    const d = normalizeDistrict(district) ?? undefined;
    const suggested = d ? await this.prisma.provider.findMany({ where: { status: 'LIVE', careType: p.careType, id: { not: p.id }, serviceLocations: { has: 'HOME' }, coverageDistricts: { has: d } }, take: 3, select: { id: true, nameEn: true, nameAr: true, careType: true } }) : [];
    return new ApiError(422, 'OUT_OF_COVERAGE', 'This provider does not visit your district', {
      district: d, coverageDistricts: p.coverageDistricts, alternatives: Array.isArray(alternatives) ? alternatives : [], suggestedProviders: suggested,
      explanation: { en: 'This provider does not visit your district yet. Pick another address or another provider.', ar: 'هذا المقدم لا يغطي منطقتك حاليًا. اختر عنوانًا آخر أو مقدمًا آخر.' },
    });
  }

  /** Pure local coverage precheck (projection); Kiorly stays the authority and may still answer 422. */
  coversDistrict(p: Provider, district: string): boolean {
    return p.coverageDistricts.length === 0 ? true : p.coverageDistricts.includes(district);
  }
  isHomeEnabled(p: Provider): boolean { return p.serviceLocations.includes('HOME'); }
  /** A fee entry names its visit location; entries without one belong to the provider's only location (nurses are home-only), else IN_CLINIC. */
  feeLocation(p: Provider, f: any): ServiceLocation { return (f?.serviceLocation ?? (p.serviceLocations.length === 1 ? p.serviceLocations[0] : 'IN_CLINIC')) as ServiceLocation; }

  /** Visit type to show/book for a location: home fees carry `serviceLocation: HOME`; legacy single-fee providers fall back to fees[0]. */
  typeFor(p: Provider, location: ServiceLocation): { typeId: string | undefined; fee: any | undefined } {
    const fees = ((p.raw as any)?.provider?.fees ?? []) as any[];
    const want = fees.find((f) => this.feeLocation(p, f) === location);
    const f = want ?? (location === 'HOME' && !p.serviceLocations.includes('HOME') ? undefined : fees[0]);
    return { typeId: f?.appointmentTypeId, fee: f };
  }

  /** Is the care-type category visible? Doctors always; physiotherapy/nursing follow their flags (launch-locked => hidden until evidence). */
  async careTypeEnabled(ct: CareType, market = 'EG') {
    const key = CARE_TYPE_FLAG[ct];
    if (!key) return { enabled: true, key: null as string | null, reason: 'ON', scope: undefined as string | undefined };
    const r = await this.flags.evaluate(key, { market });
    return { enabled: r.effective, key, reason: r.reason, scope: r.scope as string | undefined };
  }
  async careTypes(market = 'EG') {
    const counts = await this.prisma.provider.groupBy({ by: ['careType'], where: { status: 'LIVE' }, _count: true });
    return Promise.all(CARE_TYPES.map(async (code) => { const e = await this.careTypeEnabled(code, market); return { code, labelEn: CARE_TYPE_LABELS[code].en, labelAr: CARE_TYPE_LABELS[code].ar, enabled: e.enabled, flag: e.key, reason: e.reason, providerCount: e.enabled ? counts.find((c) => c.careType === code)?._count ?? 0 : 0 }; }));
  }

  /** District directory for the home-visit picker (district-level only; no addresses). */
  async homeDistricts() {
    const rows = await this.prisma.$queryRaw<{ district: string; governorate: string | null; providers: bigint }[]>(Prisma.sql`
      SELECT d AS district, min(p.governorate) AS governorate, count(*)::bigint AS providers
      FROM "Provider" p, unnest(p."coverageDistricts") AS d
      WHERE p.status = 'LIVE' AND 'HOME' = ANY(p."serviceLocations") GROUP BY d ORDER BY d`);
    return rows.map((r) => ({ district: r.district, governorate: r.governorate, homeEnabledProviders: Number(r.providers) }));
  }

  /** KXMOP06 + home-visit release gate: >= 50 home-enabled providers PER launch cluster (cluster = governorate). A human still records GHV1/GHV2. */
  async homeGateMetric(min = cfg().homeGateMinProviders) {
    const rows = await this.prisma.$queryRaw<{ cluster: string | null; providers: bigint; physios: bigint; nurses: bigint }[]>(Prisma.sql`
      SELECT lower(coalesce(governorate, 'unknown')) AS cluster, count(*)::bigint AS providers,
        count(*) FILTER (WHERE "careType" = 'PHYSIOTHERAPY')::bigint AS physios, count(*) FILTER (WHERE "careType" = 'HOME_NURSING')::bigint AS nurses
      FROM "Provider" WHERE status = 'LIVE' AND 'HOME' = ANY("serviceLocations") GROUP BY 1 ORDER BY 1`);
    const clusters = rows.map((r) => ({ cluster: r.cluster ?? 'unknown', homeEnabledProviders: Number(r.providers), byCareType: { doctors: Number(r.providers) - Number(r.physios) - Number(r.nurses), physiotherapy: Number(r.physios), homeNursing: Number(r.nurses) }, threshold: min, met: Number(r.providers) >= min }));
    return { threshold: min, clusterBasis: 'governorate', clusters, anyMet: clusters.some((c) => c.met), allMet: clusters.length > 0 && clusters.every((c) => c.met) };
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
    // ── Rev 2.3 (KXMDS01/02): care type, visit location, district. Disabled categories are never shown; an explicit request for one is 403 FEATURE_DISABLED.
    let careType: CareType | undefined;
    if (q.careType) {
      careType = String(q.careType).toUpperCase() as CareType;
      if (!(CARE_TYPES as readonly string[]).includes(careType)) throw badRequest('INVALID_CARE_TYPE', `careType must be ${CARE_TYPES.join('|')}`);
      const e = await this.careTypeEnabled(careType);
      if (!e.enabled) await this.flags.assertEnabled(e.key!, { market: 'EG' });
      where.push(Prisma.sql`p."careType" = ${careType}`);
    } else {
      const on: string[] = [];
      for (const ct of CARE_TYPES) if ((await this.careTypeEnabled(ct)).enabled) on.push(ct);
      where.push(Prisma.sql`p."careType" IN (${Prisma.join(on)})`);
    }
    const location = q.serviceLocation ? (String(q.serviceLocation).toUpperCase() as ServiceLocation) : undefined;
    if (location && !['IN_CLINIC', 'HOME'].includes(location)) throw badRequest('INVALID_SERVICE_LOCATION', 'serviceLocation must be IN_CLINIC|HOME');
    const homeOn = await this.flags.isEnabled('kiorex.home_visits', { market: 'EG' });
    const district = q.district === undefined || q.district === '' ? undefined : normalizeDistrict(q.district) ?? undefined;
    if (q.district && !district) throw badRequest('INVALID_DISTRICT', 'district must be a district code such as "nasr-city" (never an address)');
    if (location === 'HOME') {
      if (!homeOn) await this.flags.assertEnabled('kiorex.home_visits', { market: 'EG' });
      if (!district) throw badRequest('DISTRICT_REQUIRED', 'Home search needs the patient district');
      where.push(Prisma.sql`'HOME' = ANY(p."serviceLocations") AND ${district} = ANY(p."coverageDistricts")`); // only in-zone providers return
    } else if (location === 'IN_CLINIC') where.push(Prisma.sql`('IN_CLINIC' = ANY(p."serviceLocations") OR cardinality(p."serviceLocations") = 0)`);
    else if (!homeOn) where.push(Prisma.sql`('IN_CLINIC' = ANY(p."serviceLocations") OR cardinality(p."serviceLocations") = 0)`); // home-only providers are not bookable while home visits are OFF
    if (q.profession) where.push(Prisma.sql`p.profession = ${String(q.profession).toUpperCase()}`);
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
      const loc: ServiceLocation = location ?? (r.serviceLocations.includes('IN_CLINIC') || !r.serviceLocations.length ? 'IN_CLINIC' : 'HOME');
      const { typeId, fee } = this.typeFor(r, loc);
      let nextSlots: Slot[] | null = null;
      let slotsUnavailable = false;
      if (marketplaceOn && typeId && (loc === 'IN_CLINIC' || (district && homeOn))) {
        try {
          const from = new Date();
          nextSlots = (await this.slots(r, typeId, from, new Date(from.getTime() + 7 * 86400_000), { serviceLocation: loc, district })).slice(0, 3);
        } catch { slotsUnavailable = true; }
      }
      const base = fee ? Math.round(Number(fee.amount) * 100) : null;
      const sur = fee?.homeSurcharge ? Math.round(Number(fee.homeSurcharge) * 100) : r.homeSurchargeMinor ?? 0;
      return {
        profession: r.profession, careType: r.careType, edition: r.edition, serviceLocations: r.serviceLocations, coverageDistricts: r.coverageDistricts, assignsClinician: r.assignsClinician,
        professionBadge: r.profession ? PROFESSION_BADGES[r.profession] ?? null : null,
        homeVisit: { enabled: this.isHomeEnabled(r) && homeOn, homeSurchargeMinor: this.isHomeEnabled(r) ? sur : null, visitFeeIncludingSurchargeMinor: loc === 'HOME' && base !== null ? base + sur : null },
        id: r.id, nameEn: r.nameEn, nameAr: r.nameAr, clinicNameEn: r.clinicNameEn, clinicNameAr: r.clinicNameAr, specialty: r.specialty, governorate: r.governorate, area: r.area,
        minFeeMinor: r.minFeeMinor, maxFeeMinor: r.maxFeeMinor, currency: r.currency, rating: { average: r.ratingAvg, count: r.ratingCount }, acceptsDeposit: r.acceptsDeposit, languages: r.languages, gender: r.gender,
        distanceKm: r.distance, verified: true,
        ...(r.serviceLocations.includes('IN_CLINIC') && r.latitude != null && r.longitude != null ? { latitude: r.latitude, longitude: r.longitude } : {}), bookable: marketplaceOn && !!typeId && (loc === 'IN_CLINIC' || homeOn), defaultTypeId: typeId ?? null, defaultServiceLocation: loc, nextSlots, slotsUnavailable, sponsored: false,
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
    await this.track('results_viewed', { code: q.q ? 'keyword' : 'browse', specialtyCode: specialty ?? mapped[0], careType, serviceLocation: location, district });
    return { items: out, total, page, pageSize, sort, specialties: mapped.map((c) => ({ code: c, ...SPECIALTY_LABELS[c] })) };
  }

  specialties() {
    return SPECIALTY_CODES.map((code) => ({ code, ...SPECIALTY_LABELS[code] }));
  }

  // ───────────── analytics (KXM-DS-08) — never records free text ─────────────

  /** RULE (Rev 2.3): no patient addresses in analytics; location is the DISTRICT code only (a slug), plus care type and visit location. */
  async track(name: string, d: { specialtyCode?: string; providerId?: string; code?: string; market?: string; district?: string | null; careType?: string; serviceLocation?: string } = {}) {
    await this.prisma.analyticsEvent.create({ data: { name, specialtyCode: d.specialtyCode, providerId: d.providerId, code: d.code, market: d.market ?? 'EG', district: normalizeDistrict(d.district) ?? undefined, careType: d.careType, serviceLocation: d.serviceLocation } }).catch(() => undefined);
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
    const [total, rows] = await Promise.all([this.prisma.provider.count({ where }), this.prisma.provider.findMany({ where, orderBy: { syncedAt: 'desc' }, take, skip: ((q.page ?? 1) - 1) * take, select: { id: true, profession: true, careType: true, serviceLocations: true, coverageDistricts: true, clinicId: true, clinicianId: true, status: true, nameEn: true, nameAr: true, specialty: true, governorate: true, ratingAvg: true, ratingCount: true, sourceVersion: true, syncedAt: true } })]);
    return { total, items: rows };
  }

  async updateRating(providerId: string, avg: number, count: number) {
    await this.prisma.provider.updateMany({ where: { id: providerId }, data: { ratingAvg: avg, ratingCount: count } });
  }
}
