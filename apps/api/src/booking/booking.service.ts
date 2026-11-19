import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BookingIntent, Provider } from '@prisma/client';
import { createHash } from 'node:crypto';
import { cfg } from '../common/config';
import { ApiError, badRequest, conflict, forbidden, notFound, unavailable, unprocessable } from '../common/errors';
import { newId } from '../common/ids';
import { CatalogService } from '../catalog/catalog-public';
import { FlagsService } from '../control-plane/control-plane-public';
import { EngagementService } from '../engagement/engagement-public';
import { KiorlyClient, KiorlyHttpError, KiorlyTransientError } from '../kiorly/kiorly-public';
import { OutboxService } from '../outbox/outbox-public';
import { PatientService } from '../patient/patient-public';
import { PayService } from '../pay/pay-public';
import { PrismaService } from '../prisma/prisma.service';
import { BookingStatus, fromKiorlyStatus, isTerminal, nextStatus } from './booking-state';

export interface CreateIntentInput { providerId: string; typeId: string; startsAt: string; endsAt?: string; dependantId?: string; channel?: 'MARKETPLACE' | 'CLINIC_LINK'; bookingPageSlug?: string }
export interface ConfirmInput { marketplaceConsent: boolean; remindersConsent?: boolean; notes?: string }

interface KiorlyEventCtx { type: string; aggregateId?: string; data: Record<string, any> }

@Injectable()
export class BookingService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('booking');
  private timer?: NodeJS.Timeout;
  constructor(
    private readonly prisma: PrismaService, private readonly kiorly: KiorlyClient, private readonly catalog: CatalogService, private readonly flags: FlagsService,
    private readonly patients: PatientService, private readonly pay: PayService, private readonly engagement: EngagementService, private readonly outbox: OutboxService,
  ) {}

  onModuleInit() {
    this.outbox.register('pay.deposit_captured', (e) => this.onDepositCaptured(e.payload));
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
    };
  }

  // ───────────── create intent + hold (KXM-BK-02) ─────────────

  async createIntent(sub: string, i: CreateIntentInput) {
    const p = await this.prisma.provider.findUnique({ where: { id: i.providerId } });
    if (!p) throw notFound('PROVIDER_NOT_FOUND', 'Provider not found');
    await this.flags.assertEnabled('kiorex.marketplace', { market: p.market });
    if (p.tenantId && (await this.flags.evaluate('clinic.kiorex_listing', { market: p.market, orgId: p.tenantId })).reason === 'OFF_ORG') throw forbidden('FEATURE_DISABLED', 'Listing paused', { key: 'clinic.kiorex_listing', scope: 'ORG' });
    if (p.status !== 'LIVE') throw conflict('LISTING_NOT_LIVE', 'Unverified or paused listings are not bookable');
    if (i.dependantId) await this.patients.assertGuardian(sub, i.dependantId);
    if (this.kiorly.isCircuitOpen(p.clinicId)) throw unavailable('CLINIC_SYSTEM_BUSY', 'Clinic system busy; new holds are paused for this clinic', { retryable: true });
    const start = new Date(i.startsAt);
    if (Number.isNaN(start.getTime()) || start <= new Date()) throw badRequest('INVALID_START', 'startsAt must be a future time');
    const dep = (await this.flags.isEnabled('kiorex.pay_deposits', { market: p.market })) ? this.catalog.depositFor(p, i.typeId) : { required: false, amountMinor: 0 };
    const id = newId('kx_bk');
    const end = i.endsAt ? new Date(i.endsAt) : new Date(start.getTime() + 30 * 60_000);
    let b = await this.prisma.bookingIntent.create({
      data: { id, sub, dependantId: i.dependantId, providerId: p.id, clinicId: p.clinicId, clinicianId: p.clinicianId, tenantId: p.tenantId, typeId: i.typeId, startsAt: start, endsAt: end, status: 'INTENT', channel: i.channel ?? 'MARKETPLACE', currency: p.currency, feeMinor: this.catalog.feeFor(p, i.typeId), depositStatus: dep.required ? 'REQUIRED' : 'NONE', depositAmountMinor: dep.amountMinor, holdExternalRef: `${id}:hold`, patientSnapshot: i.bookingPageSlug ? ({ bookingPageSlug: i.bookingPageSlug } as any) : undefined },
    });
    await this.ev(id, 'INTENT', { providerId: p.id, typeId: i.typeId });
    await this.catalog.track('hold_created', { providerId: p.id, specialtyCode: p.specialty ?? undefined });
    try {
      const { data } = await this.kiorly.createHold({ clinicId: p.clinicId, clinicianId: p.clinicianId, typeId: i.typeId, startsAt: start.toISOString(), endsAt: end.toISOString(), externalRef: b.holdExternalRef! });
      await this.ev(id, 'KIORLY_CALL', { call: 'POST /holds', holdId: data.id });
      const exp = data.expiresAt ? new Date(data.expiresAt) : new Date(Date.now() + cfg().holdMinutes * 60_000);
      b = (await this.move(b, 'HELD', { holdId: data.id, holdExpiresAt: exp }, { holdId: data.id })) ?? b;
    } catch (e) {
      if (e instanceof KiorlyHttpError && e.status === 409) {
        await this.move(b, 'EXPIRED', { failureCode: 'SLOT_TAKEN' }, { alternatives: e.body?.alternatives });
        throw new ApiError(409, 'SLOT_TAKEN', 'Slot taken', { bookingId: id, alternatives: e.body?.alternatives ?? e.body?.message?.alternatives ?? [] });
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
      notes: c.notes, marketplaceConsentGranted: true, remindersConsentGranted: !!c.remindersConsent, attribution: { source: 'kiorex' },
      channel: b.channel === 'CLINIC_LINK' ? 'CLINIC_LINK' : 'MARKETPLACE', ...(b.channel === 'CLINIC_LINK' ? { bookingPageSlug: (b.patientSnapshot as any)?.bookingPageSlug } : {}),
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
      return (await this.catalog.slots(p, b.typeId, from, new Date(from.getTime() + 7 * 86400_000))).slice(0, 3);
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

  /** Transition + side effects (used by events and reconciliation). */
  private async applyStatus(b: BookingIntent, to: BookingStatus, via: string, meta: Record<string, any>) {
    let cur = await this.prisma.bookingIntent.findUniqueOrThrow({ where: { id: b.id } });
    if (cur.status === to) return;
    const eventType = via === 'RECONCILE' ? ({ CONFIRMED: 'APPOINTMENT_CONFIRMED', CANCELLED: 'CANCELLED_BY_CLINIC', CHECKED_IN: 'CHECKED_IN', COMPLETED: 'COMPLETED', NO_SHOW: 'NO_SHOW', EXPIRED: 'MARKETPLACE_BOOKING_CONFIRM_TIMEOUT' } as Record<string, string>)[to] ?? via : via;
    if (via === 'RECONCILE') { const n = nextStatus(cur.status as BookingStatus, eventType); if (!n) return; to = n; }
    const patch: Record<string, unknown> = {};
    if (to === 'CANCELLED') { patch.cancelledBy = meta.cancelledBy ?? (eventType === 'CANCELLED_BY_PATIENT' ? 'PATIENT' : 'CLINIC'); patch.cancellationReason = meta.cancellationReason ?? null; patch.depositRefundable = typeof meta.depositRefundable === 'boolean' ? meta.depositRefundable : null; }
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
        case 'CHECKED_IN': await this.catalog.track('visit_checked_in', { providerId: b.providerId }); break;
        case 'COMPLETED': {
          await this.catalog.track('visit_attended', { providerId: b.providerId });
          if (b.depositStatus === 'PAID') { await this.pay.releaseForBooking(b.id, 'COMPLETED'); await this.prisma.bookingIntent.update({ where: { id: b.id }, data: { depositStatus: 'RELEASED' } }); }
          await this.engagement.scheduleReviewInvite({ id: b.id, sub: b.sub }, params);
          break;
        }
        case 'NO_SHOW':
          await this.catalog.track('no_show', { providerId: b.providerId });
          await this.patients.incrementNoShow(b.sub);
          if (b.depositStatus === 'PAID') { await this.pay.releaseForBooking(b.id, 'FORFEITED'); await this.prisma.bookingIntent.update({ where: { id: b.id }, data: { depositStatus: 'FORFEITED' } }); }
          break;
      }
    } catch (e) {
      this.log.error(`side effect ${type} for ${b.id} failed: ${(e as Error).message}`);
      await this.ev(b.id, 'WEBHOOK', { sideEffectError: (e as Error).message, type });
    }
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
    return { windowDays: days, listedDoctors: listed, liveDoctors: live, bookingsByStatus: byStatus.map((s) => ({ status: s.status, count: s._count })), searchToBook: searches ? booked / searches : null, searches, confirmedBookings: booked, attended, noShow, noShowRate: attended + noShow ? noShow / (attended + noShow) : null, slotsPerDay: 'TODO: needs Kiorly slot count API (not in marketplace contract)' };
  }
}
