import { Injectable, OnModuleInit } from '@nestjs/common';
import { LabBooking, Prisma } from '../prisma/generated/client';
import { createHash } from 'node:crypto';
import { cfg } from '../common/config';
import { badRequest, conflict, forbidden, notFound, unavailable, unprocessable } from '../common/errors';
import { newId } from '../common/ids';
import { PartnerHttpError, PartnerTransientError } from '../common/partner-http';
import { EngagementService } from '../engagement/engagement-public';
import { PatientService } from '../patient/patient-public';
import { PayService } from '../pay/pay-public';
import { PrismaService } from '../prisma/prisma.service';
import { RecordsService } from '../records/records-public';
import { LabClient, LabOrderIntent } from './lab.client';

export interface LabBookInput { labId: string; testCodes: string[]; collectionType: 'HOME' | 'WALK_IN'; slot: { startsAt: string; endsAt: string }; address?: { line1: string; area?: string; governorate?: string; notes?: string; phone?: string } }
const FINAL = new Set(['RESULT_RELEASED', 'REJECTED', 'CANCELLED']);

/**
 * Lab bookings (KX-03 §08, launch-locked kiorex.lab_bookings). Kiorex owns catalogue search, booking, home-collection slot and
 * payment; Kiorly Lab owns accession, collection, QC and result release. Results arrive as LabResultReleased and land in the
 * patient vault as a signed secure link only (KLCRIT03). Take rate: NEEDS_HUMAN config LAB_TAKE_RATE_BPS (0 while unset).
 */
@Injectable()
export class LabService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService, private readonly client: LabClient, private readonly pay: PayService, private readonly records: RecordsService,
    private readonly patients: PatientService, private readonly engagement: EngagementService,
  ) {}

  onModuleInit() {
    this.pay.onOrderCaptured('LAB', (p) => this.onPaid(p.orderRef));
    this.patients.registerExport('labBookings', async (sub) => (await this.prisma.labBooking.findMany({ where: { sub } })).map((b) => ({ id: b.id, status: b.status, tests: b.tests, slotStartsAt: b.slotStartsAt, totalMinor: b.totalMinor })));
    this.patients.registerAnonymizer('labBookings', async (sub) => {
      await this.prisma.labBooking.updateMany({ where: { sub }, data: { address: Prisma.DbNull, sub: `deleted:${createHash('sha256').update(sub).digest('hex').slice(0, 10)}` } });
    });
  }

  private async partner<T>(fn: () => Promise<{ data: T }>): Promise<T> {
    try { return (await fn()).data; } catch (e) {
      if (e instanceof PartnerTransientError) throw unavailable('LAB_SYSTEM_BUSY', 'Lab system busy, try again shortly', { retryable: true });
      // the partner switched the capability OFF on its side (e.g. pharmacy.kiorex_orders): surface the universal FEATURE_DISABLED {key,scope}
      if (e instanceof PartnerHttpError && e.status === 403 && e.code === 'FEATURE_DISABLED') throw forbidden('FEATURE_DISABLED', 'This capability is temporarily unavailable at the partner', { key: e.body?.key, scope: e.body?.scope, partner: 'Lab'.toLowerCase() });
      if (e instanceof PartnerHttpError) throw unprocessable(e.code ?? 'LAB_REJECTED', 'Lab rejected the request');
      throw e;
    }
  }

  async searchTests(q: { q?: string; labId?: string }) { return { items: (await this.partner(() => this.client.tests(q))).items }; }

  async slots(labId: string, collectionType: string, from: Date, to: Date, tests?: string) {
    if (!['HOME', 'WALK_IN'].includes(collectionType)) throw badRequest('INVALID_COLLECTION_TYPE', 'collectionType must be HOME or WALK_IN');
    const d = await this.partner(() => this.client.slots(labId, { collectionType, from: from.toISOString(), to: to.toISOString(), tests }));
    return { labId, collectionType, slots: d.slots };
  }

  async book(sub: string, i: LabBookInput) {
    if (!i.testCodes?.length || new Set(i.testCodes).size !== i.testCodes.length || i.testCodes.length > 20) throw badRequest('INVALID_TESTS', '1-20 distinct test codes');
    const start = new Date(i.slot.startsAt);
    if (Number.isNaN(start.getTime()) || start <= new Date()) throw badRequest('INVALID_SLOT', 'slot must be in the future');
    if (i.collectionType === 'HOME' && !i.address?.line1?.trim()) throw badRequest('ADDRESS_REQUIRED', 'Home collection needs an address');
    // the slot must still be offered by the lab (it is the system of record for capacity)
    const offered = await this.partner(() => this.client.slots(i.labId, { collectionType: i.collectionType, from: new Date(start.getTime() - 60_000).toISOString(), to: new Date(start.getTime() + 3600_000).toISOString(), tests: i.testCodes.join(',') }));
    if (!offered.slots.some((s) => new Date(s.startsAt).getTime() === start.getTime())) throw conflict('SLOT_TAKEN', 'That collection slot is no longer available', { alternatives: offered.slots.slice(0, 3) });
    const quote = await this.partner(() => this.client.quote({ labId: i.labId, testCodes: i.testCodes, collectionType: i.collectionType })); // price authority: the lab
    if (quote.tests.length !== i.testCodes.length) throw unprocessable('TEST_NOT_AVAILABLE', 'A selected test is not offered by this lab');
    const subtotal = quote.tests.reduce((s, t) => s + t.priceMinor, 0);
    const fee = i.collectionType === 'HOME' ? quote.collectionFeeMinor ?? 0 : 0;
    const id = newId('kx_lb');
    const b = await this.prisma.labBooking.create({
      data: { id, sub, labId: i.labId, tests: quote.tests as object[], collectionType: i.collectionType, slotStartsAt: start, slotEndsAt: new Date(i.slot.endsAt), address: i.collectionType === 'HOME' ? (i.address as object) : undefined, status: 'PENDING_PAYMENT', subtotalMinor: subtotal, collectionFeeMinor: fee, totalMinor: subtotal + fee, takeRateBps: cfg().labTakeRateBps },
    });
    const p = await this.pay.createOrderIntent({ orderRef: id, purpose: 'LAB', sub, partnerId: `lab:${i.labId}`, amountMinor: b.totalMinor, currency: b.currency });
    await this.prisma.labBooking.update({ where: { id }, data: { paymentId: p.id } });
    return this.present(await this.prisma.labBooking.findUniqueOrThrow({ where: { id } }));
  }

  async present(b: LabBooking) {
    const p = b.paymentId ? await this.pay.getIntent(b.paymentId) : null;
    return {
      id: b.id, status: b.status, labId: b.labId, tests: b.tests as unknown as { code: string; name: string; priceMinor: number }[], collectionType: b.collectionType, slotStartsAt: b.slotStartsAt.toISOString(), slotEndsAt: b.slotEndsAt.toISOString(),
      subtotalMinor: b.subtotalMinor, collectionFeeMinor: b.collectionFeeMinor, totalMinor: b.totalMinor, currency: b.currency, resultRecordId: b.resultRecordId, rejectionReason: b.rejectionReason,
      payment: p ? { paymentId: p.id, status: p.status, checkoutUrl: p.status === 'CREATED' ? p.checkoutUrl : null } : null, createdAt: b.createdAt.toISOString(),
    };
  }
  private async owned(sub: string, id: string) {
    const b = await this.prisma.labBooking.findUnique({ where: { id } });
    if (!b || b.sub !== sub) throw notFound('LAB_BOOKING_NOT_FOUND', 'Lab booking not found');
    return b;
  }
  async list(sub: string) { return Promise.all((await this.prisma.labBooking.findMany({ where: { sub }, orderBy: { createdAt: 'desc' }, take: 100 })).map((b) => this.present(b))); }
  get(sub: string, id: string) { return this.owned(sub, id).then((b) => this.present(b)); }
  async opsList(status?: string) { return Promise.all((await this.prisma.labBooking.findMany({ where: status ? { status } : {}, orderBy: { createdAt: 'desc' }, take: 200 })).map(async (b) => ({ ...(await this.present(b)), sub: b.sub, platformFeeMinor: b.platformFeeMinor, takeRateBps: b.takeRateBps }))); }

  private async move(b: LabBooking, from: string[], to: string, patch: Record<string, unknown> = {}) {
    return (await this.prisma.labBooking.updateMany({ where: { id: b.id, status: { in: from } }, data: { status: to, ...patch } })).count > 0;
  }

  async onPaid(bookingId: string) {
    const b = await this.prisma.labBooking.findUnique({ where: { id: bookingId } });
    if (!b) return;
    if (b.status === 'PENDING_PAYMENT') await this.move(b, ['PENDING_PAYMENT'], 'PAID');
    await this.submit(bookingId);
  }

  async submit(bookingId: string) {
    const b = await this.prisma.labBooking.findUniqueOrThrow({ where: { id: bookingId } });
    if (b.status !== 'PAID') return b.status;
    const prof = await this.patients.profileBySub(b.sub);
    const addr = (b.address ?? {}) as { line1?: string; area?: string; governorate?: string; notes?: string; phone?: string };
    const home = b.collectionType === 'HOME';
    const gender = /^f/i.test(prof?.gender ?? '') ? 'F' : /^m/i.test(prof?.gender ?? '') ? 'M' : undefined;
    const intent: LabOrderIntent = {
      sourceRef: b.id, labId: b.labId,
      patient: { fullName: prof?.nameEn ?? prof?.nameAr ?? 'Kiorex patient', phone: prof?.phone ?? undefined, externalId: b.sub, dateOfBirth: prof?.dateOfBirth?.toISOString().slice(0, 10), sex: gender, preferredLocale: prof?.preferredLocale === 'en' ? 'en' : 'ar' },
      testCodes: (b.tests as unknown as { code: string }[]).map((t) => t.code),
      collection: { type: home ? 'HOME' : 'IN_LAB', address: home ? [addr.line1, addr.area, addr.governorate, addr.notes].filter(Boolean).join(', ') : undefined, windowStart: b.slotStartsAt.toISOString(), windowEnd: b.slotEndsAt.toISOString(), contactPhone: addr.phone ?? prof?.phone ?? undefined },
      consentChannels: ['KIOREX_VAULT'], // the booking itself is the patient's request to receive the result in the Kiorex vault (secure link only)
    };
    try {
      const { data } = await this.client.createOrder(b.id, intent);
      if (data.status === 'CANCELLED') return this.reject(b, 'LAB_CANCELLED');
      await this.move(b, ['PAID'], 'SUBMITTED', { partnerOrderId: data.orderId });
      await this.engagement.notify(b.sub, { kind: 'LAB_BOOKING_CONFIRMED', params: { time: b.slotStartsAt.toISOString() }, dedupeKey: `LAB_BOOKING_CONFIRMED:${b.id}` });
      return 'SUBMITTED';
    } catch (e) {
      if (e instanceof PartnerHttpError && e.status !== 401) return this.reject(b, e.code ?? `LAB_${e.status}`); // 401 = our credentials: never auto-refund
      throw e; // transient: outbox retry, same Idempotency-Key
    }
  }

  private async reject(b: LabBooking, reason: string) {
    if (await this.move(b, ['PAID', 'SUBMITTED'], 'REJECTED', { rejectionReason: reason.slice(0, 120) }) && b.paymentId) await this.pay.refundOrder(b.paymentId, 'REJECTED');
    return 'REJECTED';
  }

  async cancel(sub: string, id: string) {
    const b = await this.owned(sub, id);
    if (b.status === 'PENDING_PAYMENT') { await this.move(b, ['PENDING_PAYMENT'], 'CANCELLED'); if (b.paymentId) await this.pay.refundOrder(b.paymentId, 'CANCELLED'); return this.get(sub, id); }
    if (!['PAID', 'SUBMITTED'].includes(b.status)) throw conflict('LAB_BOOKING_NOT_CANCELLABLE', `Booking is ${b.status}`);
    if (b.partnerOrderId) {
      try { await this.client.cancelOrder(b.id, 'PATIENT_CANCELLED'); } catch (e) {
        if (e instanceof PartnerHttpError) throw conflict('LAB_BOOKING_NOT_CANCELLABLE', 'The lab already collected or started processing this order');
        throw unavailable('LAB_SYSTEM_BUSY', 'Lab system busy, try again shortly', { retryable: true });
      }
    }
    if ((await this.move(b, ['PAID', 'SUBMITTED'], 'CANCELLED')) && b.paymentId) await this.pay.refundOrder(b.paymentId, 'CANCELLED');
    return this.get(sub, id);
  }
  async resubmit(id: string) { return { status: await this.submit(id) }; }

  /** LabOrderStatusChanged (draft contract): COLLECTED is shown to the patient; a lab-side CANCELLED before collection refunds in full. Other states are ignored. */
  async onStatusChanged(d: { orderId?: string; sourceRef?: string | null; nextStatus?: string }): Promise<'APPLIED' | 'IGNORED' | 'UNKNOWN_ORDER'> {
    const b = await this.prisma.labBooking.findFirst({ where: { OR: [...(d.orderId ? [{ partnerOrderId: d.orderId }] : []), ...(d.sourceRef ? [{ id: d.sourceRef }] : [])] } });
    if (!b) return 'UNKNOWN_ORDER';
    if (FINAL.has(b.status)) return 'IGNORED';
    if (d.nextStatus === 'COLLECTED') return (await this.move(b, ['PAID', 'SUBMITTED'], 'COLLECTED')) ? 'APPLIED' : 'IGNORED';
    if (d.nextStatus === 'CANCELLED') { await this.reject(b, 'LAB_CANCELLED'); return 'APPLIED'; }
    return 'IGNORED';
  }

  /** LabResultReleased: vault entry (secure link only) + release the held payment minus Kiorex's take. Walk-in results (no Kiorex booking) still reach a consenting vault. */
  async onResultReleased(d: { reportId: string; orderId: string; labId: string; patientRef: string; reportVersion: number; signedAt: string; secureLink: string; channels?: string[] }): Promise<'APPLIED' | 'IGNORED' | 'UNMAPPED_PATIENT'> {
    const b = await this.prisma.labBooking.findFirst({ where: { OR: [{ partnerOrderId: d.orderId }, { id: d.orderId }] } });
    const outcome = await this.records.storeLabResult({ ...d, patientRef: b?.sub ?? d.patientRef });
    if (!b || FINAL.has(b.status)) return outcome;
    const rec = outcome === 'APPLIED' ? await this.prisma.sharedRecord.findFirst({ where: { sub: b.sub, kind: 'LAB_RESULT', sourceRef: d.reportId } }) : null;
    if (await this.move(b, ['PAID', 'SUBMITTED', 'COLLECTED'], 'RESULT_RELEASED', { resultRecordId: rec?.id ?? null })) {
      const fee = Math.round((b.subtotalMinor * b.takeRateBps) / 10000); // take on booking (tests) value, rate snapshotted at booking time
      await this.prisma.labBooking.update({ where: { id: b.id }, data: { platformFeeMinor: fee } });
      if (b.paymentId) await this.pay.releaseOrder(b.paymentId, { feeMinor: fee });
    }
    return outcome === 'UNMAPPED_PATIENT' ? 'APPLIED' : outcome;
  }
}
