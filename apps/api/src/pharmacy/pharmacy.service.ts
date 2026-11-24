import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma, PharmacyOrder } from '../prisma/generated/client';
import { createHash } from 'node:crypto';
import { cfg } from '../common/config';
import { badRequest, conflict, forbidden, notFound, unavailable, unprocessable } from '../common/errors';
import { newId } from '../common/ids';
import { PartnerHttpError, PartnerTransientError } from '../common/partner-http';
import { PartnerRegistry, PartnerRouting } from '../partners/partners-public';
import { computePartialSettlement, DispensedLine, PartialSettlement, PolicyService, PROPOSED_DEFAULT_NOTE } from '../policy/policy-public';
import { EngagementService } from '../engagement/engagement-public';
import { PatientService } from '../patient/patient-public';
import { PayService } from '../pay/pay-public';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { RecordsService } from '../records/records-public';
import { PharmacyClient, PharmacyOrderIntent, QuoteDto } from './pharmacy.client';

/** Per-partner (ORG scope) capability flag: switched off for one partner organisation it hides that partner's pharmacies and refuses new carts/orders for it. The global launch-locked kiorex.pharmacy_orders stays the route guard. */
const FLAG = 'pharmacy.kiorex_orders';
export interface CartInput { pharmacyId: string; partnerId?: string; items: { sku: string; qty: number }[]; prescriptionRecordId?: string }
export interface Address { line1: string; area?: string; governorate?: string; notes?: string; phone?: string }
type Line = { sku: string; name: string; nameAr?: string; strength?: string; form?: string; formAr?: string; qty: number; unitPriceMinor: number; rxRequired: boolean; available: boolean };
const FINAL = new Set(['DISPENSED', 'PARTIALLY_FULFILLED', 'PARTIAL_REVIEW', 'REJECTED', 'CANCELLED']);
/** Statuses from which the pharmacy's next fulfilment event may arrive (events can overtake each other through the outbox). */
const IN_FLIGHT = ['PAID', 'SUBMITTED', 'READY', 'OUT_FOR_DELIVERY'];

/**
 * Pharmacy orders (KX-03 §08, launch-locked kiorex.pharmacy_orders). Kiorex owns search, cart, order intent, delivery choice and
 * payment; Kiorly Pharmacy owns Rx validation, stock reservation, dispensing and pharmacist sign-off. Controlled medicines are
 * never orderable (KPRX05). The marketplace take rate is a NEEDS_HUMAN config (PHARMACY_TAKE_RATE_BPS), 0 while unset.
 */
@Injectable()
export class PharmacyService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService, private readonly client: PharmacyClient, private readonly pay: PayService, private readonly records: RecordsService,
    private readonly patients: PatientService, private readonly engagement: EngagementService, private readonly policy: PolicyService,
    private readonly routing: PartnerRouting, private readonly registry: PartnerRegistry,
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
      // the partner switched the capability OFF on its side (e.g. pharmacy.kiorex_orders): surface the universal FEATURE_DISABLED {key,scope}
      if (e instanceof PartnerHttpError && e.status === 403 && e.code === 'FEATURE_DISABLED') throw forbidden('FEATURE_DISABLED', 'This capability is temporarily unavailable at the partner', { key: e.body?.key, scope: e.body?.scope, partner: 'Pharmacy'.toLowerCase() });
      if (e instanceof PartnerHttpError) throw unprocessable(e.code ?? 'PHARMACY_REJECTED', 'Pharmacy rejected the request');
      throw e;
    }
  }
  /** Pharmacy ids one registration serves (location lookup for routing). */
  private readonly lister = async (registrationId: string) => (await this.client.pharmacies(registrationId)).data.items.map((p) => p.id);

  /** Calls every selected registration (null = the env default connection) in parallel and tags each item with the partner that owns it. A partner that fails is skipped; all failing is an error. */
  private async fan<T>(regs: ({ id: string } | null)[], fn: (registrationId: string | null) => Promise<{ data: { items: T[] } }>): Promise<(T & { partnerId: string | null })[]> {
    const settled = await Promise.allSettled(regs.map(async (r) => ({ id: r?.id ?? null, items: (await fn(r?.id ?? null)).data.items })));
    const ok = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
    if (!ok.length && settled.length) await this.partner(() => Promise.reject((settled.find((s) => s.status === 'rejected') as PromiseRejectedResult).reason));
    return ok.flatMap((g) => g.items.map((i) => ({ ...i, partnerId: g.id })));
  }
  /** Registrations a search / listing without an explicit pharmacy fans out to: every live partner whose org flag is ON (none registered => the env default). */
  private async liveRegs(): Promise<({ id: string } | null)[]> {
    const live = await this.routing.live('PHARMACY', FLAG);
    return live.length || (await this.routing.hasAny('PHARMACY')) ? live : [null];
  }

  async pharmacies(partnerId?: string) {
    const regs = partnerId ? [await this.routing.byPartnerId('PHARMACY', FLAG, partnerId)] : await this.liveRegs();
    const items = await this.fan(regs, (id) => this.client.pharmacies(id));
    return items.map((p) => ({ id: p.id, name: p.name, partnerId: p.partnerId, pickup: p.pickup, deliveryEnabled: p.delivery.enabled, deliveryFeeMinor: p.delivery.feeMinor, prepMinutes: p.prepMinutes }));
  }
  async search(q: { q?: string; pharmacyId?: string; partnerId?: string }) {
    const regs = q.partnerId ? [await this.routing.byPartnerId('PHARMACY', FLAG, q.partnerId)]
      : q.pharmacyId ? [await this.routing.resolve('PHARMACY', FLAG, q.pharmacyId, undefined, this.lister)] : await this.liveRegs();
    const items = await this.fan(regs, (id) => this.client.catalogue({ q: q.q, pharmacyId: q.pharmacyId }, id));
    return { items: items.filter((i) => !i.controlled).map(({ controlled: _c, ...i }) => i) }; // defence in depth: controlled items never reach the app (KPRX05)
  }

  // ───────────── cart ─────────────

  /** Snapshot of the quoted lines; Arabic name/form are kept when the pharmacy sent them (absent => the apps show the English one). */
  private lines(quote: QuoteDto): Line[] { return quote.items.map((i) => ({ sku: i.sku, name: i.name, ...(i.nameAr && { nameAr: i.nameAr }), ...(i.strength && { strength: i.strength }), ...(i.form && { form: i.form }), ...(i.formAr && { formAr: i.formAr }), qty: i.qty, unitPriceMinor: i.unitPriceMinor, rxRequired: i.rxRequired, available: i.available })); }
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
    return { pharmacyId: c?.pharmacyId ?? null, partnerId: c?.registrationId ?? null, items, deliveryMethod: c?.deliveryMethod ?? null, prescriptionRecordId: c?.prescriptionRecordId ?? null, ...this.totals(items, c?.deliveryMethod ?? null, fee), currency: 'EGP', rxRequired: items.some((i) => i.rxRequired) };
  }
  getCart(sub: string) { return this.presentCart(sub); }

  async putCart(sub: string, i: CartInput) {
    if (!i.items?.length) throw badRequest('CART_EMPTY', 'items must not be empty');
    if (i.items.length > 30 || i.items.some((x) => !Number.isInteger(x.qty) || x.qty < 1 || x.qty > 20)) throw badRequest('INVALID_ITEMS', 'max 30 lines, quantity 1-20');
    if (i.prescriptionRecordId) await this.records.prescriptionForOrder(sub, i.prescriptionRecordId);
    const reg = await this.routing.resolve('PHARMACY', FLAG, i.pharmacyId, i.partnerId, this.lister); // the registration that owns this pharmacy (null = env default)
    const registrationId = reg?.id ?? null;
    const quote = await this.partner(() => this.client.quote({ pharmacyId: i.pharmacyId, items: i.items }, registrationId));
    this.assertNoControlled(quote);
    const existing = await this.prisma.pharmacyCart.findUnique({ where: { sub } });
    const data = { pharmacyId: i.pharmacyId, registrationId, items: this.lines(quote) as object[], prescriptionRecordId: i.prescriptionRecordId ?? null };
    await this.prisma.pharmacyCart.upsert({ where: { sub }, create: { sub, ...data }, update: { ...data, ...(existing?.pharmacyId !== i.pharmacyId || existing?.registrationId !== registrationId ? { deliveryMethod: null, deliveryAddress: Prisma.DbNull } : {}) } });
    return this.presentCart(sub);
  }

  async setDelivery(sub: string, d: { method: 'PICKUP' | 'DELIVERY'; address?: Address }) {
    const cart = await this.prisma.pharmacyCart.findUnique({ where: { sub } });
    if (!cart?.pharmacyId) throw badRequest('CART_EMPTY', 'Add items first');
    let feeMinor = 0;
    if (d.method === 'DELIVERY') {
      if (!d.address?.line1?.trim()) throw badRequest('ADDRESS_REQUIRED', 'Delivery needs an address');
      const ph = (await this.partner(() => this.client.pharmacies(cart.registrationId))).items.find((p) => p.id === cart.pharmacyId);
      if (!ph?.delivery.enabled) throw unprocessable('DELIVERY_NOT_AVAILABLE', 'This pharmacy does not deliver');
      feeMinor = ph.delivery.feeMinor ?? cfg().deliveryFeeMinor;
    } else {
      const ph = (await this.partner(() => this.client.pharmacies(cart.registrationId))).items.find((p) => p.id === cart.pharmacyId);
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
    await this.routing.assertOrgAllows(cart.registrationId, FLAG); // the partner's own organisation may have switched the capability off since the cart was built
    const quote = await this.partner(() => this.client.quote({ pharmacyId: cart.pharmacyId!, items: items.map((i) => ({ sku: i.sku, qty: i.qty })), delivery: { method: cart.deliveryMethod! } }, cart.registrationId)); // price authority: the pharmacy that owns this cart
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
      data: { id, sub, pharmacyId: cart.pharmacyId, registrationId: cart.registrationId, status: 'PENDING_PAYMENT', items: lines as object[], ...t, deliveryMethod: cart.deliveryMethod, deliveryAddress: cart.deliveryMethod === 'DELIVERY' ? (address as object) : undefined, prescriptionRecordId: rxId, rxStatus: rxNeeded ? 'PENDING' : 'NOT_REQUIRED', takeRateBps: cfg().pharmacyTakeRateBps },
    });
    const p = await this.pay.createOrderIntent({ orderRef: id, purpose: 'PHARMACY', sub, partnerId: `ph:${cart.pharmacyId}`, amountMinor: t.totalMinor, currency: order.currency });
    await this.prisma.pharmacyOrder.update({ where: { id }, data: { paymentId: p.id } });
    await this.prisma.pharmacyCart.delete({ where: { sub } });
    return this.present(await this.prisma.pharmacyOrder.findUniqueOrThrow({ where: { id } }));
  }

  /** Organisation scope for per-org policy overrides: the owning partner's own organisation id; dev/env registrations (no connection record) keep keying by the pharmacy id. */
  private async policyOrg(o: PharmacyOrder) { return (await this.registry.orgRefOf(o.registrationId)) ?? o.pharmacyId; }

  /** The patient's own delivery address, as given (drops internal fields such as the cached fee). */
  private publicAddress(a: unknown): Address | null {
    const { line1, area, governorate, notes, phone } = (a ?? {}) as Partial<Address>;
    return line1 ? { line1, ...(area && { area }), ...(governorate && { governorate }), ...(notes && { notes }), ...(phone && { phone }) } : null;
  }

  async present(o: PharmacyOrder) {
    const p = o.paymentId ? await this.pay.getIntent(o.paymentId) : null;
    return {
      id: o.id, status: o.status, pharmacyId: o.pharmacyId, partnerId: o.registrationId, items: o.items as unknown as Line[], subtotalMinor: o.subtotalMinor, deliveryFeeMinor: o.deliveryFeeMinor, totalMinor: o.totalMinor, currency: o.currency, deliveryMethod: o.deliveryMethod,
      rxStatus: o.rxStatus, deliveryAddress: o.deliveryMethod === 'DELIVERY' ? this.publicAddress(o.deliveryAddress) : null, rejectionReason: o.rejectionReason, readyAt: o.readyAt?.toISOString() ?? null, outForDeliveryAt: o.outForDeliveryAt?.toISOString() ?? null, dispensedAt: o.dispensedAt?.toISOString() ?? null,
      refund: await this.presentRefund(o),
      payment: p ? { paymentId: p.id, status: p.status, checkoutUrl: p.status === 'CREATED' ? p.checkoutUrl : null } : null, createdAt: o.createdAt.toISOString(),
    };
  }
  /** Itemised refund of a partially fulfilled order (null otherwise). `status` follows the PSP settlement of the refund. */
  private async presentRefund(o: PharmacyOrder) {
    const st = o.settlement as null | { refund?: { lines: unknown[]; goodsMinor: number; deliveryFeeMinor: number; totalMinor: number; fulfilledMinor: number; refundedAt: string } };
    if (!st?.refund || !o.paymentId) return null;
    const r = await this.prisma.refund.findUnique({ where: { idempotencyKey: `refund-partial:${o.paymentId}` } });
    return { status: r?.status === 'SETTLED' ? 'SETTLED' : 'REQUESTED', ...st.refund, currency: o.currency, policyNote: PROPOSED_DEFAULT_NOTE };
  }
  private async owned(sub: string, id: string) {
    const o = await this.prisma.pharmacyOrder.findUnique({ where: { id } });
    if (!o || o.sub !== sub) throw notFound('ORDER_NOT_FOUND', 'Order not found');
    return o;
  }
  async list(sub: string) { return Promise.all((await this.prisma.pharmacyOrder.findMany({ where: { sub }, orderBy: { createdAt: 'desc' }, take: 100 })).map((o) => this.present(o))); }
  async get(sub: string, id: string) { return this.present(await this.owned(sub, id)); }
  async opsList(status?: string, partnerId?: string) { const names = new Map((await this.prisma.partnerRegistration.findMany({ where: { kind: 'PHARMACY' }, select: { id: true, name: true } })).map((r) => [r.id, r.name])); return Promise.all((await this.prisma.pharmacyOrder.findMany({ where: { ...(status ? { status } : {}), ...(partnerId ? { registrationId: partnerId } : {}) }, orderBy: { createdAt: 'desc' }, take: 200 })).map(async (o) => ({ ...(await this.present(o)), partnerName: (o.registrationId && names.get(o.registrationId)) || null, sub: o.sub, platformFeeMinor: o.platformFeeMinor, takeRateBps: o.takeRateBps }))); }

  // ───────────── fulfilment ─────────────

  private async move(o: PharmacyOrder, from: string[], to: string, patch: Record<string, unknown> = {}, db: Tx | PrismaService = this.prisma) {
    const r = await db.pharmacyOrder.updateMany({ where: { id: o.id, status: { in: from } }, data: { status: to, ...patch } });
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
    const prof = await this.patients.profileBySub(o.sub);
    const addr = (o.deliveryAddress ?? {}) as { line1?: string; area?: string; governorate?: string; notes?: string; phone?: string };
    const intent: PharmacyOrderIntent = {
      orderId: o.id, branchId: o.pharmacyId, patientRef: o.sub, prepaid: true,
      customer: { name: prof?.nameEn ?? prof?.nameAr ?? undefined, phone: addr.phone ?? prof?.phone ?? undefined, address: o.deliveryMethod === 'DELIVERY' ? [addr.line1, addr.area, addr.governorate, addr.notes].filter(Boolean).join(', ') : undefined },
      lines: (o.items as unknown as Line[]).map((i) => ({ sku: i.sku, quantity: i.qty, unitPrice: (i.unitPriceMinor / 100).toFixed(2) })),
      delivery: { method: o.deliveryMethod, address: o.deliveryAddress ?? undefined },
      payment: { reference: o.paymentId, totalMinor: o.totalMinor, currency: o.currency },
      prescription: rx as PharmacyOrderIntent['prescription'],
    };
    try {
      const { data } = await this.client.createOrder(o.id, intent, o.registrationId);
      if (data.status === 'REJECTED' || data.status === 'CANCELLED' || data.status === 'EXPIRED') return this.reject(o, `PHARMACY_${data.status}`);
      await this.move(o, ['PAID'], 'SUBMITTED', { partnerOrderId: data.orderId });
      if (rx) {
        const v = await this.client.validatePrescription({ orderId: data.orderId, prescriptionRef: rx.recordRef as string, verificationToken: rx.verificationToken as string, patientRef: o.sub }, o.registrationId);
        await this.prisma.pharmacyOrder.update({ where: { id: o.id }, data: { rxStatus: v.data.status === 'INVALID' ? 'INVALID' : v.data.status } });
        if (v.data.status === 'INVALID') { await this.client.cancelOrder(data.orderId, 'RX_INVALID', o.registrationId).catch(() => undefined); return this.reject(await this.prisma.pharmacyOrder.findUniqueOrThrow({ where: { id: o.id } }), v.data.reason ?? 'RX_INVALID', ['SUBMITTED']); }
      }
      return 'SUBMITTED';
    } catch (e) {
      // 401 = our credentials are wrong (configuration), not the pharmacy refusing the order: never auto-refund, retry/ops-resubmit instead
      if (e instanceof PartnerHttpError && e.status !== 401) return this.reject(o, e.code ?? `PHARMACY_${e.status}`);
      throw e; // transient: the outbox retries with backoff (same Idempotency-Key => no duplicate order)
    }
  }

  /** Status change + refund in ONE transaction: a reader that sees the final status also sees the refunded payment (and a crash cannot leave one without the other). */
  private async moveAndRefund(o: PharmacyOrder, from: string[], to: 'REJECTED' | 'CANCELLED', patch: Record<string, unknown> = {}): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const moved = await this.move(o, from, to, patch, tx);
      if (moved && o.paymentId) await this.pay.refundOrder(o.paymentId, to, tx);
      return moved;
    });
  }

  private async reject(o: PharmacyOrder, reason: string, from: string[] = IN_FLIGHT) {
    if (await this.moveAndRefund(o, from, 'REJECTED', { rejectionReason: reason.slice(0, 120) })) { // full automatic refund (KPMKT02)
      await this.engagement.notify(o.sub, { kind: 'PHARMACY_ORDER_REJECTED', dedupeKey: `PHARMACY_ORDER_REJECTED:${o.id}` });
    }
    return 'REJECTED';
  }

  /** OrderReady / DispenseCompleted / OrderRejected (kiorex-contracts v2-draft). Pharmacist sign-off is mandatory (KPRX06). */
  async onPartnerEvent(type: string, data: Record<string, any>, ctx: { registrationId?: string | null } = {}): Promise<'APPLIED' | 'IGNORED' | 'UNKNOWN_ORDER'> {
    const o = await this.prisma.pharmacyOrder.findFirst({ where: { OR: [{ partnerOrderId: String(data.orderId) }, { id: String(data.orderId) }] } });
    if (!o) return 'UNKNOWN_ORDER';
    // the event was verified against ONE registration's webhook secret: it may only touch that registration's own orders (a second partner cannot move another's order)
    if (ctx.registrationId && o.registrationId && ctx.registrationId !== o.registrationId) {
      await this.prisma.auditLog.create({ data: { actor: 'pharmacy', action: 'pharmacy.event_from_other_registration', resource: 'PharmacyOrder', resourceId: o.id, metadata: { type, from: ctx.registrationId, owner: o.registrationId } } });
      return 'IGNORED';
    }
    if (FINAL.has(o.status)) return 'IGNORED';
    if ((type === 'OrderReady' || type === 'DispenseCompleted') && !data.pharmacistSignoff?.userId) {
      await this.prisma.auditLog.create({ data: { actor: 'pharmacy', action: 'pharmacy.event_without_signoff', resource: 'PharmacyOrder', resourceId: o.id, metadata: { type } } });
      return 'IGNORED';
    }
    if (type === 'OrderRejected') { await this.reject(o, String(data.reasonCode ?? data.reason ?? 'PHARMACY_REJECTED')); return 'APPLIED'; }
    if (type === 'OrderReady') {
      if (await this.move(o, ['PAID', 'SUBMITTED'], 'READY', { readyAt: new Date(data.readyAt ?? Date.now()), ...(o.rxStatus === 'PENDING' ? { rxStatus: 'VALID' } : {}) })) await this.engagement.notify(o.sub, { kind: 'PHARMACY_ORDER_READY', dedupeKey: `PHARMACY_ORDER_READY:${o.id}` });
      return 'APPLIED';
    }
    if (type === 'OrderOutForDelivery') { // 1.8.0: READY -> OUT_FOR_DELIVERY, DELIVERY orders only; DispenseCompleted still completes the order
      if (o.deliveryMethod !== 'DELIVERY') {
        await this.prisma.auditLog.create({ data: { actor: 'pharmacy', action: 'pharmacy.out_for_delivery_on_pickup_order', resource: 'PharmacyOrder', resourceId: o.id, metadata: { type } } });
        return 'IGNORED';
      }
      if (await this.move(o, ['PAID', 'SUBMITTED', 'READY'], 'OUT_FOR_DELIVERY', { outForDeliveryAt: new Date(data.outForDeliveryAt ?? Date.now()), ...(o.rxStatus === 'PENDING' ? { rxStatus: 'VALID' } : {}) })) {
        await this.engagement.notify(o.sub, { kind: 'PHARMACY_ORDER_OUT_FOR_DELIVERY', dedupeKey: `PHARMACY_ORDER_OUT_FOR_DELIVERY:${o.id}` });
      }
      return 'APPLIED';
    }
    if (type === 'DispenseCompleted') {
      if (data.partial) {
        const pol = this.policy.get('pharmacy.partial_fulfilment', { market: cfg().defaultMarket, orgId: await this.policyOrg(o) }).value;
        const lines = Array.isArray(data.lines) ? (data.lines as { sku: string; quantityDispensed: number }[]) : null;
        if (pol.mode === 'PRO_RATA_REFUND' && lines) { await this.settlePartial(o, { dispensed: lines, deliveryMade: data.deliveryMade, dispensedAt: new Date(data.dispensedAt ?? Date.now()) }, IN_FLIGHT, 'pharmacy'); return 'APPLIED'; }
        // no per-line amounts (pre-1.8.0 pharmacy) or the market chose manual review: never auto-release, ops decides (POST /admin/pharmacy/orders/:id/resolve-partial)
        await this.move(o, IN_FLIGHT, 'PARTIAL_REVIEW', { dispensedAt: new Date(data.dispensedAt ?? Date.now()), settlement: { pending: true, reportedLines: lines, deliveryMade: data.deliveryMade ?? null } as object });
        await this.prisma.auditLog.create({ data: { actor: 'pharmacy', action: 'pharmacy.partial_dispense_review', resource: 'PharmacyOrder', resourceId: o.id, metadata: { reason: lines ? 'POLICY_MANUAL_REVIEW' : 'NO_LINES_IN_EVENT' } } });
        return 'APPLIED';
      }
      const fee = Math.round((o.subtotalMinor * o.takeRateBps) / 10000); // take on fulfilled goods value, rate snapshotted at order time
      if (await this.move(o, IN_FLIGHT, 'DISPENSED', { dispensedAt: new Date(data.dispensedAt ?? Date.now()), platformFeeMinor: fee })) {
        if (o.paymentId) await this.pay.releaseOrder(o.paymentId, { feeMinor: fee });
        await this.engagement.notify(o.sub, { kind: 'PHARMACY_ORDER_DISPENSED', dedupeKey: `PHARMACY_ORDER_DISPENSED:${o.id}` });
      }
      return 'APPLIED';
    }
    return 'IGNORED';
  }

  /**
   * Partial fulfilment (policy pharmacy.partial_fulfilment, PROPOSED_DEFAULT delegated by founder 23 Nov 2026): refund the rejected/unavailable lines
   * pro-rata (+ the delivery fee when the delivery is not made), release the fulfilled lines to the pharmacy, store the itemised refund on the order.
   * Same money pattern as every refund: status change + Refund row + ledger postings + outbox event in ONE transaction, idempotent on `refund-partial:<payment>`,
   * settled through the PSP outbox and covered by the daily reconciliation. Nothing fulfilled => the ordinary full refund (REJECTED).
   */
  private async settlePartial(o: PharmacyOrder, i: { dispensed: DispensedLine[]; deliveryMade?: boolean; dispensedAt: Date }, from: string[], actor: string): Promise<PartialSettlement> {
    const pol = this.policy.get('pharmacy.partial_fulfilment', { market: cfg().defaultMarket, orgId: await this.policyOrg(o) });
    const calc = computePartialSettlement({ items: o.items as unknown as Line[], deliveryMethod: o.deliveryMethod, deliveryFeeMinor: o.deliveryFeeMinor, dispensed: i.dispensed, deliveryMade: i.deliveryMade }, pol.value);
    if (calc.nothingFulfilled) { await this.reject(o, 'NOTHING_DISPENSED', from); return calc; }
    const fee = Math.round((calc.fulfilledGoodsMinor * o.takeRateBps) / 10000); // take on the fulfilled goods only
    const refunded = await this.prisma.$transaction(async (tx) => {
      const refundedAt = new Date().toISOString();
      const settlement = { refund: { lines: calc.lines, goodsMinor: calc.goodsRefundMinor, deliveryFeeMinor: calc.deliveryFeeRefundMinor, totalMinor: calc.refundTotalMinor, fulfilledMinor: calc.fulfilledGoodsMinor, refundedAt }, policy: { key: pol.key, source: pol.source, value: pol.value, note: pol.note ?? PROPOSED_DEFAULT_NOTE }, resolvedBy: actor };
      const moved = await this.move(o, from, calc.refundTotalMinor > 0 ? 'PARTIALLY_FULFILLED' : 'DISPENSED', { dispensedAt: i.dispensedAt, platformFeeMinor: fee, settlement: calc.refundTotalMinor > 0 ? (settlement as object) : Prisma.DbNull }, tx);
      if (!moved) return false;
      if (o.paymentId) {
        if (calc.refundTotalMinor > 0) await this.pay.refund(o.paymentId, { reason: 'PARTIAL_FULFILMENT', amountMinor: calc.refundTotalMinor, idempotencyKey: `refund-partial:${o.paymentId}` }, tx);
        if (pol.value.releaseFulfilledToPharmacy) await this.pay.releaseOrder(o.paymentId, { feeMinor: fee }, tx);
      }
      await tx.auditLog.create({ data: { actor, action: 'pharmacy.partial_settled', resource: 'PharmacyOrder', resourceId: o.id, metadata: { refundTotalMinor: calc.refundTotalMinor, goodsRefundMinor: calc.goodsRefundMinor, deliveryFeeRefundMinor: calc.deliveryFeeRefundMinor, fulfilledMinor: calc.fulfilledGoodsMinor, policySource: pol.source } } });
      return true;
    });
    if (refunded) {
      if (calc.refundTotalMinor > 0) await this.engagement.notify(o.sub, { kind: 'PHARMACY_ORDER_PARTIAL_REFUND', params: { amount: `${(calc.refundTotalMinor / 100).toFixed(2)} ${o.currency}` }, dedupeKey: `PHARMACY_ORDER_PARTIAL_REFUND:${o.id}` });
      else await this.engagement.notify(o.sub, { kind: 'PHARMACY_ORDER_DISPENSED', dedupeKey: `PHARMACY_ORDER_DISPENSED:${o.id}` });
    }
    return calc;
  }

  /** Ops: settle a PARTIAL_REVIEW order with the market/org policy (lines default to what the pharmacy reported; ops may correct them). */
  async resolvePartial(id: string, actor: string, body: { lines?: DispensedLine[]; deliveryMade?: boolean }) {
    const o = await this.prisma.pharmacyOrder.findUnique({ where: { id } });
    if (!o) throw notFound('ORDER_NOT_FOUND', 'Order not found');
    if (o.status !== 'PARTIAL_REVIEW') throw conflict('NOT_IN_PARTIAL_REVIEW', `Order is ${o.status}`);
    const pending = (o.settlement ?? {}) as { reportedLines?: DispensedLine[] | null; deliveryMade?: boolean | null };
    const dispensed = body.lines ?? pending.reportedLines;
    if (!dispensed?.length) throw badRequest('LINES_REQUIRED', 'Provide the dispensed quantity per sku (the pharmacy did not report lines)');
    const calc = await this.settlePartial(o, { dispensed, deliveryMade: body.deliveryMade ?? pending.deliveryMade ?? undefined, dispensedAt: o.dispensedAt ?? new Date() }, ['PARTIAL_REVIEW'], actor);
    return { order: await this.get(o.sub, o.id), refundTotalMinor: calc.refundTotalMinor };
  }

  async cancel(sub: string, id: string) {
    const o = await this.owned(sub, id);
    if (o.status === 'PENDING_PAYMENT') { await this.moveAndRefund(o, ['PENDING_PAYMENT'], 'CANCELLED'); return this.get(sub, id); }
    if (!['PAID', 'SUBMITTED'].includes(o.status)) throw conflict('ORDER_NOT_CANCELLABLE', `Order is ${o.status}`);
    if (o.partnerOrderId) {
      try { await this.client.cancelOrder(o.partnerOrderId, 'PATIENT_CANCELLED', o.registrationId); } catch (e) {
        if (e instanceof PartnerHttpError) throw conflict('ORDER_NOT_CANCELLABLE', 'The pharmacy already started preparing this order');
        throw unavailable('PHARMACY_SYSTEM_BUSY', 'Pharmacy system busy, try again shortly', { retryable: true });
      }
    }
    await this.moveAndRefund(o, ['PAID', 'SUBMITTED'], 'CANCELLED');
    return this.get(sub, id);
  }

  /** Ops: re-run the hand-over for an order stuck in PAID (partner was down past the outbox retries). */
  async resubmit(id: string) { return { status: await this.submit(id) }; }
}
