import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma, PharmacyOrder } from '@prisma/client';
import { createHash } from 'node:crypto';
import { cfg } from '../common/config';
import { badRequest, conflict, notFound, unavailable, unprocessable } from '../common/errors';
import { newId } from '../common/ids';
import { PartnerHttpError, PartnerTransientError } from '../common/partner-http';
import { EngagementService } from '../engagement/engagement-public';
import { PatientService } from '../patient/patient-public';
import { PayService } from '../pay/pay-public';
import { PrismaService } from '../prisma/prisma.service';
import { RecordsService } from '../records/records-public';
import { PharmacyClient, QuoteDto } from './pharmacy.client';

export interface CartInput { pharmacyId: string; items: { sku: string; qty: number }[]; prescriptionRecordId?: string }
export interface Address { line1: string; area?: string; governorate?: string; notes?: string; phone?: string }
type Line = { sku: string; name: string; qty: number; unitPriceMinor: number; rxRequired: boolean; available: boolean };
const FINAL = new Set(['DISPENSED', 'PARTIAL_REVIEW', 'REJECTED', 'CANCELLED']);

/**
 * Pharmacy orders (KX-03 §08, launch-locked kiorex.pharmacy_orders). Kiorex owns search, cart, order intent, delivery choice and
 * payment; Kiorly Pharmacy owns Rx validation, stock reservation, dispensing and pharmacist sign-off. Controlled medicines are
 * never orderable (KPRX05). The marketplace take rate is a NEEDS_HUMAN config (PHARMACY_TAKE_RATE_BPS), 0 while unset.
 */
@Injectable()
export class PharmacyService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService, private readonly client: PharmacyClient, private readonly pay: PayService, private readonly records: RecordsService,
    private readonly patients: PatientService, private readonly engagement: EngagementService,
  ) {}

  onModuleInit() {
    this.pay.onOrderCaptured('PHARMACY', (p) => this.onPaid(p.orderRef));
    this.patients.registerExport('pharmacyOrders', async (sub) => (await this.prisma.pharmacyOrder.findMany({ where: { sub } })).map((o) => ({ id: o.id, status: o.status, items: o.items, totalMinor: o.totalMinor, createdAt: o.createdAt })));
    this.patients.registerAnonymizer('pharmacyOrders', async (sub) => {
      await this.prisma.pharmacyCart.deleteMany({ where: { sub } });
      await this.prisma.pharmacyOrder.updateMany({ where: { sub }, data: { deliveryAddress: Prisma.DbNull, sub: `deleted:${createHash('sha256').update(sub).digest('hex').slice(0, 10)}` } });
    });
  }

  // ───────────── catalogue ─────────────

  private async partner<T>(fn: () => Promise<{ data: T }>): Promise<T> {
    try { return (await fn()).data; } catch (e) {
      if (e instanceof PartnerTransientError) throw unavailable('PHARMACY_SYSTEM_BUSY', 'Pharmacy system busy, try again shortly', { retryable: true });
      if (e instanceof PartnerHttpError) throw unprocessable(e.code ?? 'PHARMACY_REJECTED', 'Pharmacy rejected the request');
      throw e;
    }
  }
  async pharmacies() {
    const d = await this.partner(() => this.client.pharmacies());
    return d.items.map((p) => ({ id: p.id, name: p.name, pickup: p.pickup, deliveryEnabled: p.delivery.enabled, deliveryFeeMinor: p.delivery.feeMinor, prepMinutes: p.prepMinutes }));
  }
  async search(q: { q?: string; pharmacyId?: string }) {
    const d = await this.partner(() => this.client.catalogue(q));
    return { items: d.items.filter((i) => !i.controlled).map(({ controlled: _c, ...i }) => i) }; // defence in depth: controlled items never reach the app (KPRX05)
  }

  // ───────────── cart ─────────────

  private lines(quote: QuoteDto): Line[] { return quote.items.map((i) => ({ sku: i.sku, name: i.name, qty: i.qty, unitPriceMinor: i.unitPriceMinor, rxRequired: i.rxRequired, available: i.available })); }
  private assertNoControlled(quote: QuoteDto) {
    if (quote.items.some((i) => i.controlled)) throw unprocessable('CONTROLLED_NOT_ORDERABLE', 'Controlled medicines cannot be ordered online');
  }
  private totals(items: Line[], method: string | null, deliveryFee: number) {
    const subtotal = items.reduce((s, i) => s + i.qty * i.unitPriceMinor, 0);
    const fee = method === 'DELIVERY' ? deliveryFee : 0;
    return { subtotalMinor: subtotal, deliveryFeeMinor: fee, totalMinor: subtotal + fee };
  }
  private async presentCart(sub: string) {
    const c = await this.prisma.pharmacyCart.findUnique({ where: { sub } });
    const items = ((c?.items ?? []) as Line[]);
    const fee = c?.deliveryMethod === 'DELIVERY' ? ((c.deliveryAddress as any)?._feeMinor ?? cfg().deliveryFeeMinor) : 0;
    return { pharmacyId: c?.pharmacyId ?? null, items, deliveryMethod: c?.deliveryMethod ?? null, prescriptionRecordId: c?.prescriptionRecordId ?? null, ...this.totals(items, c?.deliveryMethod ?? null, fee), currency: 'EGP', rxRequired: items.some((i) => i.rxRequired) };
  }
  getCart(sub: string) { return this.presentCart(sub); }

  async putCart(sub: string, i: CartInput) {
    if (!i.items?.length) throw badRequest('CART_EMPTY', 'items must not be empty');
    if (i.items.length > 30 || i.items.some((x) => !Number.isInteger(x.qty) || x.qty < 1 || x.qty > 20)) throw badRequest('INVALID_ITEMS', 'max 30 lines, quantity 1-20');
    if (i.prescriptionRecordId) await this.records.prescriptionForOrder(sub, i.prescriptionRecordId);
    const quote = await this.partner(() => this.client.quote({ pharmacyId: i.pharmacyId, items: i.items }));
    this.assertNoControlled(quote);
    const existing = await this.prisma.pharmacyCart.findUnique({ where: { sub } });
    const data = { pharmacyId: i.pharmacyId, items: this.lines(quote) as object[], prescriptionRecordId: i.prescriptionRecordId ?? null };
    await this.prisma.pharmacyCart.upsert({ where: { sub }, create: { sub, ...data }, update: { ...data, ...(existing?.pharmacyId !== i.pharmacyId ? { deliveryMethod: null, deliveryAddress: Prisma.DbNull } : {}) } });
    return this.presentCart(sub);
  }

  async setDelivery(sub: string, d: { method: 'PICKUP' | 'DELIVERY'; address?: Address }) {
    const cart = await this.prisma.pharmacyCart.findUnique({ where: { sub } });
    if (!cart?.pharmacyId) throw badRequest('CART_EMPTY', 'Add items first');
    let feeMinor = 0;
    if (d.method === 'DELIVERY') {
      if (!d.address?.line1?.trim()) throw badRequest('ADDRESS_REQUIRED', 'Delivery needs an address');
      const ph = (await this.partner(() => this.client.pharmacies())).items.find((p) => p.id === cart.pharmacyId);
      if (!ph?.delivery.enabled) throw unprocessable('DELIVERY_NOT_AVAILABLE', 'This pharmacy does not deliver');
      feeMinor = ph.delivery.feeMinor ?? cfg().deliveryFeeMinor;
    } else {
      const ph = (await this.partner(() => this.client.pharmacies())).items.find((p) => p.id === cart.pharmacyId);
      if (ph && !ph.pickup) throw unprocessable('PICKUP_NOT_AVAILABLE', 'This pharmacy does not offer pickup');
    }
    await this.prisma.pharmacyCart.update({ where: { sub }, data: { deliveryMethod: d.method, deliveryAddress: d.method === 'DELIVERY' ? ({ ...d.address, _feeMinor: feeMinor } as object) : Prisma.DbNull } });
    return this.presentCart(sub);
  }
  async clearCart(sub: string) { await this.prisma.pharmacyCart.deleteMany({ where: { sub } }); return { ok: true }; }

  // ───────────── order intent + payment ─────────────

  async createOrder(sub: string, o: { prescriptionRecordId?: string }) {
    const cart = await this.prisma.pharmacyCart.findUnique({ where: { sub } });
    const items = (cart?.items ?? []) as Line[];
    if (!cart?.pharmacyId || !items.length) throw badRequest('CART_EMPTY', 'Your cart is empty');
    if (!cart.deliveryMethod) throw badRequest('DELIVERY_REQUIRED', 'Choose pickup or delivery');
    const quote = await this.partner(() => this.client.quote({ pharmacyId: cart.pharmacyId!, items: items.map((i) => ({ sku: i.sku, qty: i.qty })), delivery: { method: cart.deliveryMethod! } })); // price authority: Pharmacy
    this.assertNoControlled(quote);
    const lines = this.lines(quote);
    const missing = lines.filter((l) => !l.available).map((l) => l.sku);
    if (missing.length) throw conflict('ITEM_UNAVAILABLE', 'Some items are no longer available', { skus: missing });
    const rxNeeded = lines.some((l) => l.rxRequired);
    const rxId = o.prescriptionRecordId ?? cart.prescriptionRecordId ?? undefined;
    if (rxNeeded && !rxId) throw unprocessable('RX_REQUIRED', 'A prescription from your vault is required for prescription-only items', { skus: lines.filter((l) => l.rxRequired).map((l) => l.sku) });
    if (rxId) await this.records.prescriptionForOrder(sub, rxId);
    const feeMinor = cart.deliveryMethod === 'DELIVERY' ? (quote.delivery?.feeMinor ?? (cart.deliveryAddress as any)?._feeMinor ?? cfg().deliveryFeeMinor) : 0;
    const t = this.totals(lines, cart.deliveryMethod, feeMinor);
    const id = newId('kx_ph');
    const { _feeMinor, ...address } = ((cart.deliveryAddress ?? {}) as Record<string, unknown>);
    void _feeMinor;
    const order = await this.prisma.pharmacyOrder.create({
      data: { id, sub, pharmacyId: cart.pharmacyId, status: 'PENDING_PAYMENT', items: lines as object[], ...t, deliveryMethod: cart.deliveryMethod, deliveryAddress: cart.deliveryMethod === 'DELIVERY' ? (address as object) : undefined, prescriptionRecordId: rxId, rxStatus: rxNeeded ? 'PENDING' : 'NOT_REQUIRED', takeRateBps: cfg().pharmacyTakeRateBps },
    });
    const p = await this.pay.createOrderIntent({ orderRef: id, purpose: 'PHARMACY', sub, partnerId: `ph:${cart.pharmacyId}`, amountMinor: t.totalMinor, currency: order.currency });
    await this.prisma.pharmacyOrder.update({ where: { id }, data: { paymentId: p.id } });
    await this.prisma.pharmacyCart.delete({ where: { sub } });
    return this.present(await this.prisma.pharmacyOrder.findUniqueOrThrow({ where: { id } }));
  }

  async present(o: PharmacyOrder) {
    const p = o.paymentId ? await this.pay.getIntent(o.paymentId) : null;
    return {
      id: o.id, status: o.status, pharmacyId: o.pharmacyId, items: o.items as unknown as Line[], subtotalMinor: o.subtotalMinor, deliveryFeeMinor: o.deliveryFeeMinor, totalMinor: o.totalMinor, currency: o.currency, deliveryMethod: o.deliveryMethod,
      rxStatus: o.rxStatus, rejectionReason: o.rejectionReason, readyAt: o.readyAt?.toISOString() ?? null, dispensedAt: o.dispensedAt?.toISOString() ?? null,
      payment: p ? { paymentId: p.id, status: p.status, checkoutUrl: p.status === 'CREATED' ? p.checkoutUrl : null } : null, createdAt: o.createdAt.toISOString(),
    };
  }
  private async owned(sub: string, id: string) {
    const o = await this.prisma.pharmacyOrder.findUnique({ where: { id } });
    if (!o || o.sub !== sub) throw notFound('ORDER_NOT_FOUND', 'Order not found');
    return o;
  }
  async list(sub: string) { return Promise.all((await this.prisma.pharmacyOrder.findMany({ where: { sub }, orderBy: { createdAt: 'desc' }, take: 100 })).map((o) => this.present(o))); }
  async get(sub: string, id: string) { return this.present(await this.owned(sub, id)); }
  async opsList(status?: string) { return Promise.all((await this.prisma.pharmacyOrder.findMany({ where: status ? { status } : {}, orderBy: { createdAt: 'desc' }, take: 200 })).map(async (o) => ({ ...(await this.present(o)), sub: o.sub, platformFeeMinor: o.platformFeeMinor, takeRateBps: o.takeRateBps }))); }

  // ───────────── fulfilment ─────────────

  private async move(o: PharmacyOrder, from: string[], to: string, patch: Record<string, unknown> = {}) {
    const r = await this.prisma.pharmacyOrder.updateMany({ where: { id: o.id, status: { in: from } }, data: { status: to, ...patch } });
    return r.count > 0;
  }

  /** Payment captured (via outbox, retried): move to PAID, then hand the order to Kiorly Pharmacy. Idempotent. */
  async onPaid(orderId: string) {
    const o = await this.prisma.pharmacyOrder.findUnique({ where: { id: orderId } });
    if (!o) return;
    if (o.status === 'PENDING_PAYMENT') await this.move(o, ['PENDING_PAYMENT'], 'PAID');
    await this.submit(orderId);
  }

  async submit(orderId: string) {
    const o = await this.prisma.pharmacyOrder.findUniqueOrThrow({ where: { id: orderId } });
    if (o.status !== 'PAID') return o.status;
    let rx: Record<string, unknown> | undefined;
    if (o.prescriptionRecordId) { const r = await this.records.prescriptionForOrder(o.sub, o.prescriptionRecordId).catch(() => null); if (!r) return this.reject(o, 'RX_NO_LONGER_SHARED'); rx = { recordRef: r.id, verificationToken: r.verificationToken }; }
    try {
      const { data } = await this.client.createOrder(o.id, { orderRef: o.id, pharmacyId: o.pharmacyId, patientRef: o.sub, items: (o.items as unknown as Line[]).map((i) => ({ sku: i.sku, qty: i.qty })), delivery: { method: o.deliveryMethod, address: o.deliveryAddress ?? undefined }, prescription: rx, payment: { reference: o.paymentId, totalMinor: o.totalMinor, currency: o.currency } });
      if (data.status === 'REJECTED') return this.reject(o, data.reason ?? 'PHARMACY_REJECTED');
      await this.move(o, ['PAID'], 'SUBMITTED', { partnerOrderId: data.orderId });
      if (rx) {
        const v = await this.client.validatePrescription({ orderId: data.orderId, prescriptionRef: rx.recordRef as string, verificationToken: rx.verificationToken as string, patientRef: o.sub });
        await this.prisma.pharmacyOrder.update({ where: { id: o.id }, data: { rxStatus: v.data.status === 'INVALID' ? 'INVALID' : v.data.status } });
        if (v.data.status === 'INVALID') { await this.client.cancelOrder(data.orderId, 'RX_INVALID').catch(() => undefined); return this.reject(await this.prisma.pharmacyOrder.findUniqueOrThrow({ where: { id: o.id } }), v.data.reason ?? 'RX_INVALID', ['SUBMITTED']); }
      }
      return 'SUBMITTED';
    } catch (e) {
      if (e instanceof PartnerHttpError) return this.reject(o, e.code ?? `PHARMACY_${e.status}`);
      throw e; // transient: the outbox retries with backoff (same Idempotency-Key => no duplicate order)
    }
  }

  private async reject(o: PharmacyOrder, reason: string, from: string[] = ['PAID', 'SUBMITTED', 'READY']) {
    if (await this.move(o, from, 'REJECTED', { rejectionReason: reason.slice(0, 120) })) {
      if (o.paymentId) await this.pay.refundOrder(o.paymentId, 'REJECTED'); // full automatic refund (KPMKT02)
      await this.engagement.notify(o.sub, { kind: 'PHARMACY_ORDER_REJECTED', dedupeKey: `PHARMACY_ORDER_REJECTED:${o.id}` });
    }
    return 'REJECTED';
  }

  /** OrderReady / DispenseCompleted / OrderRejected (kiorex-contracts v2-draft). Pharmacist sign-off is mandatory (KPRX06). */
  async onPartnerEvent(type: string, data: Record<string, any>): Promise<'APPLIED' | 'IGNORED' | 'UNKNOWN_ORDER'> {
    const o = await this.prisma.pharmacyOrder.findFirst({ where: { OR: [{ partnerOrderId: String(data.orderId) }, { id: String(data.orderId) }] } });
    if (!o) return 'UNKNOWN_ORDER';
    if (FINAL.has(o.status)) return 'IGNORED';
    if ((type === 'OrderReady' || type === 'DispenseCompleted') && !data.pharmacistSignoff?.userId) {
      await this.prisma.auditLog.create({ data: { actor: 'pharmacy', action: 'pharmacy.event_without_signoff', resource: 'PharmacyOrder', resourceId: o.id, metadata: { type } } });
      return 'IGNORED';
    }
    if (type === 'OrderRejected') { await this.reject(o, String(data.reasonCode ?? data.reason ?? 'PHARMACY_REJECTED')); return 'APPLIED'; }
    if (type === 'OrderReady') {
      if (await this.move(o, ['PAID', 'SUBMITTED'], 'READY', { readyAt: new Date(data.readyAt ?? Date.now()) })) await this.engagement.notify(o.sub, { kind: 'PHARMACY_ORDER_READY', dedupeKey: `PHARMACY_ORDER_READY:${o.id}` });
      return 'APPLIED';
    }
    if (type === 'DispenseCompleted') {
      if (data.partial) { // no amounts in the draft contract: never auto-release a partial fulfilment (NEEDS_HUMAN: partial refund/take policy)
        await this.move(o, ['PAID', 'SUBMITTED', 'READY'], 'PARTIAL_REVIEW', { dispensedAt: new Date(data.dispensedAt ?? Date.now()) });
        await this.prisma.auditLog.create({ data: { actor: 'pharmacy', action: 'pharmacy.partial_dispense_review', resource: 'PharmacyOrder', resourceId: o.id } });
        return 'APPLIED';
      }
      const fee = Math.round((o.subtotalMinor * o.takeRateBps) / 10000); // take on fulfilled goods value, rate snapshotted at order time
      if (await this.move(o, ['PAID', 'SUBMITTED', 'READY'], 'DISPENSED', { dispensedAt: new Date(data.dispensedAt ?? Date.now()), platformFeeMinor: fee })) {
        if (o.paymentId) await this.pay.releaseOrder(o.paymentId, { feeMinor: fee });
        await this.engagement.notify(o.sub, { kind: 'PHARMACY_ORDER_DISPENSED', dedupeKey: `PHARMACY_ORDER_DISPENSED:${o.id}` });
      }
      return 'APPLIED';
    }
    return 'IGNORED';
  }

  async cancel(sub: string, id: string) {
    const o = await this.owned(sub, id);
    if (o.status === 'PENDING_PAYMENT') { await this.move(o, ['PENDING_PAYMENT'], 'CANCELLED'); if (o.paymentId) await this.pay.refundOrder(o.paymentId, 'CANCELLED'); return this.get(sub, id); }
    if (!['PAID', 'SUBMITTED'].includes(o.status)) throw conflict('ORDER_NOT_CANCELLABLE', `Order is ${o.status}`);
    if (o.partnerOrderId) {
      try { await this.client.cancelOrder(o.partnerOrderId, 'PATIENT_CANCELLED'); } catch (e) {
        if (e instanceof PartnerHttpError) throw conflict('ORDER_NOT_CANCELLABLE', 'The pharmacy already started preparing this order');
        throw unavailable('PHARMACY_SYSTEM_BUSY', 'Pharmacy system busy, try again shortly', { retryable: true });
      }
    }
    if (await this.move(o, ['PAID', 'SUBMITTED'], 'CANCELLED') && o.paymentId) await this.pay.refundOrder(o.paymentId, 'CANCELLED');
    return this.get(sub, id);
  }

  /** Ops: re-run the hand-over for an order stuck in PAID (partner was down past the outbox retries). */
  async resubmit(id: string) { return { status: await this.submit(id) }; }
}
