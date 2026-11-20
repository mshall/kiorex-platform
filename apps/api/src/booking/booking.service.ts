import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BookingIntent, Provider } from '@prisma/client';
import { createHash } from 'node:crypto';
import { cfg } from '../common/config';
import { ApiError, badRequest, conflict, forbidden, notFound, unavailable, unprocessable } from '../common/errors';
import { newId } from '../common/ids';
import { CatalogService } from '../catalog/catalog-public';
import { FlagsService } from '../control-plane/control-plane-public';
import { EngagementService } from '../engagement/engagement-public';
import { MarketService } from '../market/market-public';
import { KiorlyClient, KiorlyHttpError, KiorlyTransientError } from '../kiorly/kiorly-public';
import { OutboxService } from '../outbox/outbox-public';
import { PatientService } from '../patient/patient-public';
import { PayService } from '../pay/pay-public';
import { PrismaService } from '../prisma/prisma.service';
import { AddressService, VisitAddress } from '../address/address-public';
import { addressForLog } from '../common/district';
import { BookingStatus, fromKiorlyStatus, HomeState, isHomeEvent, isTerminal, nextHomeState, nextStatus } from './booking-state';

export interface CreateIntentInput {
  providerId: string; typeId: string; startsAt: string; endsAt?: string; dependantId?: string; channel?: 'MARKETPLACE' | 'CLINIC_LINK' | 'WHATSAPP'; bookingPageSlug?: string;
  /** Rev 2.3 (KXMHV02/03): HOME visits carry the patient's address-book entry; the fee entry of `typeId` decides the location, this only guards mismatches. */
  serviceLocation?: 'IN_CLINIC' | 'HOME'; addressId?: string; carePlanId?: string;
}
/** Home sub-state change delivered to listeners (family share, KXMHV07). Carries NO address. */
export type HomeStatusKind = 'ASSIGNED' | 'EN_ROUTE' | 'ARRIVED' | 'FINISHED' | 'ABORTED_UNSAFE' | 'CONFIRMED';
export type HomeListener = (b: BookingIntent, kind: HomeStatusKind) => Promise<void>;
export interface ConfirmInput { marketplaceConsent: boolean; remindersConsent?: boolean; notes?: string }

interface KiorlyEventCtx { type: string; aggregateId?: string; data: Record<string, any> }

@Injectable()
export class BookingService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('booking');
  private timer?: NodeJS.Timeout;
  private homeListeners: HomeListener[] = [];
  constructor(
    private readonly prisma: PrismaService, private readonly kiorly: KiorlyClient, private readonly catalog: CatalogService, private readonly flags: FlagsService,
    private readonly patients: PatientService, private readonly pay: PayService, private readonly engagement: EngagementService, private readonly outbox: OutboxService, private readonly markets: MarketService,
    private readonly addresses: AddressService,
  ) {}

  /** Other modules (family share) subscribe to home status changes without this module importing them. */
  onHomeStatus(fn: HomeListener) { this.homeListeners.push(fn); }
  private async emitHome(b: BookingIntent, kind: HomeStatusKind) {
    for (const fn of this.homeListeners) await fn(b, kind).catch((e) => this.log.warn(`home listener failed for ${b.id}: ${(e as Error).message}`));
  }

  onModuleInit() {
    this.outbox.register('pay.deposit_captured', (e) => this.onDepositCaptured(e.payload));
    this.outbox.register('pay.review_resolved', (e) => this.onReviewResolved(e.payload)); // KXMPAY07 ops decision -> booking deposit status
    this.patients.registerExport('bookings', async (sub) => (await this.prisma.bookingIntent.findMany({ where: { sub } })).map((b) => ({ id: b.id, status: b.status, startsAt: b.startsAt, providerId: b.providerId, depositStatus: b.depositStatus })));
    this.patients.registerAnonymizer('bookings', async (sub) => {
      const h = createHash('sha256').update(sub).digest('hex').slice(0, 10);
      await this.prisma.bookingIntent.updateMany({ where: { sub }, data: { patientSnapshot: undefined as never, sub: `deleted:${h}`, dependantId: null } });
    });
    if (cfg().jobsEnabled) {
      this.timer = setInterval(() => void this.expireHolds().catch((e) => this.log.warn(e.message)), 30_000);
      this.timer.unref();
      const nightly = setInterval(() => { if (new Date().getUTCHours() === 2) void this.reconcileNightly().catch(() => undefined); }, 3600_000);
      nightly.unref();
    }
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  // ───────────── helpers ─────────────

  private async ev(bookingId: string, kind: string, detail?: unknown, from?: string, to?: string) {
    await this.prisma.bookingEvent.create({ data: { bookingId, kind, fromStatus: from, toStatus: to, detail: (detail ?? undefined) as any } });
  }

  private async owned(sub: string, id: string): Promise<BookingIntent> {
    const b = await this.prisma.bookingIntent.findUnique({ where: { id } });
    if (!b || b.sub !== sub) throw notFound('BOOKING_NOT_FOUND', 'Booking not found');
    return b;
  }

  /** Guarded transition (optimistic): only moves if status is still `from`. Returns the new row or null. */
  private async move(b: BookingIntent, to: BookingStatus, patch: Record<string, unknown> = {}, detail?: unknown): Promise<BookingIntent | null> {
    const r = await this.prisma.bookingIntent.updateMany({ where: { id: b.id, status: b.status }, data: { ...patch, status: to, version: { increment: 1 }, ...(isTerminal(to) ? { terminalAt: new Date() } : {}) } });
    if (!r.count) return null;
    await this.ev(b.id, 'STATE', detail, b.status, to);
    if (isTerminal(to) && b.serviceLocation === 'HOME') await this.addresses.scheduleMask(b.id); // KXMHV10: doorstep lines hidden 24 h after the visit
    return this.prisma.bookingIntent.findUniqueOrThrow({ where: { id: b.id } });
  }

  private doctorParams(p: Provider | null, b: BookingIntent) {
    return { doctor: p?.nameAr ?? p?.nameEn ?? '', time: b.startsAt.toISOString() };
  }
  private async provider(b: BookingIntent): Promise<Provider | null> {
    return this.prisma.provider.findUnique({ where: { id: b.providerId } });
  }

  async present(b: BookingIntent) {
    const p = await this.provider(b);
    const raw: any = p?.raw ?? {};
    const timeline = (await this.prisma.bookingEvent.findMany({ where: { bookingId: b.id, kind: 'STATE' }, orderBy: { createdAt: 'asc' } })).map((e) => ({ status: e.toStatus, at: e.createdAt }));
    const pay = b.depositStatus !== 'NONE' ? await this.pay.intentForBooking(b.id) : null;
    return {
      id: b.id, status: b.status, providerId: b.providerId, clinicId: b.clinicId, typeId: b.typeId, startsAt: b.startsAt, endsAt: b.endsAt, dependantId: b.dependantId, channel: b.channel,
      holdExpiresAt: b.status === 'HELD' ? b.holdExpiresAt : null, confirmationDueAt: b.confirmationDueAt, cancelledBy: b.cancelledBy, cancellationReason: b.cancellationReason, failureCode: b.failureCode,
      callState: b.callState, depositStatus: b.depositStatus, depositAmountMinor: b.depositAmountMinor, currency: b.currency, depositRefundable: b.depositRefundable,
      deposit: pay ? { paymentId: pay.id, status: pay.status, checkoutUrl: pay.status === 'CREATED' ? pay.checkoutUrl : null } : null,
      doctor: p ? { nameEn: p.nameEn, nameAr: p.nameAr, specialty: p.specialty } : null,
      clinic: raw.clinic ? { nameEn: raw.clinic.nameEn, nameAr: raw.clinic.nameAr, addressEn: raw.clinic.addressEn, addressAr: raw.clinic.addressAr, phone: raw.clinic.phone, latitude: raw.clinic.latitude, longitude: raw.clinic.longitude } : null,
      cancellationPolicy: raw.provider?.cancellationPolicy ?? null,
      timeline, createdAt: b.createdAt,
      serviceLocation: b.serviceLocation, careType: b.careType, visitDistrict: b.visitDistrict, feeMinor: b.feeMinor,
      home: b.serviceLocation === 'HOME' ? await this.presentHome(b, p) : null,
    };
  }

  /**
   * Status timeline of a home visit WITHOUT any address/fee/payment data (shared by the patient view and the family share link):
   * Confirmed → On the way → Arrived → Finished (KXMHV06), assignee (KXMHV05), estimate only if the provider shares it.
   */
  async homeProgress(b: BookingIntent, p?: Provider | null) {
    p = p === undefined ? await this.provider(b) : p;
    const evs = await this.prisma.bookingEvent.findMany({ where: { bookingId: b.id, kind: 'STATE' }, orderBy: { createdAt: 'asc' } });
    const at = (to: string) => evs.find((e) => e.toStatus === to)?.createdAt ?? null;
    const done = b.status === 'COMPLETED';
    const arrived = b.homeState === 'ARRIVED' || b.status === 'CHECKED_IN' || done;
    const trackingOn = await this.flags.isEnabled('kiorex.visit_tracking', { market: p?.market ?? 'EG' });
    const aborted = b.homeState === 'ABORTED_UNSAFE';
    const confirmed = ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'].includes(b.status) || evs.some((e) => e.toStatus === 'CONFIRMED');
    const a: any = b.assignee ?? null;
    return {
      subState: b.homeState, trackingEnabled: trackingOn,
      steps: [
        { key: 'CONFIRMED', reached: confirmed, at: at('CONFIRMED') },
        { key: 'ON_THE_WAY', reached: !aborted && (!!b.enRouteAt || arrived), at: b.enRouteAt },
        { key: 'ARRIVED', reached: !aborted && arrived, at: b.arrivedAt ?? at('CHECKED_IN') },
        { key: 'FINISHED', reached: !aborted && done, at: done ? b.terminalAt : null },
      ],
      eta: b.homeState === 'EN_ROUTE' && b.etaMinutes != null && trackingOn ? { minutes: b.etaMinutes, shared: true } : { minutes: null, shared: false },
      assignee: a ? { displayName: a.displayName ?? null, photoUrl: a.photoUrl ?? null, badge: a.badge ?? null, profession: a.profession ?? null } : null,
      assignmentPending: !!p?.assignsClinician && !a && !isTerminal(b.status),
      aborted: aborted,
    };
  }

  /** KXMHV04-06/09/10: fee, agency assignment, status timeline with home sub-states, safety info, masked address. */
  private async presentHome(b: BookingIntent, p: Provider | null) {
    const prog = await this.homeProgress(b, p);
    const addr = await this.addresses.forBooking(b.id);
    return {
      district: b.visitDistrict, subState: prog.subState, steps: prog.steps, trackingEnabled: prog.trackingEnabled, eta: prog.eta, assignee: prog.assignee, assignmentPending: prog.assignmentPending,
      fee: { visitFeeMinor: b.feeMinor, homeSurchargeMinor: b.homeSurchargeMinor, totalMinor: (b.feeMinor ?? 0) + b.homeSurchargeMinor, currency: b.currency, depositRequired: b.depositAmountMinor > 0 },
      aborted: prog.aborted ? { abortedAt: b.abortedAt, noShow: false, depositUnderReview: b.depositStatus === 'HOLD_FOR_REVIEW' } : null,
      address: addr ?? { district: b.visitDistrict, governorate: null, masked: true, maskedAt: null, address: null },
      safety: { reportProblemSlaMinutes: Math.round(cfg().homeComplaintSlaMinutes), emergencyNumber: '123' },
    };
  }

  // ───────────── create intent + hold (KXM-BK-02) ─────────────

  async createIntent(sub: string, i: CreateIntentInput) {
    const p = await this.prisma.provider.findUnique({ where: { id: i.providerId } });
    if (!p) throw notFound('PROVIDER_NOT_FOUND', 'Provider not found');
    await this.markets.assertLive(p.market);
    await this.flags.assertEnabled('kiorex.marketplace', { market: p.market });
    if (p.tenantId && (await this.flags.evaluate('clinic.kiorex_listing', { market: p.market, orgId: p.tenantId })).reason === 'OFF_ORG') throw forbidden('FEATURE_DISABLED', 'Listing paused', { key: 'clinic.kiorex_listing', scope: 'ORG' });
    if (p.status !== 'LIVE') throw conflict('LISTING_NOT_LIVE', 'Unverified or paused listings are not bookable');
    // KXMDS01: physiotherapy / home nursing are separate launch categories (kiorex.category.*): new bookings need the category effective
    const cat = await this.catalog.careTypeEnabled(p.careType as any, p.market);
    if (!cat.enabled && cat.key) await this.flags.assertEnabled(cat.key, { market: p.market });
    // The fee entry of the visit type decides where the visit happens; HOME needs kiorex.home_visits + an address from the address book (KXMHV02/03).
    const fee = ((p.raw as any)?.provider?.fees ?? []).find((x: any) => x.appointmentTypeId === i.typeId);
    const location = (fee ? this.catalog.feeLocation(p, fee) : i.serviceLocation ?? 'IN_CLINIC') as 'IN_CLINIC' | 'HOME';
    if (i.serviceLocation && i.serviceLocation !== location) throw badRequest('SERVICE_LOCATION_MISMATCH', `This visit type is ${location}`, { serviceLocation: location });
    const home = location === 'HOME';
    let visit: VisitAddress | undefined;
    let addressRow: Awaited<ReturnType<AddressService['resolveForBooking']>>['row'] | undefined;
    if (home) {
      await this.flags.assertEnabled('kiorex.home_visits', { market: p.market });
      if (!this.catalog.isHomeEnabled(p)) throw conflict('HOME_NOT_OFFERED', 'This provider does not offer home visits');
      if (!i.addressId) throw badRequest('ADDRESS_REQUIRED', 'Home visits need an address from your address book (addressId)');
      const r = await this.addresses.resolveForBooking(sub, i.addressId);
      visit = r.visit; addressRow = r.row;
      if (!this.catalog.coversDistrict(p, r.row.district)) throw await this.catalog.outOfCoverage(p, r.row.district);
    }
    if (i.dependantId) await this.patients.assertGuardian(sub, i.dependantId);
    if (this.kiorly.isCircuitOpen(p.clinicId)) throw unavailable('CLINIC_SYSTEM_BUSY', 'Clinic system busy; new holds are paused for this clinic', { retryable: true });
    const start = new Date(i.startsAt);
    if (Number.isNaN(start.getTime()) || start <= new Date()) throw badRequest('INVALID_START', 'startsAt must be a future time');
    const dep = (await this.flags.isEnabled('kiorex.pay_deposits', { market: p.market })) ? this.catalog.depositFor(p, i.typeId, { home }) : { required: false, amountMinor: 0 };
    const id = newId('kx_bk');
    const end = i.endsAt ? new Date(i.endsAt) : new Date(start.getTime() + 30 * 60_000);
    const surcharge = home && fee?.homeSurcharge ? Math.round(Number(fee.homeSurcharge) * 100) : 0; // BR56: a separate invoice line, outside S and C
    let b = await this.prisma.bookingIntent.create({
      data: { id, sub, dependantId: i.dependantId, providerId: p.id, clinicId: p.clinicId, clinicianId: p.clinicianId, tenantId: p.tenantId, typeId: i.typeId, startsAt: start, endsAt: end, status: 'INTENT', channel: i.channel ?? 'MARKETPLACE', currency: p.currency, feeMinor: this.catalog.feeFor(p, i.typeId), depositStatus: dep.required ? 'REQUIRED' : 'NONE', depositAmountMinor: dep.amountMinor, holdExternalRef: `${id}:hold`, patientSnapshot: i.bookingPageSlug ? ({ bookingPageSlug: i.bookingPageSlug } as any) : undefined,
        serviceLocation: location, careType: p.careType, visitDistrict: addressRow?.district, homeSurchargeMinor: surcharge, carePlanId: i.carePlanId },
    });
    if (home && addressRow) await this.addresses.snapshot(id, sub, addressRow); // KXMHV03: the address lives under the patient + this encrypted snapshot, never on the provider projection
    await this.ev(id, 'INTENT', { providerId: p.id, typeId: i.typeId, serviceLocation: location, ...(home ? { address: addressForLog({ district: addressRow?.district, governorate: addressRow?.governorate }) } : {}), ...((dep as any).policy ? { depositPolicy: (dep as any).policy } : {}) });
    await this.catalog.track('hold_created', { providerId: p.id, specialtyCode: p.specialty ?? undefined, careType: p.careType, serviceLocation: location, district: addressRow?.district });
    try {
      const { data } = await this.kiorly.createHold({ clinicId: p.clinicId, clinicianId: p.clinicianId, typeId: i.typeId, startsAt: start.toISOString(), endsAt: end.toISOString(), externalRef: b.holdExternalRef!, ...(visit ? { visitAddress: visit } : {}) });
      await this.ev(id, 'KIORLY_CALL', { call: 'POST /holds', holdId: data.id });
      const exp = data.expiresAt ? new Date(data.expiresAt) : new Date(Date.now() + cfg().holdMinutes * 60_000);
      b = (await this.move(b, 'HELD', { holdId: data.id, holdExpiresAt: exp }, { holdId: data.id })) ?? b;
    } catch (e) {
      if (e instanceof KiorlyHttpError && e.status === 409) {
        await this.move(b, 'EXPIRED', { failureCode: 'SLOT_TAKEN' }, { alternatives: e.body?.alternatives });
        throw new ApiError(409, 'SLOT_TAKEN', 'Slot taken', { bookingId: id, alternatives: e.body?.alternatives ?? e.body?.message?.alternatives ?? [] });
      }
      if (e instanceof KiorlyHttpError && e.status === 422 && (e.code === 'OUT_OF_COVERAGE' || e.body?.code === 'OUT_OF_COVERAGE')) {
        await this.move(b, 'EXPIRED', { failureCode: 'OUT_OF_COVERAGE' }, { district: addressRow?.district });
        await this.catalog.track('home_out_of_coverage', { providerId: p.id, careType: p.careType, serviceLocation: 'HOME', district: addressRow?.district });
        throw await this.catalog.outOfCoverage(p, addressRow?.district, e.body?.alternatives);
      }
      if (e instanceof KiorlyTransientError) {
        await this.move(b, 'EXPIRED', { failureCode: 'CLINIC_SYSTEM_BUSY' }, { error: e.kind });
        throw unavailable('CLINIC_SYSTEM_BUSY', 'Clinic system busy, try again shortly', { retryable: true });
      }
      if (e instanceof KiorlyHttpError) { await this.move(b, 'EXPIRED', { failureCode: e.code ?? `KIORLY_${e.status}` }, e.body); throw unprocessable(e.code ?? 'HOLD_REJECTED', 'Clinic rejected the hold'); }
      throw e;
    }
    return this.present(b);
  }

  async release(sub: string, id: string) {
    const b = await this.owned(sub, id);
    if (b.status !== 'HELD') return this.present(b);
    if (b.holdId) await this.kiorly.releaseHold(b.clinicId, b.holdId).catch(() => undefined); // 404 = already expired
    return this.present((await this.move(b, 'EXPIRED', { failureCode: 'RELEASED_BY_PATIENT' })) ?? b);
  }

  // ───────────── idempotent confirm (KXM-BK-03/05/06) ─────────────

  async confirm(sub: string, id: string, c: ConfirmInput) {
    let b = await this.owned(sub, id);
    await this.flags.assertEnabled('kiorex.marketplace', { market: 'EG' });
    if (['PENDING_CLINIC', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED'].includes(b.status)) return this.present(b); // double click: same result
    if (b.status !== 'HELD') throw conflict('BOOKING_NOT_CONFIRMABLE', `Booking is ${b.status}`, { status: b.status, failureCode: b.failureCode });
    if (!c.marketplaceConsent) throw badRequest('CONSENT_REQUIRED', 'Marketplace processing consent is required to book');
    if (b.callState === 'NONE' && b.holdExpiresAt && b.holdExpiresAt < new Date()) {
      await this.move(b, 'EXPIRED', { failureCode: 'HOLD_EXPIRED' });
      throw new ApiError(422, 'HOLD_EXPIRED', 'Hold expired', { bookingId: id, alternatives: await this.alternatives(b) });
    }
    await this.patients.setConsent(sub, 'MARKETPLACE_PROCESSING', true, 'booking');
    if (c.remindersConsent !== undefined) await this.patients.setConsent(sub, 'REMINDERS', c.remindersConsent, 'booking');
    // BK-05: if a previous attempt's outcome is unknown, ask Kiorly by reference FIRST (never mint a new key).
    if (b.callState === 'UNCERTAIN') {
      const found = await this.lookup(b);
      if (found === 'ADOPTED') return this.present(await this.prisma.bookingIntent.findUniqueOrThrow({ where: { id } }));
      if (found === 'UNAVAILABLE') throw unavailable('CLINIC_SYSTEM_BUSY', 'Clinic system busy; your booking is pending and will be retried', { bookingId: id, status: 'HELD', retryable: true });
    }
    const identity = await this.patients.bookingIdentity(sub, b.dependantId ?? undefined);
    await this.prisma.bookingIntent.update({ where: { id }, data: { callState: 'IN_FLIGHT', patientSnapshot: { forDependant: identity.forDependant } as any } });
    const body = {
      clinicId: b.clinicId, clinicianId: b.clinicianId, typeId: b.typeId, startsAt: b.startsAt.toISOString(), endsAt: b.endsAt.toISOString(), holdId: b.holdId ?? undefined, holdExternalRef: b.holdExternalRef ?? undefined,
      patient: { phone: identity.phone, firstNameEn: identity.firstNameEn, lastNameEn: identity.lastNameEn, gender: identity.gender, nationalId: identity.nationalId, email: identity.email },
      notes: c.notes, marketplaceConsentGranted: true, remindersConsentGranted: !!c.remindersConsent, attribution: { source: b.channel === 'WHATSAPP' ? 'kiorex_whatsapp' : 'kiorex' },
      ...(b.serviceLocation === 'HOME' ? { serviceLocation: 'HOME' } : {}), // the address itself is carried from the hold (KX-09 §03/§08): not re-sent
      // KXM-BK-11: Kiorly's marketplace API accepts MARKETPLACE|CLINIC_LINK today; KIOREX_WHATSAPP is sent only once Kiorly accepts it (KIORLY_ACCEPTS_WHATSAPP_CHANNEL)
      channel: b.channel === 'CLINIC_LINK' ? 'CLINIC_LINK' : b.channel === 'WHATSAPP' && cfg().kiorlyAcceptsWhatsappChannel ? 'KIOREX_WHATSAPP' : 'MARKETPLACE', ...(b.channel === 'CLINIC_LINK' ? { bookingPageSlug: (b.patientSnapshot as any)?.bookingPageSlug } : {}),
    };
    try {
      const { data } = await this.kiorly.createBooking(b.id, body); // Idempotency-Key = Kiorex booking id
      await this.ev(id, 'KIORLY_CALL', { call: 'POST /bookings', status: data.status });
      await this.adopt(id, data, { evidence: identity.nationalId ? 'PHONE_AND_NATIONAL_ID' : 'PHONE' });
    } catch (e) {
      await this.handleConfirmError(b, e);
    }
    return this.present(await this.prisma.bookingIntent.findUniqueOrThrow({ where: { id } }));
  }

  private async handleConfirmError(b: BookingIntent, e: unknown): Promise<never> {
    if (e instanceof KiorlyHttpError) {
      await this.prisma.bookingIntent.update({ where: { id: b.id }, data: { callState: 'NONE' } });
      const cur = await this.prisma.bookingIntent.findUniqueOrThrow({ where: { id: b.id } });
      if (e.status === 409 && (e.code === 'SLOT_TAKEN' || e.body?.code === 'SLOT_TAKEN')) {
        await this.move(cur, 'EXPIRED', { failureCode: 'SLOT_TAKEN' }, { alternatives: e.body?.alternatives });
        await this.catalog.track('booking_failed', { code: 'SLOT_TAKEN' });
        throw new ApiError(409, 'SLOT_TAKEN', 'Slot taken', { bookingId: b.id, alternatives: e.body?.alternatives ?? [] });
      }
      if (e.status === 422 && (e.code === 'OUT_OF_COVERAGE' || e.body?.code === 'OUT_OF_COVERAGE')) {
        // zone changed after the hold (KX-09 §08): release the hold and show in-zone alternatives
        if (cur.holdId) await this.kiorly.releaseHold(cur.clinicId, cur.holdId).catch(() => undefined);
        await this.move(cur, 'EXPIRED', { failureCode: 'OUT_OF_COVERAGE' }, { district: cur.visitDistrict });
        await this.catalog.track('home_out_of_coverage', { providerId: cur.providerId, careType: cur.careType, serviceLocation: 'HOME', district: cur.visitDistrict });
        const p = await this.provider(cur);
        throw p ? await this.catalog.outOfCoverage(p, cur.visitDistrict, e.body?.alternatives) : new ApiError(422, 'OUT_OF_COVERAGE', 'Out of coverage');
      }
      if (e.status === 409 && e.code === 'PATIENT_IDENTITY_CONFLICT') {
        await this.patients.recordIdentityConflict(b.sub, b.clinicId, 'PATIENT_IDENTITY_CONFLICT'); // never auto-merge (AC-07)
        await this.move(cur, 'EXPIRED', { failureCode: 'PATIENT_IDENTITY_CONFLICT' });
        throw conflict('PATIENT_IDENTITY_CONFLICT', 'Your details match more than one clinic record; support will review (no automatic merge)');
      }
      await this.move(cur, 'EXPIRED', { failureCode: e.code ?? `KIORLY_${e.status}` }, e.body);
      await this.catalog.track('booking_failed', { code: e.code ?? String(e.status) });
      throw new ApiError(422, e.code ?? 'BOOKING_REJECTED', 'Clinic could not accept the booking', { bookingId: b.id, alternatives: await this.alternatives(cur) });
    }
    // timeout / network / 5xx / circuit: outcome unknown → GET by ref before any retry; never a new key
    await this.prisma.bookingIntent.update({ where: { id: b.id }, data: { callState: 'UNCERTAIN' } });
    await this.ev(b.id, 'KIORLY_CALL', { call: 'POST /bookings', outcome: 'UNKNOWN', error: (e as Error).message });
    const found = await this.lookup(b);
    if (found === 'ADOPTED') return undefined as never;
    throw unavailable('CLINIC_SYSTEM_BUSY', 'Clinic system busy; your booking is pending and will be confirmed shortly', { bookingId: b.id, status: 'HELD', retryable: true });
  }

  /** GET /bookings/:ref. ADOPTED = Kiorly has it; NOT_CREATED = 404; UNAVAILABLE = could not ask. */
  private async lookup(b: BookingIntent): Promise<'ADOPTED' | 'NOT_CREATED' | 'UNAVAILABLE'> {
    try {
      const { data } = await this.kiorly.getBooking(b.id, b.clinicId);
      await this.ev(b.id, 'KIORLY_CALL', { call: 'GET /bookings/:ref', status: data.status });
      await this.adopt(b.id, data, { evidence: 'PHONE' });
      return 'ADOPTED';
    } catch (e) {
      if (e instanceof KiorlyHttpError && e.status === 404) return 'NOT_CREATED'; // stays UNCERTAIN: the original request may still be in flight
      return 'UNAVAILABLE';
    }
  }

  /** Persist Kiorly's answer (appointment id, status) and run side effects once. */
  private async adopt(id: string, data: any, o: { evidence: 'PHONE' | 'NATIONAL_ID' | 'PHONE_AND_NATIONAL_ID' }) {
    const b = await this.prisma.bookingIntent.findUniqueOrThrow({ where: { id } });
    const target = fromKiorlyStatus(data.status) ?? 'CONFIRMED';
    if (data.patientId) await this.patients.linkKiorlyPatient({ sub: b.sub, dependantId: b.dependantId ?? undefined, clinicId: b.clinicId, kiorlyPatientId: data.patientId, evidence: o.evidence });
    const patch = { kiorlyAppointmentId: data.appointmentId ?? b.kiorlyAppointmentId, kiorlyPatientId: data.patientId ?? b.kiorlyPatientId, confirmationDueAt: data.marketplaceConfirmationDueAt ? new Date(data.marketplaceConfirmationDueAt) : null, callState: 'NONE', failureCode: null };
    if (b.status === 'HELD' || b.status === 'INTENT') {
      const moved = await this.move(b, target === 'CONFIRMED' || target === 'PENDING_CLINIC' ? target : 'CONFIRMED', patch);
      if (moved) await this.sideEffects(moved, moved.status === 'CONFIRMED' ? 'APPOINTMENT_CONFIRMED' : 'PENDING', {});
      if (moved) await this.catalog.track('booking_confirmed', { providerId: moved.providerId });
      if (moved && target !== 'CONFIRMED' && target !== 'PENDING_CLINIC') await this.applyStatus(moved, target, 'RECONCILE', {});
    } else {
      await this.prisma.bookingIntent.update({ where: { id }, data: patch });
      await this.applyStatus(b, target, 'RECONCILE', {});
    }
  }

  private async alternatives(b: BookingIntent): Promise<{ startsAt: string; endsAt: string }[]> {
    try {
      const p = await this.provider(b);
      if (!p) return [];
      const from = new Date();
      this.catalog.invalidateSlots(p.clinicianId);
      const home = b.serviceLocation === 'HOME';
      return (await this.catalog.slots(p, b.typeId, from, new Date(from.getTime() + 7 * 86400_000), home ? { serviceLocation: 'HOME', district: b.visitDistrict ?? undefined } : {})).slice(0, 3);
    } catch { return []; }
  }

  // ───────────── cancel / reschedule (KXM-BK-07/08) ─────────────

  async cancel(sub: string, id: string, reason?: string) {
    const b = await this.owned(sub, id);
    if (b.status === 'HELD') return this.release(sub, id);
    if (!['PENDING_CLINIC', 'CONFIRMED'].includes(b.status)) throw unprocessable('BOOKING_NOT_CHANGEABLE', `Booking is ${b.status}`);
    try {
      const { data } = await this.kiorly.cancelBooking(b.id, reason, b.clinicId);
      await this.ev(id, 'KIORLY_CALL', { call: 'POST /cancel', depositRefundable: data?.depositRefundable });
      await this.applyEvent({ type: 'CANCELLED_BY_PATIENT', data: { externalReference: id, cancelledBy: 'PATIENT', cancellationReason: reason, depositRefundable: data?.depositRefundable } });
    } catch (e) {
      if (e instanceof KiorlyHttpError) throw new ApiError(e.status === 404 ? 404 : 422, e.code ?? e.body?.message?.code ?? (e.status === 404 ? 'BOOKING_NOT_FOUND' : 'CANCELLATION_REJECTED'), e.body?.message?.message ?? 'Cancellation rejected', { code: e.code });
      throw unavailable('CLINIC_SYSTEM_BUSY', 'Clinic system busy', { retryable: true });
    }
    return this.present(await this.prisma.bookingIntent.findUniqueOrThrow({ where: { id } }));
  }

  async reschedule(sub: string, id: string, i: { startsAt: string; endsAt?: string }) {
    const b = await this.owned(sub, id);
    if (b.status !== 'CONFIRMED') throw unprocessable('BOOKING_NOT_CHANGEABLE', `Booking is ${b.status}`);
    try {
      const { data } = await this.kiorly.rescheduleBooking(b.id, i, b.clinicId);
      await this.ev(id, 'KIORLY_CALL', { call: 'POST /reschedule' });
      await this.applyEvent({ type: 'RESCHEDULED', data: { externalReference: id, startsAt: data?.startsAt ?? i.startsAt, endsAt: data?.endsAt ?? i.endsAt } });
    } catch (e) {
      if (e instanceof KiorlyHttpError) {
        if (e.status === 409) throw new ApiError(409, 'SLOT_TAKEN', 'Slot taken', { alternatives: e.body?.alternatives ?? [] });
        throw new ApiError(422, e.code ?? e.body?.message?.code ?? 'RESCHEDULE_REJECTED', 'Reschedule rejected');
      }
      throw unavailable('CLINIC_SYSTEM_BUSY', 'Clinic system busy', { retryable: true });
    }
    return this.present(await this.prisma.bookingIntent.findUniqueOrThrow({ where: { id } }));
  }

  async depositCheckout(sub: string, id: string) {
    const b = await this.owned(sub, id);
    if (b.depositStatus !== 'REQUIRED') throw conflict('NO_DEPOSIT_DUE', 'No deposit is due for this booking');
    if (!['PENDING_CLINIC', 'CONFIRMED'].includes(b.status)) throw conflict('BOOKING_NOT_PAYABLE', `Booking is ${b.status}`);
    await this.flags.assertEnabled('kiorex.pay_deposits', { market: 'EG' });
    const p = await this.pay.createDepositIntent({ bookingId: b.id, sub, clinicId: b.clinicId, amountMinor: b.depositAmountMinor, currency: b.currency });
    await this.ev(id, 'PAYMENT', { paymentId: p.id });
    return { paymentId: p.id, checkoutUrl: p.checkoutUrl, amountMinor: p.amountMinor, currency: p.currency };
  }

  async list(sub: string, status?: string) {
    const rows = await this.prisma.bookingIntent.findMany({ where: { sub, ...(status ? { status } : {}), NOT: { status: 'INTENT' } }, orderBy: { startsAt: 'desc' }, take: 100 });
    return Promise.all(rows.map((b) => this.present(b)));
  }
  async get(sub: string, id: string) { return this.present(await this.owned(sub, id)); }

  async ics(sub: string, id: string): Promise<string> {
    const b = await this.owned(sub, id);
    const p = await this.provider(b);
    const f = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kiorex//Booking//EN', 'BEGIN:VEVENT', `UID:${b.id}@kiorex.com`, `DTSTAMP:${f(new Date())}`, `DTSTART:${f(b.startsAt)}`, `DTEND:${f(b.endsAt)}`, `SUMMARY:Kiorex visit ${p?.nameEn ?? ''}`.trim(), 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  }

  // ───────────── Kiorly events → transitions + side effects (KX-03 §05 table) ─────────────

  async applyEvent(ev: KiorlyEventCtx): Promise<'APPLIED' | 'IGNORED' | 'UNKNOWN_BOOKING'> {
    const ref: string | undefined = ev.data.externalReference ?? ev.data.metadata?.externalReference;
    let b = ref ? await this.prisma.bookingIntent.findUnique({ where: { id: ref } }) : null;
    const apptId = ev.data.appointmentId ?? (ev.type !== 'SLOTS_CHANGED' ? ev.aggregateId : undefined);
    if (!b && apptId) b = await this.prisma.bookingIntent.findFirst({ where: { kiorlyAppointmentId: apptId } });
    if (!b) return 'UNKNOWN_BOOKING';
    const meta = { ...(ev.data.metadata ?? {}), ...ev.data };
    if (isHomeEvent(ev.type)) return this.applyHomeEvent(b, ev.type, meta);
    if (ev.type === 'RESCHEDULED' || ev.type === 'APPOINTMENT_RESCHEDULED') {
      if (b.status !== 'CONFIRMED' && b.status !== 'PENDING_CLINIC') return 'IGNORED';
      const startsAt = meta.startsAt ? new Date(meta.startsAt) : b.startsAt;
      const endsAt = meta.endsAt ? new Date(meta.endsAt) : new Date(startsAt.getTime() + (b.endsAt.getTime() - b.startsAt.getTime()));
      const upd = await this.prisma.bookingIntent.update({ where: { id: b.id }, data: { startsAt, endsAt, version: { increment: 1 } } });
      await this.ev(b.id, 'WEBHOOK', { type: ev.type, startsAt, endsAt });
      await this.sideEffects(upd, 'RESCHEDULED', {});
      return 'APPLIED';
    }
    const to = nextStatus(b.status as BookingStatus, ev.type);
    if (!to) { await this.ev(b.id, 'WEBHOOK', { type: ev.type, ignored: true }); return 'IGNORED'; }
    await this.applyStatus(b, to, ev.type, meta);
    return 'APPLIED';
  }

  /**
   * Rev 2.3 home events (KX-03 §05): HOME_VISIT_ASSIGNED / _EN_ROUTE move the home sub-state, HOME_VISIT_ABORTED_UNSAFE cancels the booking as
   * UNSAFE (never a no-show, no patient penalty) and parks the deposit for ops review (KXMPAY07). Sub-states only move forward; stale or
   * out-of-order deliveries are ignored (the webhook layer already de-duplicates on eventId).
   */
  private async applyHomeEvent(b: BookingIntent, type: string, meta: Record<string, any>): Promise<'APPLIED' | 'IGNORED'> {
    if (b.serviceLocation !== 'HOME') { await this.ev(b.id, 'WEBHOOK', { type, ignored: true, reason: 'NOT_A_HOME_BOOKING' }); return 'IGNORED'; }
    const state = nextHomeState(b.homeState, b.status, type);
    if (!state) { await this.ev(b.id, 'WEBHOOK', { type, ignored: true, reason: 'STALE_OR_TERMINAL' }); return 'IGNORED'; }
    if (state === 'ABORTED_UNSAFE') {
      await this.applyStatus(b, 'CANCELLED', type, meta);
      return 'APPLIED';
    }
    const p = await this.provider(b);
    if (state === 'EN_ROUTE' && !(await this.flags.isEnabled('kiorex.visit_tracking', { market: p?.market ?? 'EG' }))) {
      await this.ev(b.id, 'HOME', { state, suppressed: 'kiorex.visit_tracking OFF' }); // timeline without on-the-way updates
      return 'IGNORED';
    }
    let upd: BookingIntent;
    if (state === 'ASSIGNED') {
      const a = meta.assignee ?? {};
      // whitelist: the contract forbids phone/email and carries no address; never persist anything else
      const assignee = { displayName: a.displayName ?? null, photoUrl: a.photoUrl ?? null, badge: a.badge ?? null, profession: a.profession ?? null, clinicianId: a.clinicianId ?? null };
      upd = await this.prisma.bookingIntent.update({ where: { id: b.id }, data: { assignee: assignee as any, homeState: 'ASSIGNED', version: { increment: 1 } } });
    } else {
      upd = await this.prisma.bookingIntent.update({ where: { id: b.id }, data: { homeState: 'EN_ROUTE', enRouteAt: meta.enRouteAt ? new Date(meta.enRouteAt) : new Date(), etaMinutes: typeof meta.etaMinutes === 'number' ? Math.max(0, Math.round(meta.etaMinutes)) : null, version: { increment: 1 } } });
    }
    await this.ev(b.id, 'HOME', { state });
    const kind = state === 'ASSIGNED' ? 'HOME_VISIT_ASSIGNED' : 'HOME_VISIT_EN_ROUTE';
    try {
      await this.engagement.notify(b.sub, { kind, bookingId: b.id, params: { ...this.doctorParams(p, upd), assignee: (upd.assignee as any)?.displayName ?? '', minutes: upd.etaMinutes ?? '' }, dedupeKey: `${kind.toLowerCase()}:${b.id}` });
    } catch (e) { this.log.warn(`home notification ${kind} for ${b.id} failed: ${(e as Error).message}`); }
    await this.emitHome(upd, state);
    return 'APPLIED';
  }

  /** Transition + side effects (used by events and reconciliation). */
  private async applyStatus(b: BookingIntent, to: BookingStatus, via: string, meta: Record<string, any>) {
    let cur = await this.prisma.bookingIntent.findUniqueOrThrow({ where: { id: b.id } });
    if (cur.status === to) return;
    const eventType = via === 'RECONCILE' ? ({ CONFIRMED: 'APPOINTMENT_CONFIRMED', CANCELLED: 'CANCELLED_BY_CLINIC', CHECKED_IN: 'CHECKED_IN', COMPLETED: 'COMPLETED', NO_SHOW: 'NO_SHOW', EXPIRED: 'MARKETPLACE_BOOKING_CONFIRM_TIMEOUT' } as Record<string, string>)[to] ?? via : via;
    if (via === 'RECONCILE') { const n = nextStatus(cur.status as BookingStatus, eventType); if (!n) return; to = n; }
    const patch: Record<string, unknown> = {};
    if (to === 'CANCELLED') { patch.cancelledBy = meta.cancelledBy ?? (eventType === 'CANCELLED_BY_PATIENT' ? 'PATIENT' : 'CLINIC'); patch.cancellationReason = meta.cancellationReason ?? null; patch.depositRefundable = typeof meta.depositRefundable === 'boolean' ? meta.depositRefundable : null; }
    if (eventType === 'HOME_VISIT_ABORTED_UNSAFE') { Object.assign(patch, { cancelledBy: 'SAFETY', cancellationReason: 'UNSAFE_ABORT', depositRefundable: null, homeState: 'ABORTED_UNSAFE', abortedAt: meta.abortedAt ? new Date(meta.abortedAt) : new Date() }); }
    const moved = await this.move(cur, to, patch, { via: eventType });
    if (!moved) return;
    await this.sideEffects(moved, eventType, meta);
  }

  private async sideEffects(b: BookingIntent, type: string, meta: Record<string, any>) {
    const p = await this.provider(b);
    const params = this.doctorParams(p, b);
    const notify = (kind: any, key: string, extra: Record<string, unknown> = {}) => this.engagement.notify(b.sub, { kind, bookingId: b.id, params: { ...params, ...extra }, dedupeKey: `${key}:${b.id}` });
    try {
      switch (type) {
        case 'PENDING': await notify('BOOKING_PENDING_CLINIC', 'pending'); break;
        case 'APPOINTMENT_CONFIRMED':
          await notify('BOOKING_CONFIRMED', 'confirmed');
          await this.engagement.scheduleBookingReminders({ id: b.id, sub: b.sub, startsAt: b.startsAt }, params);
          break;
        case 'RESCHEDULED':
          await this.engagement.cancelBookingMessages(b.id);
          await this.engagement.notify(b.sub, { kind: 'BOOKING_CHANGED', bookingId: b.id, params, dedupeKey: `changed:${b.id}:${b.startsAt.getTime()}` });
          await this.engagement.scheduleBookingReminders({ id: b.id, sub: b.sub, startsAt: b.startsAt }, params);
          break;
        case 'CANCELLED_BY_CLINIC': case 'CANCELLED_BY_PATIENT': {
          await this.engagement.cancelBookingMessages(b.id);
          await this.settleDepositOnCancel(b, type, meta);
          if (type === 'CANCELLED_BY_CLINIC') {
            const alts = (await this.alternatives(b)).map((s) => s.startsAt).join(', ');
            await notify('BOOKING_CANCELLED_BY_CLINIC', 'cancelled', { alternatives: alts }); // apology + 3 alternatives
          } else await notify('BOOKING_CANCELLED', 'cancelled');
          break;
        }
        case 'MARKETPLACE_BOOKING_CONFIRM_TIMEOUT':
          await this.engagement.cancelBookingMessages(b.id);
          await this.settleDepositOnCancel(b, 'CANCELLED_BY_CLINIC', {});
          await notify('BOOKING_EXPIRED', 'expired');
          break;
        case 'CHECKED_IN':
          await this.catalog.track('visit_checked_in', this.analyticsDims(b));
          if (b.serviceLocation === 'HOME') { // home: Kiorly attributes attendance by the arrival geostamp (KX-09 §06); here it is the "Arrived" step
            const upd = await this.prisma.bookingIntent.update({ where: { id: b.id }, data: { homeState: 'ARRIVED', arrivedAt: new Date() } });
            await this.ev(b.id, 'HOME', { state: 'ARRIVED' });
            await this.emitHome(upd, 'ARRIVED');
          }
          break;
        case 'COMPLETED': {
          await this.catalog.track('visit_attended', this.analyticsDims(b));
          if (b.depositStatus === 'PAID') { await this.pay.releaseForBooking(b.id, 'COMPLETED'); await this.prisma.bookingIntent.update({ where: { id: b.id }, data: { depositStatus: 'RELEASED' } }); }
          // KXMHV08: a care plan asks for a review after the FIRST completed visit and at plan end, not after every visit
          const skipInvite = !!b.carePlanId && (await this.prisma.bookingIntent.count({ where: { carePlanId: b.carePlanId, status: 'COMPLETED' } })) > 1;
          if (!skipInvite) await this.engagement.scheduleReviewInvite({ id: b.id, sub: b.sub }, params);
          if (b.serviceLocation === 'HOME') await this.emitHome(b, 'FINISHED');
          break;
        }
        case 'HOME_VISIT_ABORTED_UNSAFE': // BR61 / KXMPAY07: not a no-show (no counter, no forfeiture); the deposit waits for an ops decision
          await this.engagement.cancelBookingMessages(b.id);
          await this.holdDepositForReview(b);
          await this.catalog.track('aborted_unsafe', this.analyticsDims(b));
          await notify('HOME_VISIT_ABORTED', 'aborted-unsafe');
          await this.emitHome(b, 'ABORTED_UNSAFE');
          break;
        case 'NO_SHOW':
          await this.catalog.track('no_show', this.analyticsDims(b));
          await this.patients.incrementNoShow(b.sub);
          if (b.depositStatus === 'PAID') { await this.pay.releaseForBooking(b.id, 'FORFEITED'); await this.prisma.bookingIntent.update({ where: { id: b.id }, data: { depositStatus: 'FORFEITED' } }); }
          break;
      }
    } catch (e) {
      this.log.error(`side effect ${type} for ${b.id} failed: ${(e as Error).message}`);
      await this.ev(b.id, 'WEBHOOK', { sideEffectError: (e as Error).message, type });
    }
  }

  /** Analytics dimensions (Rev 2.3): care type, visit location and DISTRICT only; never an address. */
  private analyticsDims(b: BookingIntent) { return { providerId: b.providerId, careType: b.careType, serviceLocation: b.serviceLocation, district: b.visitDistrict }; }

  /** KXMPAY07: park the captured deposit in the review hold; an unpaid deposit intent is simply cancelled. */
  private async holdDepositForReview(b: BookingIntent) {
    if (b.depositStatus === 'NONE') return;
    const p = await this.pay.holdForReview(b.id, 'UNSAFE_ABORT');
    await this.prisma.bookingIntent.update({ where: { id: b.id }, data: { depositStatus: p?.reviewState === 'HELD_FOR_REVIEW' ? 'HOLD_FOR_REVIEW' : 'NONE' } });
    await this.ev(b.id, 'PAYMENT', { holdForReview: !!p });
  }

  /** Ops decided on a held deposit (release to provider / refund to patient). */
  private async onReviewResolved(p: { bookingId?: string; outcome: 'RELEASED' | 'REFUNDED' }) {
    if (!p.bookingId) return;
    const b = await this.prisma.bookingIntent.findUnique({ where: { id: p.bookingId } });
    if (!b) return;
    await this.prisma.bookingIntent.update({ where: { id: b.id }, data: { depositStatus: p.outcome === 'REFUNDED' ? 'REFUNDED' : 'RELEASED' } });
    await this.ev(b.id, 'PAYMENT', { reviewResolved: p.outcome });
    if (p.outcome === 'REFUNDED') await this.engagement.notify(b.sub, { kind: 'DEPOSIT_REFUNDED', bookingId: b.id, dedupeKey: `deposit-refunded-review:${b.id}` }).catch(() => undefined);
  }

  /** PAY-02: refund automatically when depositRefundable=true; clinic/system cancellations always refund. Absent flag → ask Kiorly, else ops review (NEEDS_HUMAN policy). */
  private async settleDepositOnCancel(b: BookingIntent, type: string, meta: Record<string, any>) {
    if (b.depositStatus === 'NONE') return;
    let refundable: boolean | null | undefined = type === 'CANCELLED_BY_CLINIC' ? true : meta.depositRefundable;
    if (refundable === undefined || refundable === null) {
      try { refundable = (await this.kiorly.getBooking(b.id, b.clinicId)).data?.depositRefundable; } catch { /* fall through */ }
    }
    if (refundable === true) {
      await this.pay.refundForBooking(b.id, type === 'CANCELLED_BY_CLINIC' ? 'CLINIC_CANCELLED' : 'PATIENT_CANCELLED_REFUNDABLE');
      await this.prisma.bookingIntent.update({ where: { id: b.id }, data: { depositStatus: b.depositStatus === 'REQUIRED' ? 'NONE' : 'REFUNDED', depositRefundable: true } });
    } else if (refundable === false) {
      await this.pay.releaseForBooking(b.id, 'FORFEITED');
      await this.prisma.bookingIntent.update({ where: { id: b.id }, data: { depositStatus: b.depositStatus === 'PAID' ? 'FORFEITED' : b.depositStatus, depositRefundable: false } });
    } else {
      await this.prisma.auditLog.create({ data: { actor: 'system', action: 'booking.refund_policy_review', resource: 'BookingIntent', resourceId: b.id, metadata: { note: 'NEEDS_HUMAN: depositRefundable absent; cancellation-policy fallback undefined' } } });
    }
  }

  /** Payment captured: if the booking is already dead, refund automatically (KX-09 §05). */
  private async onDepositCaptured(p: { bookingId?: string }) {
    if (!p.bookingId) return;
    const b = await this.prisma.bookingIntent.findUnique({ where: { id: p.bookingId } });
    if (!b) return;
    if (b.depositStatus === 'HOLD_FOR_REVIEW') return; // already parked for ops review (KXMPAY07)
    if (['CANCELLED', 'EXPIRED', 'INTENT'].includes(b.status)) {
      await this.pay.refundForBooking(b.id, 'CAPTURED_FOR_INACTIVE_BOOKING');
      await this.prisma.bookingIntent.update({ where: { id: b.id }, data: { depositStatus: 'REFUNDED' } });
      await this.prisma.auditLog.create({ data: { actor: 'system', action: 'booking.payment_without_booking', resource: 'BookingIntent', resourceId: b.id } });
    } else {
      await this.prisma.bookingIntent.update({ where: { id: b.id }, data: { depositStatus: b.depositStatus === 'FORFEITED' ? 'FORFEITED' : 'PAID' } });
      await this.ev(b.id, 'PAYMENT', { captured: true });
    }
  }

  // ───────────── jobs ─────────────

  async expireHolds(): Promise<number> {
    const rows = await this.prisma.bookingIntent.findMany({ where: { status: 'HELD', callState: 'NONE', holdExpiresAt: { lt: new Date() } }, take: 200 });
    for (const b of rows) await this.move(b, 'EXPIRED', { failureCode: 'HOLD_EXPIRED' });
    return rows.length;
  }

  /** Nightly: non-terminal intents idle > 24 h (and unresolved uncertain calls) are re-read via GET /bookings/:ref (KX-09 §05). */
  async reconcileNightly(now = new Date()) {
    const cutoff = new Date(now.getTime() - 24 * 3600_000);
    const rows = await this.prisma.bookingIntent.findMany({
      where: { OR: [{ status: { in: ['HELD', 'PENDING_CLINIC', 'CONFIRMED', 'CHECKED_IN'] }, updatedAt: { lt: cutoff } }, { callState: 'UNCERTAIN', updatedAt: { lt: new Date(now.getTime() - 5 * 60_000) } }] },
      take: 500,
    });
    let corrected = 0, missing = 0, errors = 0;
    const disc: unknown[] = [];
    for (const b of rows) {
      try {
        const { data } = await this.kiorly.getBooking(b.id, b.clinicId);
        const target = fromKiorlyStatus(data.status);
        if (data.appointmentId && !b.kiorlyAppointmentId) await this.prisma.bookingIntent.update({ where: { id: b.id }, data: { kiorlyAppointmentId: data.appointmentId, kiorlyPatientId: data.patientId ?? undefined, callState: 'NONE' } });
        if (target && target !== b.status) {
          if (b.status === 'HELD') await this.adopt(b.id, data, { evidence: 'PHONE' });
          else await this.applyStatus(b, target, 'RECONCILE', { cancelledBy: data.cancelledBy, cancellationReason: data.cancellationReason, depositRefundable: data.depositRefundable });
          corrected++;
          disc.push({ bookingId: b.id, ours: b.status, kiorly: data.status });
        } else await this.prisma.bookingIntent.update({ where: { id: b.id }, data: { updatedAt: new Date() } });
      } catch (e) {
        if (e instanceof KiorlyHttpError && e.status === 404) {
          missing++;
          if (b.status === 'HELD') await this.move(b, 'EXPIRED', { failureCode: 'NEVER_CREATED', callState: 'NONE' });
          else disc.push({ bookingId: b.id, ours: b.status, kiorly: 'NOT_FOUND' });
        } else errors++;
      }
    }
    // dead bookings that still hold a captured deposit → refund
    const stuck = await this.prisma.bookingIntent.findMany({ where: { status: { in: ['CANCELLED', 'EXPIRED'] }, depositStatus: 'PAID' }, take: 200 });
    for (const b of stuck) { await this.pay.refundForBooking(b.id, 'DEAD_BOOKING_DEPOSIT'); await this.prisma.bookingIntent.update({ where: { id: b.id }, data: { depositStatus: 'REFUNDED' } }); }
    const run = await this.prisma.reconciliationRun.create({ data: { kind: 'BOOKING_NIGHTLY', status: disc.length || errors ? 'DISCREPANCIES' : 'OK', discrepancies: disc as any, stats: { checked: rows.length, corrected, missing, errors, refundedDead: stuck.length } } });
    return { checked: rows.length, corrected, missing, errors, runId: run.id };
  }

  // ───────────── cross-module reads ─────────────

  async completedForReview(sub: string, id: string) {
    const b = await this.owned(sub, id);
    return { id: b.id, status: b.status, providerId: b.providerId, clinicId: b.clinicId, clinicianId: b.clinicianId, kiorlyAppointmentId: b.kiorlyAppointmentId, completedAt: b.terminalAt };
  }
  async byId(id: string) { return this.prisma.bookingIntent.findUnique({ where: { id } }); }
  async byAppointmentId(appointmentId: string) { return this.prisma.bookingIntent.findFirst({ where: { kiorlyAppointmentId: appointmentId } }); }
  async ownedBooking(sub: string, id: string) { return this.owned(sub, id); }
  async providerOf(b: BookingIntent) { return this.provider(b); }

  /**
   * KXMHV08 (P3): a visit of a care plan confirmed by Kiorly (CARE_PLAN_CONFIRMED) becomes an ordinary CONFIRMED booking carrying the plan id,
   * so every later Kiorly event (HOME_VISIT_*, CHECKED_IN, COMPLETED ...) reaches it through the normal pipeline. Idempotent per appointment.
   */
  async createConfirmedVisit(i: { sub: string; planId: string; providerId: string; typeId: string; appointmentId: string; startsAt: Date; endsAt: Date; district: string | null; addressId?: string | null }): Promise<BookingIntent> {
    const dup = await this.prisma.bookingIntent.findFirst({ where: { kiorlyAppointmentId: i.appointmentId } });
    if (dup) return dup;
    const p = await this.prisma.provider.findUniqueOrThrow({ where: { id: i.providerId } });
    const fee = ((p.raw as any)?.provider?.fees ?? []).find((x: any) => x.appointmentTypeId === i.typeId);
    const id = newId('kx_bk');
    const b = await this.prisma.bookingIntent.create({ data: { id, sub: i.sub, providerId: p.id, clinicId: p.clinicId, clinicianId: p.clinicianId, tenantId: p.tenantId, typeId: i.typeId, startsAt: i.startsAt, endsAt: i.endsAt, status: 'CONFIRMED', channel: 'MARKETPLACE', currency: p.currency, feeMinor: this.catalog.feeFor(p, i.typeId), depositStatus: 'NONE', kiorlyAppointmentId: i.appointmentId, serviceLocation: 'HOME', careType: p.careType, visitDistrict: i.district, homeSurchargeMinor: fee?.homeSurcharge ? Math.round(Number(fee.homeSurcharge) * 100) : 0, carePlanId: i.planId } });
    await this.ev(id, 'STATE', { carePlan: i.planId }, 'INTENT', 'CONFIRMED');
    if (i.addressId) { const a = await this.addresses.rowFor(i.sub, i.addressId); if (a) await this.addresses.snapshot(id, i.sub, a); }
    await this.engagement.scheduleBookingReminders({ id: b.id, sub: b.sub, startsAt: b.startsAt }, this.doctorParams(p, b)).catch(() => undefined);
    return b;
  }

  /** KXMOP12: unsafe-aborted home visits (district only) with the state of their deposit. */
  async opsUnsafeAborts(limit = 100) {
    const rows = await this.prisma.bookingIntent.findMany({ where: { homeState: 'ABORTED_UNSAFE' }, orderBy: { abortedAt: 'desc' }, take: limit });
    const pays = await this.prisma.paymentIntent.findMany({ where: { bookingId: { in: rows.map((r) => r.id) } } });
    return rows.map((b) => { const pay = pays.find((p) => p.bookingId === b.id); return { bookingId: b.id, providerId: b.providerId, clinicId: b.clinicId, district: b.visitDistrict, abortedAt: b.abortedAt, noShow: false, depositStatus: b.depositStatus, paymentId: pay?.id ?? null, reviewState: pay?.reviewState ?? null, amountMinor: pay ? pay.amountMinor - pay.refundedMinor : 0 }; });
  }

  // ───────────── ops (KXM-OP-02/06) ─────────────

  async opsList(q: { status?: string; clinicId?: string; sub?: string; take?: number }) {
    return this.prisma.bookingIntent.findMany({ where: { ...(q.status ? { status: q.status } : {}), ...(q.clinicId ? { clinicId: q.clinicId } : {}), ...(q.sub ? { sub: q.sub } : {}) }, orderBy: { createdAt: 'desc' }, take: Math.min(q.take ?? 50, 200), select: { id: true, status: true, clinicId: true, providerId: true, startsAt: true, depositStatus: true, callState: true, failureCode: true, createdAt: true, updatedAt: true } });
  }
  async opsTimeline(id: string) {
    const b = await this.prisma.bookingIntent.findUnique({ where: { id } });
    if (!b) throw notFound('BOOKING_NOT_FOUND', 'Booking not found');
    const [events, payments, messages, webhooks, outbox] = await Promise.all([
      this.prisma.bookingEvent.findMany({ where: { bookingId: id }, orderBy: { createdAt: 'asc' } }),
      this.prisma.paymentIntent.findMany({ where: { bookingId: id }, include: { refunds: true } }),
      this.prisma.message.findMany({ where: { bookingId: id }, orderBy: { createdAt: 'asc' } }),
      b.kiorlyAppointmentId ? this.prisma.webhookReceipt.findMany({ where: { aggregateId: b.kiorlyAppointmentId }, orderBy: { receivedAt: 'asc' } }) : Promise.resolve([]),
      this.prisma.outboxEvent.findMany({ where: { aggregateId: { in: [id, ...(await this.prisma.paymentIntent.findMany({ where: { bookingId: id }, select: { id: true } })).map((p) => p.id)] } }, orderBy: { createdAt: 'asc' } }),
    ]);
    return { booking: { ...b, patientSnapshot: undefined }, events, payments, messages: messages.map((m) => ({ id: m.id, channel: m.channel, status: m.status, templateId: m.templateId, scheduledFor: m.scheduledFor })), webhooks: webhooks.map((w) => ({ eventId: w.eventId, type: w.type, status: w.status, at: w.receivedAt })), outbox: outbox.map((o) => ({ id: o.id, type: o.type, status: o.status, attempts: o.attempts })) };
  }
  async liquidity(days = 30) {
    const since = new Date(Date.now() - days * 86400_000);
    const [listed, live, byStatus, searches, booked, attended, noShow] = await Promise.all([
      this.prisma.provider.count(), this.prisma.provider.count({ where: { status: 'LIVE' } }),
      this.prisma.bookingIntent.groupBy({ by: ['status'], _count: true, where: { createdAt: { gte: since } } }),
      this.prisma.analyticsEvent.count({ where: { name: 'results_viewed', createdAt: { gte: since } } }),
      this.prisma.analyticsEvent.count({ where: { name: 'booking_confirmed', createdAt: { gte: since } } }),
      this.prisma.analyticsEvent.count({ where: { name: 'visit_attended', createdAt: { gte: since } } }),
      this.prisma.analyticsEvent.count({ where: { name: 'no_show', createdAt: { gte: since } } }),
    ]);
    const ev = await this.prisma.analyticsEvent.groupBy({ by: ['name', 'careType', 'serviceLocation'], _count: true, where: { createdAt: { gte: since }, name: { in: ['results_viewed', 'booking_confirmed', 'visit_attended', 'no_show', 'aborted_unsafe', 'home_visit_safety_alert'] } } });
    const byCareType = ev.map((e) => ({ name: e.name, careType: e.careType, serviceLocation: e.serviceLocation, count: e._count }));
    const homeEnabledByDistrict = await this.catalog.homeDistricts();
    const alerts = await this.prisma.safetyAlert.groupBy({ by: ['kind'], _count: true, where: { raisedAt: { gte: since } } });
    const safetyAlerts = { total: alerts.reduce((s, a) => s + a._count, 0), byKind: Object.fromEntries(alerts.map((a) => [a.kind, a._count])), unsafeAborts: await this.prisma.bookingIntent.count({ where: { homeState: 'ABORTED_UNSAFE', abortedAt: { gte: since } } }) };
    return { byCareType, homeEnabledByDistrict, safetyAlerts, windowDays: days, listedDoctors: listed, liveDoctors: live, bookingsByStatus: byStatus.map((s) => ({ status: s.status, count: s._count })), searchToBook: searches ? booked / searches : null, searches, confirmedBookings: booked, attended, noShow, noShowRate: attended + noShow ? noShow / (attended + noShow) : null, slotsPerDay: 'TODO: needs Kiorly slot count API (not in marketplace contract)' };
  }
}
