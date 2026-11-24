import { Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { PayLink, PaymentIntent, Prisma } from '../prisma/generated/client';
import { cfg } from '../common/config';
import { badRequest, conflict, notFound } from '../common/errors';
import { newId, toMajor } from '../common/ids';
import { FlagsService } from '../control-plane/control-plane-public';
import { KiorlyClient, KiorlyHttpError } from '../kiorly/kiorly-public';
import { REWARDS_PORT, type RewardsPort } from '../growth/growth-ports-public';
import { OutboxService } from '../outbox/outbox-public';
import { MARKET_FACTS } from '../market/market-public';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { A, assertValid, LedgerTxInput, Posting, capture, holdForReview, payout as payoutPosting, pspFee, refundCreditExpired, refundFromReview, refundRequest, refundSettle, refundToCredit, release, releaseFromReview, releaseOrder, rewardRestore, rewardTender } from './ledger';
import { FakePspAdapter, pspAdapter, PspWebhookEvent } from './psp';

const isoWeek = (d: Date) => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t.getTime() - y0.getTime()) / 86400000 + 1) / 7)).padStart(2, '0')}`;
};

/** Largest amount a PaymentIntent / PayLink / Refund column (PostgreSQL int4) can hold. Anything above is a client error (400), never a 500. */
export const MAX_AMOUNT_MINOR = 2_147_483_647;
/** Currencies Kiorex Pay can charge: the ISO currency of every market in the registry. */
export const PAYABLE_CURRENCIES: readonly string[] = [...new Set(Object.values(MARKET_FACTS).map((m) => m.currency))];
export function assertPayableAmount(amountMinor: unknown): asserts amountMinor is number {
  if (typeof amountMinor !== 'number' || !Number.isSafeInteger(amountMinor) || amountMinor <= 0 || amountMinor > MAX_AMOUNT_MINOR) throw badRequest('INVALID_AMOUNT', `amount must be a whole number of minor units between 1 and ${MAX_AMOUNT_MINOR}`);
}
export function assertPayableCurrency(currency: unknown): asserts currency is string {
  if (typeof currency !== 'string' || !PAYABLE_CURRENCIES.includes(currency)) throw badRequest('UNSUPPORTED_CURRENCY', `currency must be one of ${PAYABLE_CURRENCIES.join(', ')} (uppercase ISO 4217)`);
}

@Injectable()
export class PayService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private orderHandlers = new Map<string, (p: { paymentId: string; orderRef: string; amountMinor: number }) => Promise<void>>();
  constructor(private readonly prisma: PrismaService, private readonly outbox: OutboxService, private readonly kiorly: KiorlyClient, private readonly flags: FlagsService, @Optional() @Inject(REWARDS_PORT) private readonly rewards?: RewardsPort) {}

  /** What the Pay ledger holds for a deposit: the card money still held plus the credit part posted into HELD (GRW-P2-B2). Equals amountMinor - refundedMinor when no credit was used. */
  private heldMinor(p: { amountMinor: number; refundedMinor: number; rewardPostedMinor?: number }): number { return p.amountMinor - p.refundedMinor + (p.rewardPostedMinor ?? 0); }

  onModuleInit() {
    this.outbox.register('kiorly.deposit_paid', (e) => this.notifyKiorlyDeposit(e.payload));
    this.outbox.register('kiorly.payout_recorded', (e) => this.notifyKiorlyPayout(e.payload));
    this.outbox.register('pay.refund_requested', (e) => this.settleRefund(e.payload.refundId));
    this.outbox.register('pay.refund_settled', async () => undefined);
    this.outbox.register('pay.refund_credit_expired', async (e) => { await this.refundCreditExpired(e.payload); }); // GRW-P2-B2: the unspent rest of an expired refund credit goes back to the ORIGINAL payment method
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
  async createDepositIntent(i: { bookingId: string; sub: string; clinicId: string; amountMinor: number; currency: string; psp?: string; rewardMinor?: number }): Promise<PaymentIntent> {
    assertPayableAmount(i.amountMinor); assertPayableCurrency(i.currency);
    // Two concurrent checkouts of one booking (double click, two tabs) must not create two charges: serialise per booking, then re-read.
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`deposit-intent:${i.bookingId}`}))`;
      const existing = await tx.paymentIntent.findFirst({ where: { bookingId: i.bookingId, status: { in: ['CREATED', 'CAPTURED'] } } });
      if (existing) return existing;
      const id = newId('pay');
      const adapter = pspAdapter(i.psp ?? 'paymob');
      const co = await adapter.createCheckout({ paymentId: id, amountMinor: i.amountMinor, currency: i.currency });
      return tx.paymentIntent.create({ data: { id, bookingId: i.bookingId, sub: i.sub, clinicId: i.clinicId, amountMinor: i.amountMinor, currency: i.currency, psp: adapter.name, pspRef: co.pspRef, checkoutUrl: co.checkoutUrl, rewardMinor: i.rewardMinor ?? 0 } });
    }, { timeout: 20_000 });
  }

  /**
   * GRW-P2-B2: the deposit checkout with credit. The credit (a coupon, or credit lots when patient credit is effective) is RESERVED for this booking first (idempotent per booking), the card is
   * charged for the rest (never less than one minor unit), and the reservation becomes a REDEEM in the transaction that records the capture. If the intent cannot be created the reservation is
   * released. With the rewards switch OFF (or nothing applicable) this is exactly `createDepositIntent`.
   */
  async createDepositIntentWithRewards(i: { bookingId: string; sub: string; clinicId: string; amountMinor: number; currency: string; psp?: string; serviceKind: 'IN_CLINIC' | 'VIDEO' | 'HOME_VISIT'; specialty?: string | null; dependantId?: string | null; couponCode?: string | null; lotId?: string | null }): Promise<{ intent: PaymentIntent; rewardMinor: number; lines: Array<{ code: string; amountMinor: number; labelKey: string }>; couponProblem?: string }> {
    const open = await this.prisma.paymentIntent.findFirst({ where: { bookingId: i.bookingId, status: { in: ['CREATED', 'CAPTURED'] } } });
    if (open || !this.rewards) return { intent: open ?? (await this.createDepositIntent(i)), rewardMinor: open?.rewardMinor ?? 0, lines: [] };
    const r = await this.rewards.reserveForDeposit({ sub: i.sub, bookingId: i.bookingId, amountMinor: i.amountMinor, currency: i.currency, serviceKind: i.serviceKind, specialty: i.specialty, dependantId: i.dependantId, couponCode: i.couponCode, lotId: i.lotId });
    try {
      const intent = await this.createDepositIntent({ ...i, amountMinor: i.amountMinor - r.appliedMinor, rewardMinor: r.appliedMinor });
      if (intent.rewardMinor !== r.appliedMinor) { // a concurrent checkout of the same booking won with another amount: keep ITS intent and release nothing it relies on
        return { intent, rewardMinor: intent.rewardMinor, lines: r.lines, ...(r.couponProblem ? { couponProblem: r.couponProblem } : {}) };
      }
      return { intent, rewardMinor: r.appliedMinor, lines: r.lines, ...(r.couponProblem ? { couponProblem: r.couponProblem } : {}) };
    } catch (e) {
      await this.rewards.releaseForBooking(i.bookingId, 'INTENT_NOT_CREATED').catch(() => undefined);
      throw e;
    }
  }

  /** Vertical modules subscribe to captured payments of their purpose (delivered through the outbox: retried with backoff). */
  onOrderCaptured(purpose: 'PHARMACY' | 'LAB', fn: (p: { paymentId: string; orderRef: string; amountMinor: number }) => Promise<void>) { this.orderHandlers.set(purpose, fn); }

  /** Vertical order payment (pharmacy / lab). `partnerId` is the ledger sub-account owner (e.g. ph:<pharmacyId>). Idempotent per order. */
  async createOrderIntent(i: { orderRef: string; purpose: 'PHARMACY' | 'LAB'; sub: string; partnerId: string; amountMinor: number; currency: string; psp?: string }): Promise<PaymentIntent> {
    assertPayableAmount(i.amountMinor); assertPayableCurrency(i.currency);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`order-intent:${i.purpose}:${i.orderRef}`}))`;
      const existing = await tx.paymentIntent.findFirst({ where: { orderRef: i.orderRef, purpose: i.purpose, status: { in: ['CREATED', 'CAPTURED'] } } });
      if (existing) return existing;
      const id = newId('pay');
      const adapter = pspAdapter(i.psp ?? 'paymob');
      const co = await adapter.createCheckout({ paymentId: id, amountMinor: i.amountMinor, currency: i.currency });
      return tx.paymentIntent.create({ data: { id, orderRef: i.orderRef, purpose: i.purpose, sub: i.sub, clinicId: i.partnerId, amountMinor: i.amountMinor, currency: i.currency, psp: adapter.name, pspRef: co.pspRef, checkoutUrl: co.checkoutUrl } });
    }, { timeout: 20_000 });
  }

  /**
   * Order fulfilled: held funds become partner-payable minus Kiorex's marketplace take. Idempotent.
   * After a partial refund (policy pharmacy.partial_fulfilment) only the NET amount (captured - refunded) is released; `feeMinor` is capped at that net.
   * Pass `outer` to commit together with the refund (one transaction: a reader never sees a refund without the matching release).
   */
  async releaseOrder(paymentId: string, o: { feeMinor: number }, outer?: Tx) {
    const run = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => (outer ? fn(outer) : this.prisma.$transaction(fn));
    const p = await (outer ?? this.prisma).paymentIntent.findUnique({ where: { id: paymentId } });
    if (!p) throw notFound('PAYMENT_NOT_FOUND', 'Payment not found');
    if (!['CAPTURED', 'PARTIALLY_REFUNDED'].includes(p.status) || p.releasedAt) return null;
    const net = p.amountMinor - p.refundedMinor;
    if (net <= 0) return null;
    await run(async (tx) => {
      const c = await tx.paymentIntent.updateMany({ where: { id: p.id, releasedAt: null }, data: { releasedAt: new Date(), releaseKind: 'COMPLETED' } });
      if (c.count) await this.postLedger(tx, { key: `release-order:${p.id}`, kind: `RELEASE_ORDER_${p.purpose}`, postings: releaseOrder(p.clinicId, net, Math.min(Math.max(o.feeMinor, 0), net)), paymentId: p.id, clinicId: p.clinicId });
    });
    return 'RELEASED';
  }

  /** Cancelled/rejected order: refund the captured amount (idempotent per reason key); cancel an uncaptured intent. */
  async refundOrder(paymentId: string, reason: string, tx?: Tx) {
    const db = tx ?? this.prisma;
    const p = await db.paymentIntent.findUnique({ where: { id: paymentId } });
    if (!p) throw notFound('PAYMENT_NOT_FOUND', 'Payment not found');
    if (p.status === 'CREATED') { await db.paymentIntent.update({ where: { id: p.id }, data: { status: 'FAILED' } }); return null; }
    if (!['CAPTURED', 'PARTIALLY_REFUNDED'].includes(p.status) || p.releasedAt) return null;
    return this.refund(p.id, { reason, idempotencyKey: `refund-order:${p.id}:${reason}` }, tx);
  }

  async getIntent(id: string) {
    const p = await this.prisma.paymentIntent.findUnique({ where: { id } });
    if (!p) throw notFound('PAYMENT_NOT_FOUND', 'Payment not found');
    return p;
  }
  async intentForBooking(bookingId: string) {
    return this.prisma.paymentIntent.findFirst({ where: { bookingId }, orderBy: { createdAt: 'desc' } });
  }

  /**
   * Verified PSP webhook → idempotent capture / failure / refund settlement.
   * The receipt is the idempotency record: it is claimed FIRST (a unique-violation means another delivery of the same event owns it, so a concurrent
   * duplicate answers DUPLICATE instead of a 500) and it is RELEASED when processing fails, so the PSP's retry of that event is processed instead of
   * being dropped as a duplicate (a capture that failed once, e.g. unknown payment or a transient error, must never be lost).
   */
  async handlePspWebhook(psp: string, rawBody: string, headers: Record<string, unknown>, query: Record<string, unknown> = {}): Promise<{ status: string }> {
    let ev: PspWebhookEvent | null;
    try { ev = pspAdapter(psp).verifyWebhook(rawBody, headers, query); } catch { throw badRequest('INVALID_PSP_PAYLOAD', 'PSP payload could not be parsed'); }
    if (!ev) throw badRequest('INVALID_PSP_SIGNATURE', 'PSP signature rejected');
    if (!ev || typeof ev !== 'object' || typeof ev.eventId !== 'string' || !ev.eventId || !['payment.captured', 'payment.failed', 'refund.settled'].includes(ev.type) || !Number.isSafeInteger(ev.amountMinor) || ev.amountMinor < 0) throw badRequest('INVALID_PSP_PAYLOAD', 'PSP event is missing eventId, type or a whole-number amountMinor');
    const eventId = `psp:${ev.eventId}`;
    try {
      await this.prisma.webhookReceipt.create({ data: { eventId, source: `psp:${psp}`, type: ev.type, aggregateId: ev.paymentId ?? ev.pspRef, payload: JSON.parse(rawBody), status: 'PROCESSED', processedAt: new Date() } });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') return { status: 'DUPLICATE' };
      throw e;
    }
    try {
      if (ev.type === 'payment.captured') return { status: await this.capturePayment(ev) };
      if (ev.type === 'payment.failed') {
        const failed = await this.prisma.paymentIntent.findMany({ where: { OR: [{ id: ev.paymentId ?? '-' }, { pspRef: ev.pspRef }], status: 'CREATED' }, select: { bookingId: true } });
        await this.prisma.paymentIntent.updateMany({ where: { OR: [{ id: ev.paymentId ?? '-' }, { pspRef: ev.pspRef }], status: 'CREATED' }, data: { status: 'FAILED' } });
        for (const f of failed) if (f.bookingId && this.rewards) await this.rewards.releaseForBooking(f.bookingId, 'PAYMENT_FAILED'); // GRW-P2-B2: the reserved credit is free again
        return { status: 'FAILED_RECORDED' };
      }
      return { status: await this.settleRefundFromWebhook(ev) };
    } catch (e) {
      await this.prisma.webhookReceipt.delete({ where: { eventId } }).catch(() => undefined); // keep the event retryable
      throw e;
    }
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
    if (ev.currency && ev.currency !== p.currency) {
      await this.prisma.auditLog.create({ data: { actor: 'psp', action: 'pay.currency_mismatch', resource: 'PaymentIntent', resourceId: p.id, metadata: { expected: p.currency, got: ev.currency } } });
      throw conflict('CURRENCY_MISMATCH', 'Captured currency does not match intent');
    }
    const fee = ev.feeMinor ?? Math.round((p.amountMinor * cfg().pspFeeBps) / 10000); // NEEDS_HUMAN: PSP_FEE_BPS placeholder 0
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.paymentIntent.updateMany({ where: { id: p.id, status: { in: ['CREATED', 'FAILED'] } }, data: { status: 'CAPTURED', capturedAt: new Date(ev.occurredAt), feeMinor: fee } });
      if (!claimed.count) return;
      if (p.payLinkToken) await tx.payLink.updateMany({ where: { token: p.payLinkToken }, data: { status: 'PAID' } }); // a real PSP capture (not only the sandbox page) closes the link
      await this.postLedger(tx, { key: `capture:${p.id}`, kind: 'CAPTURE', postings: capture(p.clinicId, p.amountMinor), bookingId: p.bookingId, paymentId: p.id, clinicId: p.clinicId });
      if (p.rewardMinor > 0 && p.bookingId && this.rewards) { // GRW-P2-B2: the reservation becomes a REDEEM in this transaction; the Pay ledger moves only for the patient's own refund credit (always) and for promotional credit when REWARD_RULES.postToPayLedger is true
        const red = await this.rewards.redeemOnCapture(tx, { bookingId: p.bookingId, paymentId: p.id });
        if (red.totalMinor !== p.rewardMinor) await tx.auditLog.create({ data: { actor: 'system', action: 'pay.reward_mismatch', resource: 'PaymentIntent', resourceId: p.id, metadata: { expected: p.rewardMinor, redeemed: red.totalMinor } } });
        const posted = red.postedMinor;
        if (posted > 0) await this.postLedger(tx, { key: `reward-tender:${p.id}`, kind: 'REWARD_TENDER', postings: rewardTender(p.clinicId, red.patientRefundMinor, posted - red.patientRefundMinor), bookingId: p.bookingId, paymentId: p.id, clinicId: p.clinicId });
        await tx.paymentIntent.update({ where: { id: p.id }, data: { rewardMinor: red.totalMinor, rewardPostedMinor: posted } });
      }
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
    // GRW-P2-B2: the Clinic is told the GROSS deposit (card plus credit) and how it was funded (never a patient identity); without credit the call is byte-identical to before
    const body = { amount: toMajor(p.amountMinor + p.rewardMinor), currency: p.currency, paymentRef: p.id, paidAt: (p.capturedAt ?? new Date()).toISOString(), ...(p.rewardMinor > 0 ? { tender: { cardMinor: p.amountMinor, patientCreditMinor: p.rewardMinor } } : {}) };
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
  /** Pass `outer` to run inside the caller's transaction (e.g. order REJECTED/CANCELLED + refund commit together, so no reader sees the new status with an un-refunded payment). */
  async refund(paymentId: string, o: { reason: string; amountMinor?: number; idempotencyKey: string; reviewedBy?: string; destination?: 'ORIGINAL' | 'CREDIT'; source?: 'PATIENT_CANCEL' | 'PATIENT_REFUND_REQUEST' }, outer?: Tx) {
    const existing = await (outer ?? this.prisma).refund.findUnique({ where: { idempotencyKey: o.idempotencyKey } });
    if (existing) return existing;
    const run = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => (outer ? fn(outer) : this.prisma.$transaction(fn));
    return run(async (tx) => {
      const rows = await tx.$queryRaw<PaymentIntent[]>(Prisma.sql`SELECT * FROM "PaymentIntent" WHERE id = ${paymentId} FOR UPDATE`);
      const p = rows[0];
      if (!p) throw notFound('PAYMENT_NOT_FOUND', 'Payment not found');
      if (!['CAPTURED', 'PARTIALLY_REFUNDED'].includes(p.status)) throw conflict('NOT_REFUNDABLE', `Payment is ${p.status}`);
      // Released (completed visit / forfeited deposit / fulfilled order) money is owed to the partner, no longer HELD: refunding it here would drive the HELD account negative.
      if (p.releasedAt) throw conflict('ALREADY_RELEASED', 'Payment was already released to the provider; a refund needs a payout reversal, not a refund request');
      const remaining = p.amountMinor - p.refundedMinor;
      const amount = o.amountMinor ?? remaining;
      if (amount <= 0 || amount > remaining) throw badRequest('REFUND_EXCEEDS_CAPTURE', 'Refund exceeds remaining captured amount', { remaining });
      const refund = await tx.refund.create({ data: { id: newId('rf'), paymentId, amountMinor: amount, reason: o.reason, idempotencyKey: o.idempotencyKey } });
      await tx.paymentIntent.update({ where: { id: paymentId }, data: { refundedMinor: p.refundedMinor + amount, status: p.refundedMinor + amount === p.amountMinor ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } });
      // KXMPAY07: a deposit held for review is refunded OUT OF the review hold, not out of the clinic's HELD balance
      const heldForReview = p.reviewState === 'HELD_FOR_REVIEW';
      await this.postLedger(tx, { key: `refund-req:${refund.id}`, kind: heldForReview ? 'REVIEW_REFUND_REQUEST' : 'REFUND_REQUEST', postings: heldForReview ? refundFromReview(p.clinicId, amount) : refundRequest(p.clinicId, amount), bookingId: p.bookingId, paymentId, clinicId: p.clinicId });
      if (heldForReview && p.refundedMinor + amount === p.amountMinor) {
        await tx.paymentIntent.update({ where: { id: paymentId }, data: { reviewState: 'REFUNDED_TO_PATIENT', reviewedAt: new Date(), reviewedBy: o.reviewedBy ?? 'system' } });
        await this.outbox.enqueue(tx, { type: 'pay.review_resolved', aggregateType: 'PaymentIntent', aggregateId: paymentId, payload: { paymentId, bookingId: p.bookingId, outcome: 'REFUNDED' }, dedupeKey: `pay.review_resolved:${paymentId}` });
      }
      if (this.rewards && p.bookingId && p.sub && (p.rewardMinor > 0 || o.source)) {
        // GRW-P2-B2: a refund the PATIENT started records where it goes (default ORIGINAL; CREDIT only as an option while all three switches say so) and gives back the credit that paid part of the deposit
        const destination = o.destination === 'CREDIT' && o.source && (await this.rewards.refundCreditAvailable()) ? 'CREDIT' : 'ORIGINAL';
        const res = await this.rewards.onRefundCreated(tx, { bookingId: p.bookingId, sub: p.sub, paymentId, refundId: refund.id, cardRefundMinor: amount, paymentCardMinor: p.amountMinor, paymentRewardMinor: p.rewardMinor, paymentRewardPostedMinor: p.rewardPostedMinor, alreadyRefundedMinor: p.refundedMinor, destination, source: o.source ?? null, currency: p.currency });
        if (res.postedRestoredMinor > 0) {
          const patientPart = Math.min(res.patientRefundRestoredMinor, res.postedRestoredMinor);
          await this.postLedger(tx, { key: `reward-restore:${refund.id}`, kind: 'REWARD_RESTORE', postings: rewardRestore(heldForReview ? A.reviewHold(p.clinicId) : A.held(p.clinicId), patientPart, res.postedRestoredMinor - patientPart), bookingId: p.bookingId, paymentId, clinicId: p.clinicId });
          await tx.paymentIntent.update({ where: { id: paymentId }, data: { rewardPostedMinor: p.rewardPostedMinor - res.postedRestoredMinor } });
        }
      }
      await this.outbox.enqueue(tx, { type: 'pay.refund_requested', aggregateType: 'Refund', aggregateId: refund.id, payload: { refundId: refund.id }, dedupeKey: `pay.refund_requested:${refund.id}` });
      return refund;
    });
  }

  async settleRefund(refundId: string) {
    const r = await this.prisma.refund.findUnique({ where: { id: refundId }, include: { payment: true } });
    if (!r || r.status === 'SETTLED' || r.status === 'CREDITED') return;
    // GRW-P2-B2: the patient chose "keep as credit" (an option, never the default): the money stays at Kiorex as a REFUND_CREDIT lot and no PSP call is made. A PSP refund that FAILS never becomes credit
    // (the refund stays REQUESTED for ops and the reconciliation flags it); and when credit can no longer be issued (switch turned off in between) the refund goes to the original method as usual.
    const choice = this.rewards ? await this.prisma.refundDestinationChoice.findUnique({ where: { refundId } }) : null;
    if (choice?.choice === 'CREDIT' && this.rewards) {
      const lot = await this.rewards.issueRefundCredit({ sub: choice.sub, bookingId: r.payment.bookingId, refundId, amountMinor: r.amountMinor, currency: r.payment.currency });
      if (lot) { await this.finalizeRefundAsCredit(r, lot.lotId); return; }
      await this.prisma.auditLog.create({ data: { actor: 'system', action: 'pay.refund_credit_unavailable', resource: 'Refund', resourceId: refundId, metadata: { fallback: 'ORIGINAL' } } });
    }
    const out = await pspAdapter(r.payment.psp).refund({ pspRef: r.payment.pspRef ?? '', refundId: r.id, amountMinor: r.amountMinor });
    await this.finalizeRefund(r, out.pspRefundRef);
  }

  /** The refund became a credit lot: REFUND_PAYABLE -> PATIENT_REFUND_CREDIT (the money never left Kiorex), no PSP movement. Idempotent on the refund id. */
  private async finalizeRefundAsCredit(r: { id: string; paymentId: string; amountMinor: number; payment: { bookingId: string | null; clinicId: string } }, lotId: string) {
    await this.prisma.$transaction(async (tx) => {
      await this.postLedger(tx, { key: `refund-credit:${r.id}`, kind: 'REFUND_TO_CREDIT', postings: refundToCredit(r.amountMinor), bookingId: r.payment.bookingId, paymentId: r.paymentId, clinicId: r.payment.clinicId });
      await tx.refund.update({ where: { id: r.id }, data: { status: 'CREDITED', settledAt: new Date() } });
      await this.outbox.enqueue(tx, { type: 'pay.refund_settled', aggregateType: 'Refund', aggregateId: r.id, payload: { refundId: r.id, bookingId: r.payment.bookingId, amountMinor: r.amountMinor, destination: 'CREDIT', lotId }, dedupeKey: `pay.refund_settled:${r.id}` });
    });
  }

  /** An expired REFUND_CREDIT lot: its unspent rest is the patient's own money and returns to the ORIGINAL payment method (a system reversal, never a patient-triggered cash-out). Idempotent per lot and amount. */
  async refundCreditExpired(payload: { lotId: string; amountMinor: number }) {
    const issue = await this.prisma.rewardLedgerEntry.findFirst({ where: { lotId: payload.lotId, type: 'ISSUE', refundId: { not: null } } });
    const source = issue?.refundId ? await this.prisma.refund.findUnique({ where: { id: issue.refundId }, include: { payment: true } }) : null;
    if (!source) { await this.prisma.auditLog.create({ data: { actor: 'system', action: 'pay.refund_credit_expiry_no_source', resource: 'RewardLot', resourceId: payload.lotId, metadata: { amountMinor: payload.amountMinor } } }); return; }
    const key = `refund-credit-expiry:${payload.lotId}:${payload.amountMinor}`;
    const existing = await this.prisma.refund.findUnique({ where: { idempotencyKey: key } });
    if (existing) { await this.settleRefund(existing.id); return; }
    const rf = await this.prisma.$transaction(async (tx) => {
      const created = await tx.refund.create({ data: { id: newId('rf'), paymentId: source.paymentId, amountMinor: payload.amountMinor, reason: 'REFUND_CREDIT_EXPIRED', idempotencyKey: key } });
      await this.postLedger(tx, { key: `refund-credit-expiry:${created.id}`, kind: 'REFUND_CREDIT_EXPIRED', postings: refundCreditExpired(payload.amountMinor), bookingId: source.payment.bookingId, paymentId: source.paymentId, clinicId: source.payment.clinicId });
      await this.outbox.enqueue(tx, { type: 'pay.refund_requested', aggregateType: 'Refund', aggregateId: created.id, payload: { refundId: created.id }, dedupeKey: `pay.refund_requested:${created.id}` });
      return created;
    });
    return rf;
  }

  /** Idempotent: ledger posting is keyed on the refund id, so the sync path and a later `refund.settled` webhook cannot double-post. */
  private async finalizeRefund(r: { id: string; paymentId: string; amountMinor: number; payment: { bookingId: string | null; clinicId: string } }, pspRefundRef: string) {
    await this.prisma.$transaction(async (tx) => {
      await this.postLedger(tx, { key: `refund-settle:${r.id}`, kind: 'REFUND_SETTLED', postings: refundSettle(r.amountMinor), bookingId: r.payment.bookingId, paymentId: r.paymentId, clinicId: r.payment.clinicId });
      await tx.refund.update({ where: { id: r.id }, data: { status: 'SETTLED', pspRefundRef, settledAt: new Date() } });
      await this.outbox.enqueue(tx, { type: 'pay.refund_settled', aggregateType: 'Refund', aggregateId: r.id, payload: { refundId: r.id, bookingId: r.payment.bookingId, amountMinor: r.amountMinor }, dedupeKey: `pay.refund_settled:${r.id}` });
    });
  }

  /** PSP `refund.settled` webhook: matches the refund by the PSP refund reference (or the payment's open refund) and settles it once. */
  private async settleRefundFromWebhook(ev: PspWebhookEvent): Promise<string> {
    const r = await this.prisma.refund.findFirst({
      where: { OR: [{ pspRefundRef: ev.pspRef }, ...(ev.paymentId ? [{ paymentId: ev.paymentId, status: 'REQUESTED' }] : [])] },
      include: { payment: true }, orderBy: { createdAt: 'desc' },
    });
    if (!r) return 'REFUND_NOT_FOUND';
    if (r.status === 'SETTLED') return 'ALREADY_SETTLED';
    await this.finalizeRefund(r, ev.pspRef || r.pspRefundRef || `webhook_${r.id}`);
    return 'REFUND_SETTLED';
  }

  /** Booking cancelled/expired: refund a captured deposit; cancel an uncaptured intent. */
  async refundForBooking(bookingId: string, reason: string, opts: { destination?: 'ORIGINAL' | 'CREDIT'; source?: 'PATIENT_CANCEL' | 'PATIENT_REFUND_REQUEST' } = {}) {
    const p = await this.intentForBooking(bookingId);
    if (!p) return null;
    if (p.status === 'CREATED') { await this.prisma.paymentIntent.update({ where: { id: p.id }, data: { status: 'FAILED' } }); await this.rewards?.releaseForBooking(bookingId, 'BOOKING_ENDED'); return null; }
    if (p.status !== 'CAPTURED' && p.status !== 'PARTIALLY_REFUNDED') return null;
    if (p.releasedAt) return null; // already released to the clinic (completed / forfeited)
    if (p.reviewState === 'HELD_FOR_REVIEW') return null; // KXMPAY07: only an ops decision moves a held deposit
    return this.refund(p.id, { reason, idempotencyKey: `refund:${bookingId}:${reason}`, ...(opts.source ? { destination: opts.destination ?? 'ORIGINAL', source: opts.source } : {}) });
  }

  // ───────────── release / forfeit ─────────────

  async releaseForBooking(bookingId: string, kind: 'COMPLETED' | 'FORFEITED') {
    const p = await this.intentForBooking(bookingId);
    if (!p || p.status !== 'CAPTURED' || p.releasedAt) return null;
    if (p.reviewState === 'HELD_FOR_REVIEW') return null; // never auto-forfeited / auto-released while under review (KXMPAY07)
    const n = this.heldMinor(p);
    await this.prisma.$transaction(async (tx) => {
      const c = await tx.paymentIntent.updateMany({ where: { id: p.id, releasedAt: null }, data: { releasedAt: new Date(), releaseKind: kind } });
      if (c.count) await this.postLedger(tx, { key: `release:${p.id}`, kind: `RELEASE_${kind}`, postings: release(p.clinicId, n), bookingId, paymentId: p.id, clinicId: p.clinicId });
    });
    return kind;
  }

  // ───────────── KXMPAY07: deposit hold-for-review (unsafe-aborted home visit) ─────────────

  /**
   * HOME_VISIT_ABORTED_UNSAFE: the captured deposit moves HELD -> REVIEW_HOLD. No no-show charge, never auto-forfeited, never auto-refunded:
   * ops decides (reviewRelease / reviewRefund). Idempotent per payment (ledger key + guarded state change).
   */
  async holdForReview(bookingId: string, reason: string) {
    const p = await this.intentForBooking(bookingId);
    if (!p) return null;
    if (p.status === 'CREATED') { await this.prisma.paymentIntent.update({ where: { id: p.id }, data: { status: 'FAILED' } }); await this.rewards?.releaseForBooking(bookingId, 'BOOKING_ENDED'); return null; } // never paid: nothing to hold
    if (!['CAPTURED', 'PARTIALLY_REFUNDED'].includes(p.status) || p.releasedAt) return null;
    const n = this.heldMinor(p);
    if (n <= 0) return null;
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.paymentIntent.updateMany({ where: { id: p.id, reviewState: null, releasedAt: null }, data: { reviewState: 'HELD_FOR_REVIEW', heldForReviewAt: new Date(), reviewReason: reason } });
      if (!claimed.count) return p;
      await this.postLedger(tx, { key: `hold-review:${p.id}`, kind: 'HOLD_FOR_REVIEW', postings: holdForReview(p.clinicId, n), bookingId, paymentId: p.id, clinicId: p.clinicId });
      await tx.auditLog.create({ data: { actor: 'system', action: 'pay.hold_for_review', resource: 'PaymentIntent', resourceId: p.id, metadata: { bookingId, reason, amountMinor: n } } });
      return tx.paymentIntent.findUniqueOrThrow({ where: { id: p.id } });
    });
  }

  /** Ops decision: the held deposit goes to the provider's payable (a reviewed forfeit). Reason required; audited. */
  async reviewRelease(paymentId: string, actor: string, reason: string) {
    if (!reason?.trim()) throw badRequest('REASON_REQUIRED', 'A review decision needs a reason');
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<PaymentIntent[]>(Prisma.sql`SELECT * FROM "PaymentIntent" WHERE id = ${paymentId} FOR UPDATE`);
      const p = rows[0];
      if (!p) throw notFound('PAYMENT_NOT_FOUND', 'Payment not found');
      if (p.reviewState !== 'HELD_FOR_REVIEW') throw conflict('NOT_HELD_FOR_REVIEW', `Payment review state is ${p.reviewState ?? 'none'}`);
      const n = this.heldMinor(p);
      await this.postLedger(tx, { key: `review-release:${p.id}`, kind: 'REVIEW_RELEASE', postings: releaseFromReview(p.clinicId, n), bookingId: p.bookingId, paymentId: p.id, clinicId: p.clinicId });
      await tx.paymentIntent.update({ where: { id: p.id }, data: { reviewState: 'RELEASED_TO_PROVIDER', reviewedBy: actor, reviewedAt: new Date(), reviewReason: `${p.reviewReason ?? ''} | ${reason}`.slice(0, 500), releasedAt: new Date(), releaseKind: 'REVIEW_RELEASED' } });
      await tx.auditLog.create({ data: { actor, action: 'pay.review_release', resource: 'PaymentIntent', resourceId: p.id, metadata: { reason, amountMinor: n } } });
      await this.outbox.enqueue(tx, { type: 'pay.review_resolved', aggregateType: 'PaymentIntent', aggregateId: p.id, payload: { paymentId: p.id, bookingId: p.bookingId, outcome: 'RELEASED' }, dedupeKey: `pay.review_resolved:${p.id}` });
      return { paymentId: p.id, outcome: 'RELEASED_TO_PROVIDER' as const, amountMinor: n };
    });
  }

  /** Ops decision: the held deposit is refunded to the patient (through the normal refund path, out of REVIEW_HOLD). */
  async reviewRefund(paymentId: string, actor: string, reason: string) {
    if (!reason?.trim()) throw badRequest('REASON_REQUIRED', 'A review decision needs a reason');
    const p = await this.getIntent(paymentId);
    if (p.reviewState !== 'HELD_FOR_REVIEW') throw conflict('NOT_HELD_FOR_REVIEW', `Payment review state is ${p.reviewState ?? 'none'}`);
    await this.prisma.auditLog.create({ data: { actor, action: 'pay.review_refund', resource: 'PaymentIntent', resourceId: p.id, metadata: { reason } } });
    await this.prisma.paymentIntent.update({ where: { id: p.id }, data: { reviewReason: `${p.reviewReason ?? ''} | ${reason}`.slice(0, 500) } });
    const refund = await this.refund(p.id, { reason: `REVIEW:${reason}`, idempotencyKey: `review-refund:${p.id}`, reviewedBy: actor });
    return { paymentId: p.id, outcome: 'REFUNDED_TO_PATIENT' as const, refundId: refund.id, amountMinor: refund.amountMinor };
  }

  /** Ops queue: deposits held for review, oldest first, with their booking context (district only). */
  async heldForReview() {
    const rows = await this.prisma.paymentIntent.findMany({ where: { reviewState: 'HELD_FOR_REVIEW' }, orderBy: { heldForReviewAt: 'asc' }, take: 200 });
    const books = await this.prisma.bookingIntent.findMany({ where: { id: { in: rows.map((r) => r.bookingId ?? '-') } }, select: { id: true, providerId: true, visitDistrict: true, abortedAt: true, status: true, homeState: true } });
    return rows.map((p) => {
      const b = books.find((x) => x.id === p.bookingId);
      return { paymentId: p.id, bookingId: p.bookingId, clinicId: p.clinicId, amountMinor: this.heldMinor(p), currency: p.currency, reason: p.reviewReason, heldForReviewAt: p.heldForReviewAt, ageHours: p.heldForReviewAt ? Math.round(((Date.now() - p.heldForReviewAt.getTime()) / 3600_000) * 10) / 10 : null, providerId: b?.providerId ?? null, district: b?.visitDistrict ?? null, abortedAt: b?.abortedAt ?? null };
    });
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
      const amount = items.reduce((s, p) => s + this.heldMinor(p), 0);
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

  async createPayLink(i: { token: string; clinicId: string; amountMinor: number; currency?: string; externalRef?: string; expiresAt?: Date }): Promise<PayLink> {
    if (!i.token) throw badRequest('INVALID_LINK', 'token required');
    assertPayableAmount(i.amountMinor); assertPayableCurrency(i.currency ?? 'EGP');
    const currency = i.currency ?? 'EGP';
    const existing = await this.prisma.payLink.findUnique({ where: { token: i.token } });
    if (existing) {
      // idempotent for the SAME link; a different amount / clinic / currency under a known token is a conflict, never a silent no-op
      if (existing.clinicId !== i.clinicId || existing.amountMinor !== i.amountMinor || existing.currency !== currency) throw conflict('PAY_LINK_CONFLICT', 'A pay link with this token already exists with different values');
      return existing;
    }
    try {
      return await this.prisma.payLink.create({ data: { token: i.token, clinicId: i.clinicId, amountMinor: i.amountMinor, currency, externalRef: i.externalRef, expiresAt: i.expiresAt ?? new Date(Date.now() + 7 * 86400_000) } });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') return this.createPayLink(i); // concurrent registration of the same token: re-read and compare
      throw e;
    }
  }
  async payLink(token: string) {
    const l = await this.prisma.payLink.findUnique({ where: { token } });
    if (!l) throw notFound('LINK_NOT_FOUND', 'Pay link not found');
    return { token: l.token, clinicId: l.clinicId, amountMinor: l.amountMinor, currency: l.currency, status: l.expiresAt < new Date() && l.status === 'OPEN' ? 'EXPIRED' : l.status, expiresAt: l.expiresAt };
  }
  async payLinkCheckout(token: string) {
    await this.flags.assertEnabled('kiorex.pay_deposits', { market: 'EG' });
    // One link, one live intent: concurrent checkouts are serialised on the link, and an intent that FAILED (PSP declined / timed out) is replaced by a new one
    // so the patient can retry; a CAPTURED link is closed (never charged twice).
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pay-link:${token}`}))`;
      const l = await tx.payLink.findUnique({ where: { token } });
      if (!l || l.status !== 'OPEN' || l.expiresAt < new Date()) throw conflict('LINK_NOT_PAYABLE', 'Pay link is not payable');
      if (l.paymentIntentId) {
        const cur = await tx.paymentIntent.findUnique({ where: { id: l.paymentIntentId } });
        if (cur && cur.status !== 'FAILED') return cur;
      }
      const id = newId('pay');
      const a = pspAdapter('paymob');
      const co = await a.createCheckout({ paymentId: id, amountMinor: l.amountMinor, currency: l.currency });
      const intent = await tx.paymentIntent.create({ data: { id, payLinkToken: token, clinicId: l.clinicId, amountMinor: l.amountMinor, currency: l.currency, psp: a.name, pspRef: co.pspRef, checkoutUrl: co.checkoutUrl } });
      await tx.payLink.update({ where: { token }, data: { paymentIntentId: id } });
      return intent;
    }, { timeout: 20_000 });
  }

  // ───────────── fake hosted checkout (sandbox only) ─────────────

  async fakeComplete(paymentId: string, outcome: 'pay' | 'fail') {
    if (cfg().pspMode !== 'sandbox-fake' || !cfg().sandboxPaymentsAllowed) throw notFound('NOT_FOUND', 'Not found');
    const p = await this.getIntent(paymentId);
    const ev: PspWebhookEvent = { eventId: newId('pspev'), type: outcome === 'pay' ? 'payment.captured' : 'payment.failed', pspRef: p.pspRef ?? '', paymentId: p.id, amountMinor: p.amountMinor, feeMinor: Math.round((p.amountMinor * cfg().pspFeeBps) / 10000), occurredAt: new Date().toISOString() };
    const raw = JSON.stringify(ev);
    const r = await this.handlePspWebhook(p.psp, raw, { 'x-psp-signature': FakePspAdapter.sign(raw) });
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
    const heldNoLedger = await this.prisma.$queryRaw<{ id: string }[]>`SELECT p.id FROM "PaymentIntent" p WHERE p."reviewState" = 'HELD_FOR_REVIEW' AND NOT EXISTS (SELECT 1 FROM "LedgerTx" t WHERE t."idempotencyKey" = 'hold-review:' || p.id)`;
    for (const n of heldNoLedger) disc.push({ type: 'REVIEW_HOLD_WITHOUT_LEDGER', ref: n.id });
    // vertical orders: once released (fulfilled, or partially fulfilled with a pro-rata refund) nothing may stay HELD for that payment (captured = refunded + released)
    const heldAfterRelease = await this.prisma.$queryRaw<{ id: string }[]>`SELECT p.id FROM "PaymentIntent" p WHERE p.purpose <> 'DEPOSIT' AND p."releasedAt" IS NOT NULL AND (SELECT COALESCE(SUM(e."creditMinor" - e."debitMinor"), 0) FROM "LedgerEntry" e JOIN "LedgerTx" t ON t.id = e."txId" WHERE t."paymentId" = p.id AND e.account LIKE 'HELD:%') <> 0`;
    for (const n of heldAfterRelease) disc.push({ type: 'ORDER_HELD_AFTER_RELEASE', ref: n.id });
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
    const held = await this.prisma.paymentIntent.aggregate({ where: { reviewState: 'HELD_FOR_REVIEW' }, _count: true, _sum: { amountMinor: true, refundedMinor: true } });
    return { intents, refunds, payouts, reconciliationRuns: runs, balances, heldForReview: { count: held._count, amountMinor: (held._sum.amountMinor ?? 0) - (held._sum.refundedMinor ?? 0) } };
  }
}
