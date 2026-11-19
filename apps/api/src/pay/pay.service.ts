import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PaymentIntent, Prisma } from '@prisma/client';
import { cfg } from '../common/config';
import { badRequest, conflict, notFound } from '../common/errors';
import { newId, toMajor } from '../common/ids';
import { FlagsService } from '../control-plane/control-plane-public';
import { KiorlyClient, KiorlyHttpError } from '../kiorly/kiorly-public';
import { OutboxService } from '../outbox/outbox-public';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { assertValid, LedgerTxInput, Posting, capture, payout as payoutPosting, pspFee, refundRequest, refundSettle, release, releaseOrder } from './ledger';
import { FakePspAdapter, pspAdapter, PspWebhookEvent } from './psp';

const isoWeek = (d: Date) => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t.getTime() - y0.getTime()) / 86400000 + 1) / 7)).padStart(2, '0')}`;
};

@Injectable()
export class PayService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private orderHandlers = new Map<string, (p: { paymentId: string; orderRef: string; amountMinor: number }) => Promise<void>>();
  constructor(private readonly prisma: PrismaService, private readonly outbox: OutboxService, private readonly kiorly: KiorlyClient, private readonly flags: FlagsService) {}

  onModuleInit() {
    this.outbox.register('kiorly.deposit_paid', (e) => this.notifyKiorlyDeposit(e.payload));
    this.outbox.register('kiorly.payout_recorded', (e) => this.notifyKiorlyPayout(e.payload));
    this.outbox.register('pay.refund_requested', (e) => this.settleRefund(e.payload.refundId));
    this.outbox.register('pay.refund_settled', async () => undefined);
    this.outbox.register('pay.order_captured', async (e) => { // vertical modules subscribe per purpose (PHARMACY | LAB)
      const fn = this.orderHandlers.get(e.payload.purpose);
      if (!fn) throw new Error(`no order handler for purpose ${e.payload.purpose}`);
      await fn(e.payload);
    });
    if (cfg().jobsEnabled) {
      // weekly payouts (checked hourly; idempotent by period), daily reconciliation
      this.timer = setInterval(() => {
        const n = new Date();
        if (n.getUTCDay() === 0 && n.getUTCHours() === 6) void this.runPayouts().catch(() => undefined);
        if (n.getUTCHours() === 1) void this.reconcileDaily().catch(() => undefined);
      }, 3600_000);
      this.timer.unref();
    }
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  // ───────────── ledger persistence ─────────────

  private async postLedger(tx: Tx, t: LedgerTxInput & { bookingId?: string | null; paymentId?: string; clinicId?: string }): Promise<boolean> {
    assertValid(t.postings);
    const exists = await tx.ledgerTx.findUnique({ where: { idempotencyKey: t.key } });
    if (exists) return false;
    await tx.ledgerTx.create({
      data: { idempotencyKey: t.key, kind: t.kind, bookingId: t.bookingId ?? undefined, paymentId: t.paymentId, clinicId: t.clinicId, entries: { create: t.postings.map((p: Posting) => ({ account: p.account, debitMinor: p.debit, creditMinor: p.credit })) } },
    });
    return true;
  }

  // ───────────── deposits (KXM-PAY-01) ─────────────

  /** Idempotent per booking: returns the existing open intent. Caller (booking) gates on kiorex.pay_deposits. */
  async createDepositIntent(i: { bookingId: string; sub: string; clinicId: string; amountMinor: number; currency: string; psp?: string }): Promise<PaymentIntent> {
    const existing = await this.prisma.paymentIntent.findFirst({ where: { bookingId: i.bookingId, status: { in: ['CREATED', 'CAPTURED'] } } });
    if (existing) return existing;
    if (!Number.isInteger(i.amountMinor) || i.amountMinor <= 0) throw badRequest('INVALID_AMOUNT', 'amount must be positive');
    const id = newId('pay');
    const adapter = pspAdapter(i.psp ?? 'paymob');
    const co = await adapter.createCheckout({ paymentId: id, amountMinor: i.amountMinor, currency: i.currency });
    return this.prisma.paymentIntent.create({ data: { id, bookingId: i.bookingId, sub: i.sub, clinicId: i.clinicId, amountMinor: i.amountMinor, currency: i.currency, psp: adapter.name, pspRef: co.pspRef, checkoutUrl: co.checkoutUrl } });
  }

  /** Vertical modules subscribe to captured payments of their purpose (delivered through the outbox: retried with backoff). */
  onOrderCaptured(purpose: 'PHARMACY' | 'LAB', fn: (p: { paymentId: string; orderRef: string; amountMinor: number }) => Promise<void>) { this.orderHandlers.set(purpose, fn); }

  /** Vertical order payment (pharmacy / lab). `partnerId` is the ledger sub-account owner (e.g. ph:<pharmacyId>). Idempotent per order. */
  async createOrderIntent(i: { orderRef: string; purpose: 'PHARMACY' | 'LAB'; sub: string; partnerId: string; amountMinor: number; currency: string; psp?: string }): Promise<PaymentIntent> {
    const existing = await this.prisma.paymentIntent.findFirst({ where: { orderRef: i.orderRef, purpose: i.purpose, status: { in: ['CREATED', 'CAPTURED'] } } });
    if (existing) return existing;
    if (!Number.isInteger(i.amountMinor) || i.amountMinor <= 0) throw badRequest('INVALID_AMOUNT', 'amount must be positive');
    const id = newId('pay');
    const adapter = pspAdapter(i.psp ?? 'paymob');
    const co = await adapter.createCheckout({ paymentId: id, amountMinor: i.amountMinor, currency: i.currency });
    return this.prisma.paymentIntent.create({ data: { id, orderRef: i.orderRef, purpose: i.purpose, sub: i.sub, clinicId: i.partnerId, amountMinor: i.amountMinor, currency: i.currency, psp: adapter.name, pspRef: co.pspRef, checkoutUrl: co.checkoutUrl } });
  }

  /** Order fulfilled: held funds become partner-payable minus Kiorex's marketplace take. Idempotent. */
  async releaseOrder(paymentId: string, o: { feeMinor: number }) {
    const p = await this.getIntent(paymentId);
    if (p.status !== 'CAPTURED' || p.releasedAt) return null;
    await this.prisma.$transaction(async (tx) => {
      const c = await tx.paymentIntent.updateMany({ where: { id: p.id, releasedAt: null }, data: { releasedAt: new Date(), releaseKind: 'COMPLETED' } });
      if (c.count) await this.postLedger(tx, { key: `release-order:${p.id}`, kind: `RELEASE_ORDER_${p.purpose}`, postings: releaseOrder(p.clinicId, p.amountMinor, o.feeMinor), paymentId: p.id, clinicId: p.clinicId });
    });
    return 'RELEASED';
  }

  /** Cancelled/rejected order: refund the captured amount (idempotent per reason key); cancel an uncaptured intent. */
  async refundOrder(paymentId: string, reason: string) {
    const p = await this.getIntent(paymentId);
    if (p.status === 'CREATED') { await this.prisma.paymentIntent.update({ where: { id: p.id }, data: { status: 'FAILED' } }); return null; }
    if (!['CAPTURED', 'PARTIALLY_REFUNDED'].includes(p.status) || p.releasedAt) return null;
    return this.refund(p.id, { reason, idempotencyKey: `refund-order:${p.id}:${reason}` });
  }

  async getIntent(id: string) {
    const p = await this.prisma.paymentIntent.findUnique({ where: { id } });
    if (!p) throw notFound('PAYMENT_NOT_FOUND', 'Payment not found');
    return p;
  }
  async intentForBooking(bookingId: string) {
    return this.prisma.paymentIntent.findFirst({ where: { bookingId }, orderBy: { createdAt: 'desc' } });
  }

  /** Verified PSP webhook → idempotent capture / failure / refund settlement. */
  async handlePspWebhook(psp: string, rawBody: string, headers: Record<string, unknown>): Promise<{ status: string }> {
    const ev = pspAdapter(psp).verifyWebhook(rawBody, headers);
    if (!ev) throw badRequest('INVALID_PSP_SIGNATURE', 'PSP signature rejected');
    const dup = await this.prisma.webhookReceipt.findUnique({ where: { eventId: `psp:${ev.eventId}` } });
    if (dup) return { status: 'DUPLICATE' };
    await this.prisma.webhookReceipt.create({ data: { eventId: `psp:${ev.eventId}`, source: `psp:${psp}`, type: ev.type, aggregateId: ev.paymentId ?? ev.pspRef, payload: JSON.parse(rawBody), status: 'PROCESSED', processedAt: new Date() } });
    if (ev.type === 'payment.captured') return { status: await this.capturePayment(ev) };
    if (ev.type === 'payment.failed') {
      await this.prisma.paymentIntent.updateMany({ where: { OR: [{ id: ev.paymentId ?? '-' }, { pspRef: ev.pspRef }], status: 'CREATED' }, data: { status: 'FAILED' } });
      return { status: 'FAILED_RECORDED' };
    }
    return { status: 'IGNORED' };
  }

  /** Money path: idempotency key (payment id) + ledger entry + outbox events in ONE transaction. */
  private async capturePayment(ev: PspWebhookEvent): Promise<string> {
    const p = await this.prisma.paymentIntent.findFirst({ where: { OR: [{ id: ev.paymentId ?? '-' }, { pspRef: ev.pspRef }] } });
    if (!p) throw notFound('PAYMENT_NOT_FOUND', 'Unknown payment');
    if (p.status === 'CAPTURED' || p.status === 'REFUNDED' || p.status === 'PARTIALLY_REFUNDED') return 'ALREADY_CAPTURED';
    if (ev.amountMinor !== p.amountMinor) {
      await this.prisma.auditLog.create({ data: { actor: 'psp', action: 'pay.amount_mismatch', resource: 'PaymentIntent', resourceId: p.id, metadata: { expected: p.amountMinor, got: ev.amountMinor } } });
      throw conflict('AMOUNT_MISMATCH', 'Captured amount does not match intent');
    }
    const fee = ev.feeMinor ?? Math.round((p.amountMinor * cfg().pspFeeBps) / 10000); // NEEDS_HUMAN: PSP_FEE_BPS placeholder 0
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.paymentIntent.updateMany({ where: { id: p.id, status: { in: ['CREATED', 'FAILED'] } }, data: { status: 'CAPTURED', capturedAt: new Date(ev.occurredAt), feeMinor: fee } });
      if (!claimed.count) return;
      await this.postLedger(tx, { key: `capture:${p.id}`, kind: 'CAPTURE', postings: capture(p.clinicId, p.amountMinor), bookingId: p.bookingId, paymentId: p.id, clinicId: p.clinicId });
      if (fee > 0) await this.postLedger(tx, { key: `fee:${p.id}`, kind: 'PSP_FEE', postings: pspFee(fee), paymentId: p.id, clinicId: p.clinicId });
      if (p.purpose !== 'DEPOSIT') {
        // vertical orders (pharmacy/lab): the owning module reacts; Kiorly clinic deposit endpoints are never called
        await this.outbox.enqueue(tx, { type: 'pay.order_captured', aggregateType: 'PaymentIntent', aggregateId: p.id, payload: { paymentId: p.id, purpose: p.purpose, orderRef: p.orderRef, amountMinor: p.amountMinor }, dedupeKey: `pay.order_captured:${p.id}` });
        return;
      }
      await this.outbox.enqueue(tx, { type: 'kiorly.deposit_paid', target: 'KIORLY', aggregateType: 'PaymentIntent', aggregateId: p.id, payload: { paymentId: p.id }, dedupeKey: `kiorly.deposit_paid:${p.id}` });
      await this.outbox.enqueue(tx, { type: 'pay.deposit_captured', aggregateType: 'PaymentIntent', aggregateId: p.id, payload: { paymentId: p.id, bookingId: p.bookingId, amountMinor: p.amountMinor }, dedupeKey: `pay.deposit_captured:${p.id}` });
    });
    return 'CAPTURED';
  }

  private async notifyKiorlyDeposit(payload: { paymentId: string }) {
    const p = await this.getIntent(payload.paymentId);
    const body = { amount: toMajor(p.amountMinor), currency: p.currency, paymentRef: p.id, paidAt: (p.capturedAt ?? new Date()).toISOString() };
    try {
      if (p.bookingId) await this.kiorly.depositPaid(p.bookingId, body);
      else if (p.payLinkToken) await this.kiorly.depositLinkPaid(p.payLinkToken, body);
    } catch (e) {
      if (!(e instanceof KiorlyHttpError && e.status === 409)) throw e; // 409 duplicate paymentRef == already recorded
    }
    await this.prisma.paymentIntent.update({ where: { id: p.id }, data: { kiorlyNotified: true } });
  }

  // ───────────── refunds (KXM-PAY-02) ─────────────

  /** Idempotent by key. Over-refund is impossible: remaining is checked under a row lock. */
  async refund(paymentId: string, o: { reason: string; amountMinor?: number; idempotencyKey: string }) {
    const existing = await this.prisma.refund.findUnique({ where: { idempotencyKey: o.idempotencyKey } });
    if (existing) return existing;
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<PaymentIntent[]>(Prisma.sql`SELECT * FROM "PaymentIntent" WHERE id = ${paymentId} FOR UPDATE`);
      const p = rows[0];
      if (!p) throw notFound('PAYMENT_NOT_FOUND', 'Payment not found');
      if (!['CAPTURED', 'PARTIALLY_REFUNDED'].includes(p.status)) throw conflict('NOT_REFUNDABLE', `Payment is ${p.status}`);
      const remaining = p.amountMinor - p.refundedMinor;
      const amount = o.amountMinor ?? remaining;
      if (amount <= 0 || amount > remaining) throw badRequest('REFUND_EXCEEDS_CAPTURE', 'Refund exceeds remaining captured amount', { remaining });
      const refund = await tx.refund.create({ data: { id: newId('rf'), paymentId, amountMinor: amount, reason: o.reason, idempotencyKey: o.idempotencyKey } });
      await tx.paymentIntent.update({ where: { id: paymentId }, data: { refundedMinor: p.refundedMinor + amount, status: p.refundedMinor + amount === p.amountMinor ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } });
      await this.postLedger(tx, { key: `refund-req:${refund.id}`, kind: 'REFUND_REQUEST', postings: refundRequest(p.clinicId, amount), bookingId: p.bookingId, paymentId, clinicId: p.clinicId });
      await this.outbox.enqueue(tx, { type: 'pay.refund_requested', aggregateType: 'Refund', aggregateId: refund.id, payload: { refundId: refund.id }, dedupeKey: `pay.refund_requested:${refund.id}` });
      return refund;
    });
  }

  async settleRefund(refundId: string) {
    const r = await this.prisma.refund.findUnique({ where: { id: refundId }, include: { payment: true } });
    if (!r || r.status === 'SETTLED') return;
    const out = await pspAdapter(r.payment.psp).refund({ pspRef: r.payment.pspRef ?? '', refundId: r.id, amountMinor: r.amountMinor });
    await this.prisma.$transaction(async (tx) => {
      await this.postLedger(tx, { key: `refund-settle:${r.id}`, kind: 'REFUND_SETTLED', postings: refundSettle(r.amountMinor), bookingId: r.payment.bookingId, paymentId: r.paymentId, clinicId: r.payment.clinicId });
      await tx.refund.update({ where: { id: r.id }, data: { status: 'SETTLED', pspRefundRef: out.pspRefundRef, settledAt: new Date() } });
      await this.outbox.enqueue(tx, { type: 'pay.refund_settled', aggregateType: 'Refund', aggregateId: r.id, payload: { refundId: r.id, bookingId: r.payment.bookingId, amountMinor: r.amountMinor }, dedupeKey: `pay.refund_settled:${r.id}` });
    });
  }

  /** Booking cancelled/expired: refund a captured deposit; cancel an uncaptured intent. */
  async refundForBooking(bookingId: string, reason: string) {
    const p = await this.intentForBooking(bookingId);
    if (!p) return null;
    if (p.status === 'CREATED') { await this.prisma.paymentIntent.update({ where: { id: p.id }, data: { status: 'FAILED' } }); return null; }
    if (p.status !== 'CAPTURED' && p.status !== 'PARTIALLY_REFUNDED') return null;
    if (p.releasedAt) return null; // already released to the clinic (completed / forfeited)
    return this.refund(p.id, { reason, idempotencyKey: `refund:${bookingId}:${reason}` });
  }

  // ───────────── release / forfeit ─────────────

  async releaseForBooking(bookingId: string, kind: 'COMPLETED' | 'FORFEITED') {
    const p = await this.intentForBooking(bookingId);
    if (!p || p.status !== 'CAPTURED' || p.releasedAt) return null;
    const n = p.amountMinor - p.refundedMinor;
    await this.prisma.$transaction(async (tx) => {
      const c = await tx.paymentIntent.updateMany({ where: { id: p.id, releasedAt: null }, data: { releasedAt: new Date(), releaseKind: kind } });
      if (c.count) await this.postLedger(tx, { key: `release:${p.id}`, kind: `RELEASE_${kind}`, postings: release(p.clinicId, n), bookingId, paymentId: p.id, clinicId: p.clinicId });
    });
    return kind;
  }

  // ───────────── payouts (KXM-PAY-04) ─────────────

  /** Weekly, idempotent. Each released, unpaid deposit is claimed exactly once; Kiorly is told via outbox with payoutRef. */
  async runPayouts(now = new Date()) {
    const period = isoWeek(now);
    const due = await this.prisma.paymentIntent.findMany({ where: { purpose: 'DEPOSIT', status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED'] }, releasedAt: { not: null }, payoutId: null } }); // vertical partner payouts are NEEDS_HUMAN (merchant-of-record decision)
    const byClinic = new Map<string, PaymentIntent[]>();
    for (const p of due) byClinic.set(p.clinicId, [...(byClinic.get(p.clinicId) ?? []), p]);
    const out: { payoutRef: string; clinicId: string; amountMinor: number }[] = [];
    for (const [clinicId, items] of byClinic) {
      const amount = items.reduce((s, p) => s + p.amountMinor - p.refundedMinor, 0);
      if (amount <= 0) continue;
      const seq = await this.prisma.payout.count({ where: { clinicId, periodKey: { startsWith: period } } });
      const periodKey = seq === 0 ? period : `${period}#${seq + 1}`;
      const payoutRef = `po_${clinicId}_${periodKey}`;
      await this.prisma.$transaction(async (tx) => {
        const id = newId('po');
        const claimed = await tx.paymentIntent.updateMany({ where: { id: { in: items.map((i) => i.id) }, payoutId: null }, data: { payoutId: id } });
        if (claimed.count !== items.length) throw conflict('PAYOUT_RACE', 'Deposits already claimed by another payout run');
        const refs = items.map((i) => i.id);
        await tx.payout.create({ data: { id, payoutRef, clinicId, amountMinor: amount, currency: items[0].currency, periodKey, paymentRefs: refs } });
        await this.postLedger(tx, { key: `payout:${id}`, kind: 'PAYOUT', postings: payoutPosting(clinicId, amount), clinicId });
        await this.outbox.enqueue(tx, { type: 'kiorly.payout_recorded', target: 'KIORLY', aggregateType: 'Payout', aggregateId: id, payload: { payoutId: id }, dedupeKey: `kiorly.payout_recorded:${id}` });
      }).catch((e) => { if (e?.code === 'P2002') return; throw e; });
      out.push({ payoutRef, clinicId, amountMinor: amount });
    }
    return { period, payouts: out };
  }

  private async notifyKiorlyPayout(payload: { payoutId: string }) {
    const po = await this.prisma.payout.findUnique({ where: { id: payload.payoutId } });
    if (!po) return;
    try {
      await this.kiorly.recordPayout({ payoutRef: po.payoutRef, clinicId: po.clinicId, amount: toMajor(po.amountMinor), currency: po.currency, paidAt: po.paidAt.toISOString(), depositPaymentRefs: po.paymentRefs as string[] });
    } catch (e) {
      if (!(e instanceof KiorlyHttpError && e.status === 409)) throw e;
    }
    await this.prisma.payout.update({ where: { id: po.id }, data: { status: 'KIORLY_RECORDED' } });
  }

  // ───────────── pay links (KXM-PAY-03) ─────────────

  async createPayLink(i: { token: string; clinicId: string; amountMinor: number; currency?: string; externalRef?: string; expiresAt?: Date }) {
    if (!i.token || i.amountMinor <= 0) throw badRequest('INVALID_LINK', 'token and positive amount required');
    return this.prisma.payLink.upsert({ where: { token: i.token }, create: { token: i.token, clinicId: i.clinicId, amountMinor: i.amountMinor, currency: i.currency ?? 'EGP', externalRef: i.externalRef, expiresAt: i.expiresAt ?? new Date(Date.now() + 7 * 86400_000) }, update: {} });
  }
  async payLink(token: string) {
    const l = await this.prisma.payLink.findUnique({ where: { token } });
    if (!l) throw notFound('LINK_NOT_FOUND', 'Pay link not found');
    return { token: l.token, clinicId: l.clinicId, amountMinor: l.amountMinor, currency: l.currency, status: l.expiresAt < new Date() && l.status === 'OPEN' ? 'EXPIRED' : l.status, expiresAt: l.expiresAt };
  }
  async payLinkCheckout(token: string) {
    await this.flags.assertEnabled('kiorex.pay_deposits', { market: 'EG' });
    const l = await this.prisma.payLink.findUnique({ where: { token } });
    if (!l || l.status !== 'OPEN' || l.expiresAt < new Date()) throw conflict('LINK_NOT_PAYABLE', 'Pay link is not payable');
    if (l.paymentIntentId) return this.getIntent(l.paymentIntentId);
    const id = newId('pay');
    const a = pspAdapter('paymob');
    const co = await a.createCheckout({ paymentId: id, amountMinor: l.amountMinor, currency: l.currency });
    const intent = await this.prisma.paymentIntent.create({ data: { id, payLinkToken: token, clinicId: l.clinicId, amountMinor: l.amountMinor, currency: l.currency, psp: a.name, pspRef: co.pspRef, checkoutUrl: co.checkoutUrl } });
    await this.prisma.payLink.update({ where: { token }, data: { paymentIntentId: id } });
    return intent;
  }

  // ───────────── fake hosted checkout (sandbox only) ─────────────

  async fakeComplete(paymentId: string, outcome: 'pay' | 'fail') {
    if (cfg().pspMode !== 'sandbox-fake') throw notFound('NOT_FOUND', 'Not found');
    const p = await this.getIntent(paymentId);
    const ev: PspWebhookEvent = { eventId: newId('pspev'), type: outcome === 'pay' ? 'payment.captured' : 'payment.failed', pspRef: p.pspRef ?? '', paymentId: p.id, amountMinor: p.amountMinor, feeMinor: Math.round((p.amountMinor * cfg().pspFeeBps) / 10000), occurredAt: new Date().toISOString() };
    const raw = JSON.stringify(ev);
    const r = await this.handlePspWebhook(p.psp, raw, { 'x-psp-signature': FakePspAdapter.sign(raw) });
    if (p.payLinkToken && outcome === 'pay') await this.prisma.payLink.update({ where: { token: p.payLinkToken }, data: { status: 'PAID' } });
    return r;
  }

  // ───────────── reconciliation (KXM-PAY-05) + dashboards (KXM-OP-04) ─────────────

  async balances() {
    const rows = await this.prisma.ledgerEntry.groupBy({ by: ['account'], _sum: { debitMinor: true, creditMinor: true } });
    return rows.map((r) => ({ account: r.account, debitMinor: r._sum.debitMinor ?? 0, creditMinor: r._sum.creditMinor ?? 0 }));
  }

  async importSettlementLines(lines: { psp: string; pspRef: string; kind: 'CAPTURE' | 'REFUND'; amountMinor: number; feeMinor?: number; date: string }[]) {
    for (const l of lines) await this.prisma.pspSettlementLine.upsert({ where: { psp_pspRef_kind: { psp: l.psp, pspRef: l.pspRef, kind: l.kind } }, create: { ...l, date: new Date(l.date) }, update: { amountMinor: l.amountMinor, feeMinor: l.feeMinor ?? 0 } });
    return { imported: lines.length };
  }

  /** Daily PSP reconciliation + internal ledger integrity. Records a run; discrepancies surface in ops. */
  async reconcileDaily(date = new Date()) {
    const day = new Date(date.toISOString().slice(0, 10));
    const next = new Date(day.getTime() + 86400_000);
    const captured = await this.prisma.paymentIntent.findMany({ where: { capturedAt: { gte: day, lt: next } } });
    let lines = await this.prisma.pspSettlementLine.findMany({ where: { date: day, kind: 'CAPTURE' } });
    if (!lines.length && cfg().pspMode === 'sandbox-fake') {
      // sandbox: the fake PSP's settlement report mirrors its own captures
      await this.importSettlementLines(captured.map((p) => ({ psp: p.psp, pspRef: p.pspRef ?? p.id, kind: 'CAPTURE' as const, amountMinor: p.amountMinor, feeMinor: p.feeMinor, date: day.toISOString() })));
      lines = await this.prisma.pspSettlementLine.findMany({ where: { date: day, kind: 'CAPTURE' } });
    }
    const disc: { type: string; ref: string; detail?: unknown }[] = [];
    const byRef = new Map(lines.map((l) => [l.pspRef, l]));
    for (const p of captured) {
      const l = byRef.get(p.pspRef ?? p.id);
      if (!l) disc.push({ type: 'MISSING_AT_PSP', ref: p.id });
      else if (l.amountMinor !== p.amountMinor) disc.push({ type: 'AMOUNT_MISMATCH', ref: p.id, detail: { ours: p.amountMinor, psp: l.amountMinor } });
      if (l) await this.prisma.pspSettlementLine.update({ where: { id: l.id }, data: { matched: true } });
    }
    const ours = new Set(captured.map((p) => p.pspRef ?? p.id));
    for (const l of lines) if (!ours.has(l.pspRef)) disc.push({ type: 'UNKNOWN_AT_PSP', ref: l.pspRef, detail: { amountMinor: l.amountMinor } });
    // ledger invariants
    const unbalanced = await this.prisma.$queryRaw<{ txId: string }[]>`SELECT "txId" FROM "LedgerEntry" GROUP BY "txId" HAVING SUM("debitMinor") <> SUM("creditMinor")`;
    for (const u of unbalanced) disc.push({ type: 'LEDGER_UNBALANCED', ref: u.txId });
    const stale = await this.prisma.refund.findMany({ where: { status: 'REQUESTED', createdAt: { lt: new Date(Date.now() - 24 * 3600_000) } } });
    for (const r of stale) disc.push({ type: 'REFUND_NOT_SETTLED', ref: r.id });
    const noLedger = await this.prisma.$queryRaw<{ id: string }[]>`SELECT p.id FROM "PaymentIntent" p WHERE p.status IN ('CAPTURED','PARTIALLY_REFUNDED','REFUNDED') AND NOT EXISTS (SELECT 1 FROM "LedgerTx" t WHERE t."idempotencyKey" = 'capture:' || p.id)`;
    for (const n of noLedger) disc.push({ type: 'CAPTURE_WITHOUT_LEDGER', ref: n.id });
    const run = await this.prisma.reconciliationRun.create({ data: { kind: 'PSP_DAILY', status: disc.length ? 'DISCREPANCIES' : 'OK', discrepancies: disc as any, stats: { captured: captured.length, lines: lines.length, date: day.toISOString().slice(0, 10) } } });
    return run;
  }

  /**
   * Kiorex's OWN marketplace fee statement (pharmacy/lab take) per partner and period, from the ledger. VAT is a CONFIG line
   * (FEE_STATEMENT_VAT_BPS, NEEDS_HUMAN, 0 while unset) shown on this statement only; nothing is ever reported to any authority.
   */
  async feeStatement(q: { from: Date; to: Date }) {
    const rows = await this.prisma.$queryRaw<{ partner: string; fee: bigint; orders: bigint }[]>(Prisma.sql`
      SELECT t."clinicId" AS partner, COALESCE(SUM(e."creditMinor"),0)::bigint AS fee, COUNT(DISTINCT t.id)::bigint AS orders
      FROM "LedgerEntry" e JOIN "LedgerTx" t ON t.id = e."txId"
      WHERE e.account = 'MARKETPLACE_FEES' AND t."createdAt" >= ${q.from} AND t."createdAt" < ${q.to}
      GROUP BY t."clinicId" ORDER BY t."clinicId"`);
    const bps = cfg().feeStatementVatBps;
    const lines = rows.map((r) => { const feeMinor = Number(r.fee); const vatMinor = Math.round((feeMinor * bps) / 10000); return { partner: r.partner, orders: Number(r.orders), feeMinor, vatBps: bps, vatMinor, totalMinor: feeMinor + vatMinor }; });
    return { from: q.from.toISOString(), to: q.to.toISOString(), currency: 'EGP', vatBps: bps, vatNote: bps ? 'VAT per FEE_STATEMENT_VAT_BPS config (NEEDS_HUMAN)' : 'VAT rate not configured (NEEDS_HUMAN)', lines, totals: { feeMinor: lines.reduce((s, l) => s + l.feeMinor, 0), vatMinor: lines.reduce((s, l) => s + l.vatMinor, 0), totalMinor: lines.reduce((s, l) => s + l.totalMinor, 0) } };
  }

  async dashboard() {
    const [intents, refunds, payouts, runs, balances] = await Promise.all([
      this.prisma.paymentIntent.groupBy({ by: ['status'], _count: true, _sum: { amountMinor: true } }),
      this.prisma.refund.groupBy({ by: ['status'], _count: true, _sum: { amountMinor: true } }),
      this.prisma.payout.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.reconciliationRun.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
      this.balances(),
    ]);
    return { intents, refunds, payouts, reconciliationRuns: runs, balances };
  }
}
