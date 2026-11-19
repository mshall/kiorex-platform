import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Provider, WaitlistEntry, WaitlistOffer } from '@prisma/client';
import { cfg } from '../common/config';
import { ApiError, badRequest, conflict, notFound } from '../common/errors';
import { newId } from '../common/ids';
import { BookingService } from '../booking/booking-public';
import { CatalogService } from '../catalog/catalog-public';
import { FlagsService } from '../control-plane/control-plane-public';
import { EngagementService } from '../engagement/engagement-public';
import { MarketService } from '../market/market-public';
import { PatientService } from '../patient/patient-public';
import { PrismaService } from '../prisma/prisma.service';

export interface JoinInput { providerId: string; typeId: string; preferredFrom?: string; preferredTo?: string; dependantId?: string }

/**
 * KXM-BK-12 waitlist. Kiorly's own waitlist (FS03, `clinic.waitlist_autofill`) is staff/WhatsApp driven and exposes NO
 * marketplace endpoint or event for Kiorex patients (see Docs/NEEDS_HUMAN.md #19). Until it does, Kiorex keeps the waitlist
 * and uses the contracts that exist: slots API + SLOTS_CHANGED event -> offer -> hold (same BookingService as marketplace).
 * The Kiorly org flag `clinic.waitlist_autofill` is honoured: OFF => entries are kept, no automatic offers.
 */
@Injectable()
export class WaitlistService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('waitlist');
  private timer?: NodeJS.Timeout;
  constructor(
    private readonly prisma: PrismaService, private readonly catalog: CatalogService, private readonly booking: BookingService, private readonly flags: FlagsService,
    private readonly engagement: EngagementService, private readonly markets: MarketService, private readonly patients: PatientService,
  ) {}

  onModuleInit() {
    if (!cfg().jobsEnabled) return;
    this.timer = setInterval(() => void this.scan().catch((e) => this.log.warn(e.message)), 60_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private presentOffer(o: WaitlistOffer) {
    return { id: o.id, startsAt: o.startsAt.toISOString(), endsAt: o.endsAt.toISOString(), status: o.status, expiresAt: o.expiresAt.toISOString(), bookingId: o.bookingId };
  }
  private presentEntry(e: WaitlistEntry & { offers: WaitlistOffer[] }) {
    return { id: e.id, providerId: e.providerId, typeId: e.typeId, preferredFrom: e.preferredFrom?.toISOString() ?? null, preferredTo: e.preferredTo?.toISOString() ?? null, status: e.status, expiresAt: e.expiresAt.toISOString(), offers: e.offers.map((o) => this.presentOffer(o)) };
  }

  async join(sub: string, i: JoinInput) {
    const p = await this.prisma.provider.findUnique({ where: { id: i.providerId } });
    if (!p) throw notFound('PROVIDER_NOT_FOUND', 'Provider not found');
    await this.markets.assertLive(p.market);
    if (p.status !== 'LIVE') throw conflict('LISTING_NOT_LIVE', 'Only live listings have a waitlist');
    if (i.dependantId) await this.patients.assertGuardian(sub, i.dependantId);
    if (!(await this.patients.profileBySub(sub))) throw notFound('PROFILE_NOT_FOUND', 'Complete your profile first');
    const from = i.preferredFrom ? new Date(i.preferredFrom) : null;
    const to = i.preferredTo ? new Date(i.preferredTo) : null;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) throw badRequest('INVALID_WINDOW', 'invalid preferred window');
    if (from && to && to <= from) throw badRequest('INVALID_WINDOW', 'preferredTo must be after preferredFrom');
    if (to && to <= new Date()) throw badRequest('INVALID_WINDOW', 'preferredTo is in the past');
    const existing = await this.prisma.waitlistEntry.findFirst({ where: { sub, providerId: p.id, typeId: i.typeId, dependantId: i.dependantId ?? null, status: { in: ['WAITING', 'OFFERED'] } }, include: { offers: true } });
    if (existing) return this.presentEntry(existing);
    const horizon = new Date(Date.now() + cfg().waitlistHorizonDays * 86400_000);
    const e = await this.prisma.waitlistEntry.create({
      data: { id: newId('kx_wl'), sub, dependantId: i.dependantId, providerId: p.id, clinicId: p.clinicId, clinicianId: p.clinicianId, tenantId: p.tenantId, typeId: i.typeId, preferredFrom: from, preferredTo: to, expiresAt: to && to < horizon ? to : horizon },
      include: { offers: true },
    });
    await this.catalog.track('waitlist_joined', { providerId: p.id, specialtyCode: p.specialty ?? undefined });
    return this.presentEntry(e);
  }

  async list(sub: string) {
    const rows = await this.prisma.waitlistEntry.findMany({ where: { sub, status: { not: 'CANCELLED' } }, include: { offers: { orderBy: { createdAt: 'desc' } } }, orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map((e) => this.presentEntry(e));
  }

  async cancel(sub: string, id: string) {
    const r = await this.prisma.waitlistEntry.updateMany({ where: { id, sub, status: { in: ['WAITING', 'OFFERED'] } }, data: { status: 'CANCELLED' } });
    if (!r.count) throw notFound('WAITLIST_ENTRY_NOT_FOUND', 'Waitlist entry not found');
    await this.prisma.waitlistOffer.updateMany({ where: { entryId: id, status: 'OFFERED' }, data: { status: 'DECLINED', respondedAt: new Date() } });
    return { ok: true };
  }

  // ───────────── autofill ─────────────

  private fits(e: WaitlistEntry, startsAt: Date) {
    const t = startsAt.getTime();
    return (!e.preferredFrom || e.preferredFrom.getTime() <= t) && (!e.preferredTo || e.preferredTo.getTime() >= t);
  }

  /** Expire stale offers (slot goes back on the market), then offer open slots to the oldest fitting waiting entries. */
  async scan(opts: { clinicianId?: string } = {}) {
    const now = new Date();
    let offersExpired = 0, offersCreated = 0;
    const stale = await this.prisma.waitlistOffer.findMany({ where: { status: 'OFFERED', expiresAt: { lt: now } } });
    for (const o of stale) {
      const c = await this.prisma.waitlistOffer.updateMany({ where: { id: o.id, status: 'OFFERED' }, data: { status: 'EXPIRED', respondedAt: now } });
      if (c.count) { offersExpired++; await this.prisma.waitlistEntry.updateMany({ where: { id: o.entryId, status: 'OFFERED' }, data: { status: 'WAITING' } }); }
    }
    await this.prisma.waitlistEntry.updateMany({ where: { status: { in: ['WAITING', 'OFFERED'] }, expiresAt: { lt: now } }, data: { status: 'EXPIRED' } });
    const entries = await this.prisma.waitlistEntry.findMany({ where: { status: 'WAITING', ...(opts.clinicianId ? { clinicianId: opts.clinicianId } : {}) }, orderBy: { createdAt: 'asc' }, take: 500 });
    const byProvider = new Map<string, WaitlistEntry[]>();
    for (const e of entries) byProvider.set(`${e.providerId}|${e.typeId}`, [...(byProvider.get(`${e.providerId}|${e.typeId}`) ?? []), e]);
    for (const [key, list] of byProvider) {
      const provider = await this.prisma.provider.findUnique({ where: { id: key.split('|')[0] } });
      if (!provider || provider.status !== 'LIVE') continue;
      if (!(await this.autofillOn(provider))) continue; // clinic.waitlist_autofill OFF: waitlist kept, no automatic offers
      let slots: { startsAt: string; endsAt: string }[];
      try { slots = await this.catalog.slots(provider, list[0].typeId, now, new Date(now.getTime() + cfg().waitlistHorizonDays * 86400_000)); } catch { continue; }
      for (const s of slots) {
        const startsAt = new Date(s.startsAt);
        if (startsAt <= now) continue;
        if (await this.prisma.waitlistOffer.findFirst({ where: { providerId: provider.id, startsAt, status: 'OFFERED' } })) continue; // already offered to someone
        for (const e of list) {
          if (e.status !== 'WAITING' || !this.fits(e, startsAt)) continue;
          const created = await this.offer(e, provider, s);
          if (created) { e.status = 'OFFERED'; offersCreated++; break; } // oldest fitting entry wins the slot
        }
      }
    }
    return { offersCreated, offersExpired };
  }

  private async autofillOn(p: Provider) {
    return this.flags.isEnabled('clinic.waitlist_autofill', { market: p.market, orgId: p.tenantId ?? undefined });
  }

  private async offer(e: WaitlistEntry, p: Provider, s: { startsAt: string; endsAt: string }) {
    const startsAt = new Date(s.startsAt);
    if (await this.prisma.waitlistOffer.findUnique({ where: { entryId_startsAt: { entryId: e.id, startsAt } } })) return null; // never re-offer a slot the patient already saw
    const expiresAt = new Date(Math.min(Date.now() + cfg().waitlistOfferMinutes * 60_000, startsAt.getTime()));
    const claimed = await this.prisma.waitlistEntry.updateMany({ where: { id: e.id, status: 'WAITING' }, data: { status: 'OFFERED' } });
    if (!claimed.count) return null;
    const o = await this.prisma.waitlistOffer.create({ data: { id: newId('kx_wo'), entryId: e.id, sub: e.sub, providerId: p.id, startsAt, endsAt: new Date(s.endsAt), expiresAt } });
    await this.engagement.notify(e.sub, { kind: 'WAITLIST_OFFER', params: { doctor: p.nameAr ?? p.nameEn ?? '', time: startsAt.toISOString(), until: expiresAt.toISOString() }, dedupeKey: `WAITLIST_OFFER:${o.id}` });
    return o;
  }

  async accept(sub: string, offerId: string) {
    const o = await this.prisma.waitlistOffer.findUnique({ where: { id: offerId }, include: { entry: true } });
    if (!o || o.sub !== sub) throw notFound('OFFER_NOT_FOUND', 'Offer not found');
    if (o.status !== 'OFFERED') throw conflict('OFFER_NOT_OPEN', `Offer is ${o.status}`, { status: o.status });
    if (o.expiresAt < new Date()) { await this.scan(); throw new ApiError(410, 'OFFER_EXPIRED', 'This offer expired; the slot was offered onward'); }
    try {
      const b = await this.booking.createIntent(sub, { providerId: o.providerId, typeId: o.entry.typeId, startsAt: o.startsAt.toISOString(), endsAt: o.endsAt.toISOString(), dependantId: o.entry.dependantId ?? undefined });
      await this.prisma.waitlistOffer.update({ where: { id: o.id }, data: { status: 'ACCEPTED', bookingId: b.id, respondedAt: new Date() } });
      await this.prisma.waitlistEntry.update({ where: { id: o.entryId }, data: { status: 'BOOKED' } });
      return b;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'SLOT_TAKEN') { // someone else got it: the offer is dead, the patient keeps waiting
        await this.prisma.waitlistOffer.update({ where: { id: o.id }, data: { status: 'EXPIRED', respondedAt: new Date() } });
        await this.prisma.waitlistEntry.updateMany({ where: { id: o.entryId, status: 'OFFERED' }, data: { status: 'WAITING' } });
      }
      throw e;
    }
  }

  async decline(sub: string, offerId: string) {
    const o = await this.prisma.waitlistOffer.findUnique({ where: { id: offerId } });
    if (!o || o.sub !== sub) throw notFound('OFFER_NOT_FOUND', 'Offer not found');
    if (o.status !== 'OFFERED') throw conflict('OFFER_NOT_OPEN', `Offer is ${o.status}`, { status: o.status });
    await this.prisma.waitlistOffer.update({ where: { id: o.id }, data: { status: 'DECLINED', respondedAt: new Date() } });
    await this.prisma.waitlistEntry.updateMany({ where: { id: o.entryId, status: 'OFFERED' }, data: { status: 'WAITING' } });
    return { ok: true };
  }

  /** SLOTS_CHANGED (aggregateId = clinicianId) and cancellations free capacity: try to fill from the waitlist. Never fails the webhook. */
  async onSlotsChanged(clinicianId?: string) {
    try { return await this.scan({ clinicianId }); } catch (e) { this.log.warn(`autofill scan failed: ${(e as Error).message}`); return { offersCreated: 0, offersExpired: 0 }; }
  }
}
