import { Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { PayLink, PaymentIntent, Prisma } from '../prisma/generated/client';
import { cfg } from '../common/config';
import { badRequest, conflict, notFound } from '../common/errors';
import { newId, toMajor } from '../common/ids';
import { FlagsService } from '../control-plane/control-plane-public';
import { KiorlyClient, KiorlyHttpError } from '../kiorly/kiorly-public';
import { CORPORATE_BENEFIT_PORT, PAYMENT_SIGNALS_PORT, REWARDS_PORT, SPONSORED_PAY_PORT, type CorporateBenefitPort, type PaymentSignalsPort, type RewardsPort, type SponsoredPayPort } from '../growth/growth-ports-public';
import { OutboxService } from '../outbox/outbox-public';
import { MARKET_FACTS } from '../market/market-public';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { A, assertValid, LedgerTxInput, capture, chargebackFromHeld, chargebackFromPayable, chargebackLoss, corporateTender, corporateVoid, holdForReview, payout as payoutPosting, pspFee, refundCreditExpired, refundFromReview, refundRequest, refundSettle, refundToCredit, release, releaseFromReview, releaseOrder, rewardRestore, rewardTender, sponsorTender, sponsorVoid } from './ledger';
import { corporateReversedByRefund, sponsoredVoidedByRefund } from './refund-allocation';
import { FakePspAdapter, pspAdapter, PspWebhookEvent } from './psp';
import { PspCircuitOpenError } from './psp-breaker';
import { feeFor, minorDigits, withinRefundWindow, type PspSettings } from './psp-config';
import { PspConfigService } from './psp-config.service';
import { depositLines as composeLines, splitDeposit } from './deposit-allocation';
import { postLedgerTx } from './pay-ledger';
import { PayReconcileService } from './pay-reconcile.service';
import { unavailable } from '../common/errors';
import { PSP_EVENT_TYPES } from '../common/providers/vendors/psp-event';

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
  private pollTimer?: NodeJS.Timeout;
  private orderHandlers = new Map<string, (p: { paymentId: string; orderRef: string; amountMinor: number }) => Promise<void>>();
  constructor(private readonly prisma: PrismaService, private readonly outbox: OutboxService, private readonly kiorly: KiorlyClient, private readonly flags: FlagsService, @Optional() @Inject(REWARDS_PORT) private readonly rewards?: RewardsPort, @Optional() @Inject(SPONSORED_PAY_PORT) private readonly sponsored?: SponsoredPayPort, @Optional() @Inject(CORPORATE_BENEFIT_PORT) private readonly corporate?: CorporateBenefitPort, @Optional() @Inject(PAYMENT_SIGNALS_PORT) private readonly signals?: PaymentSignalsPort, @Optional() private readonly pspConfig?: PspConfigService, @Optional() private readonly recon?: PayReconcileService) {}

  /** What the Pay ledger holds for a deposit: the card money still held plus the credit part posted into HELD (GRW-P2-B2). Equals amountMinor - refundedMinor when no credit was used. */
  private heldMinor(p: { amountMinor: number; refundedMinor: number; rewardPostedMinor?: number; sponsoredPostedMinor?: number; corporatePostedMinor?: number }): number { return p.amountMinor - p.refundedMinor + (p.rewardPostedMinor ?? 0) + (p.sponsoredPostedMinor ?? 0) + (p.corporatePostedMinor ?? 0); } // GRW-P2-S: plus the sponsored part posted into HELD (only when postToPayLedger)

  onModuleInit() {
    this.outbox.register('kiorly.deposit_paid', (e) => this.notifyKiorlyDeposit(e.payload));
    this.outbox.register('kiorly.payout_recorded', (e) => this.notifyKiorlyPayout(e.payload));
    this.outbox.register('pay.refund_requested', (e) => this.settleRefund(e.payload.refundId));
    this.outbox.register('pay.refund_settled', async () => undefined);
    this.outbox.register('pay.corporate_move', async (e) => { // PAY-READY: the corporate benefit ledger follows the payment (redeem on capture, reverse on refund / forfeit, release on a failed payment); idempotent per key, retried by the outbox
      const c = this.corporate; if (!c) return;
      const { op, bookingId, amountMinor, key, reason } = e.payload as { op: 'redeem' | 'reverse' | 'release'; bookingId: string; amountMinor?: number; key: string; reason?: string };
      if (op === 'redeem') await c.redeem(bookingId, reason, key);
      else if (op === 'reverse') {
        const got = await c.reverse(bookingId, amountMinor, reason, key);
        if (amountMinor && got < amountMinor && (await c.bookingUse(bookingId)).held > 0) throw new Error('CORPORATE_REDEEM_PENDING'); // the capture's redeem has not run yet: retry, never lose the reversal
      } else await c.release(bookingId, reason, amountMinor, key);
    });
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
      if (cfg().pspMode === 'real') { this.pollTimer = setInterval(() => void this.pollPending().catch(() => undefined), 5 * 60_000); this.pollTimer.unref(); } // status polling fallback for callbacks that never arrived
    }
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); if (this.pollTimer) clearInterval(this.pollTimer); }

  // ───────────── ledger persistence ─────────────

  private postLedger(tx: Tx, t: LedgerTxInput & { bookingId?: string | null; paymentId?: string; clinicId?: string }): Promise<boolean> { return postLedgerTx(tx, t); }

  // ───────────── deposits (KXM-PAY-01) ─────────────

  /** The PSP and its settings for a new payment (config: enabled PSPs per market, order of preference, sandbox/live, 3DS and capture mode). */
  private async pspFor(currency: string, requested?: string): Promise<{ name: string; settings: PspSettings }> {
    if (!this.pspConfig) return { name: requested ?? 'paymob', settings: (await import('./psp-config')).resolveSettings((requested ?? 'paymob') as never, '*') };
    const c = await this.pspConfig.choose({ currency, requested });
    return { name: c.psp, settings: c.settings };
  }

  /** Idempotent per booking: returns the existing open intent. Caller (booking) gates on kiorex.pay_deposits. */
  async createDepositIntent(i: { bookingId: string; sub: string; clinicId: string; amountMinor: number; currency: string; psp?: string; rewardMinor?: number; sponsoredMinor?: number; corporateMinor?: number }): Promise<PaymentIntent> {
    assertPayableAmount(i.amountMinor); assertPayableCurrency(i.currency);
    const chosenList = this.pspConfig ? await this.pspConfig.candidates({ currency: i.currency, requested: i.psp }) : [await this.pspFor(i.currency, i.psp).then((c) => ({ psp: c.name as never, settings: c.settings }))];
    // Two concurrent checkouts of one booking (double click, two tabs) must not create two charges: serialise per booking, then re-read.
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`deposit-intent:${i.bookingId}`}))`;
      const existing = await tx.paymentIntent.findFirst({ where: { bookingId: i.bookingId, status: { in: ['CREATED', 'AUTHORIZED', 'CAPTURED'] } } });
      if (existing) return existing;
      const id = newId('pay');
      let last: unknown;
      for (const chosen of chosenList) { // failover: a PSP whose circuit is open (it is failing) is skipped for the next in the order of preference; any other error is real and stops here
        const adapter = pspAdapter(chosen.psp, chosen.settings);
        try {
          const co = await adapter.createCheckout({ paymentId: id, amountMinor: i.amountMinor, currency: i.currency, captureMode: chosen.settings.captureMode, threeDsMode: chosen.settings.threeDsMode, decimals: minorDigits(chosen.settings, i.currency) });
          return await tx.paymentIntent.create({ data: { id, bookingId: i.bookingId, sub: i.sub, clinicId: i.clinicId, amountMinor: i.amountMinor, currency: i.currency, psp: adapter.name, pspRef: co.pspRef, checkoutUrl: co.checkoutUrl, rewardMinor: i.rewardMinor ?? 0, sponsoredMinor: i.sponsoredMinor ?? 0, corporateMinor: i.corporateMinor ?? 0, pspMode: cfg().pspMode === 'real' ? chosen.settings.mode : null } });
        } catch (e) { last = e; if (!(e instanceof PspCircuitOpenError)) throw e; }
      }
      const e = last as PspCircuitOpenError; throw unavailable('PSP_UNAVAILABLE', 'The payment provider is temporarily unavailable, please try again shortly', { retryable: true, retryAfterMs: e?.retryAfterMs });
    }, { timeout: 20_000 });
  }

  /** The PSP checkout call. An open circuit (the gateway is failing) answers the patient 503 PSP_UNAVAILABLE at once, retryable, instead of hanging a checkout on a dead gateway. */
  private async checkoutCall(adapter: ReturnType<typeof pspAdapter>, i: Parameters<ReturnType<typeof pspAdapter>['createCheckout']>[0]) {
    try { return await adapter.createCheckout(i); }
    catch (e) { if (e instanceof PspCircuitOpenError) throw unavailable('PSP_UNAVAILABLE', 'The payment provider is temporarily unavailable, please try again shortly', { retryable: true, retryAfterMs: e.retryAfterMs }); throw e; }
  }

  /**
   * GRW-P2-B2: the deposit checkout with credit. The credit (a coupon, or credit lots when patient credit is effective) is RESERVED for this booking first (idempotent per booking), the card is
   * charged for the rest (never less than one minor unit), and the reservation becomes a REDEEM in the transaction that records the capture. If the intent cannot be created the reservation is
   * released. With the rewards switch OFF (or nothing applicable) this is exactly `createDepositIntent`.
   */
  async createDepositIntentWithRewards(i: { bookingId: string; sub: string; clinicId: string; amountMinor: number; currency: string; psp?: string; serviceKind: 'IN_CLINIC' | 'VIDEO' | 'HOME_VISIT'; specialty?: string | null; dependantId?: string | null; couponCode?: string | null; lotId?: string | null }): Promise<{ intent: PaymentIntent; rewardMinor: number; sponsoredMinor: number; corporateMinor: number; lines: Array<{ code: string; amountMinor: number; labelKey: string }>; couponProblem?: string }> {
    const open = await this.prisma.paymentIntent.findFirst({ where: { bookingId: i.bookingId, status: { in: ['CREATED', 'AUTHORIZED', 'CAPTURED'] } } });
    if (open) return { intent: open, rewardMinor: open.rewardMinor, sponsoredMinor: open.sponsoredMinor, corporateMinor: open.corporateMinor, lines: this.depositLines(open) };
    // Tender order (deposit-allocation.ts, founder rule H-27): sponsored discount (a price reduction) -> corporate benefit (of what is still payable) -> patient credit -> card (never less than one minor unit).
    const line = i.amountMinor > 1 ? await this.sponsored?.lineForDeposit(i.bookingId).catch(() => null) : null;
    const sponsoredMinor = line && line.currency === i.currency ? Math.min(line.amountMinor, i.amountMinor - 1) : 0;
    const afterSponsored = i.amountMinor - sponsoredMinor;
    // GRW-P4-C: the corporate benefit covers a share of the deposit Kiorex collects. It is reserved here (idempotent per booking) and redeemed in the capture transaction; the provider's income does not change (the Clinic is told the GROSS deposit).
    let corporateMinor = 0;
    if (this.corporate && afterSponsored > 1 && !i.dependantId) {
      const res = await this.corporate.reserve(i.sub, i.bookingId, { payableMinor: afterSponsored }).catch(() => null);
      if (res && res.currency === i.currency) {
        corporateMinor = Math.min(res.amountMinor, afterSponsored - 1);
        if (corporateMinor < res.amountMinor) await this.corporate.release(i.bookingId, 'CHECKOUT_CAP', res.amountMinor - corporateMinor, `clamp:${i.bookingId}`).catch(() => undefined); // never hold more than the checkout uses
      } else if (res) await this.corporate.release(i.bookingId, 'CURRENCY_MISMATCH').catch(() => undefined);
    }
    const payable = afterSponsored - corporateMinor;
    const releaseCorp = (reason: string) => corporateMinor > 0 && this.corporate ? this.corporate.release(i.bookingId, reason).catch(() => undefined) : undefined;
    if (!this.rewards) {
      try { const intent = await this.createDepositIntent({ ...i, amountMinor: payable, sponsoredMinor, corporateMinor }); await this.syncCorporateHold(intent, corporateMinor); return { intent, rewardMinor: 0, sponsoredMinor: intent.sponsoredMinor, corporateMinor: intent.corporateMinor, lines: this.depositLines(intent) }; }
      catch (e) { await releaseCorp('INTENT_NOT_CREATED'); throw e; }
    }
    let r: Awaited<ReturnType<RewardsPort['reserveForDeposit']>>;
    try { r = await this.rewards.reserveForDeposit({ sub: i.sub, bookingId: i.bookingId, amountMinor: payable, sponsoredMinor: sponsoredMinor + corporateMinor, currency: i.currency, serviceKind: i.serviceKind, specialty: i.specialty, dependantId: i.dependantId, couponCode: i.couponCode, lotId: i.lotId }); }
    catch (e) { await releaseCorp('INTENT_NOT_CREATED'); throw e; }
    try {
      const intent = await this.createDepositIntent({ ...i, amountMinor: payable - r.appliedMinor, rewardMinor: r.appliedMinor, sponsoredMinor, corporateMinor });
      await this.syncCorporateHold(intent, corporateMinor);
      const same = intent.rewardMinor === r.appliedMinor && intent.sponsoredMinor === sponsoredMinor && intent.corporateMinor === corporateMinor; // a concurrent checkout of the same booking may have won with other amounts: keep ITS intent
      return { intent, rewardMinor: intent.rewardMinor, sponsoredMinor: intent.sponsoredMinor, corporateMinor: intent.corporateMinor, lines: same ? this.depositLines(intent) : this.depositLines(intent), ...(r.couponProblem ? { couponProblem: r.couponProblem } : {}) };
    } catch (e) {
      await this.rewards.releaseForBooking(i.bookingId, 'INTENT_NOT_CREATED').catch(() => undefined);
      await releaseCorp('INTENT_NOT_CREATED');
      throw e;
    }
  }

  /** A concurrent checkout of the same booking may have created the intent with another corporate amount: the corporate hold follows the INTENT that exists (the surplus goes back). */
  private async syncCorporateHold(intent: PaymentIntent, reserved: number) {
    if (!this.corporate || reserved <= intent.corporateMinor) return;
    await this.corporate.release(intent.bookingId ?? '', 'INTENT_WON_BY_OTHER', reserved - intent.corporateMinor, `sync:${intent.id}`).catch(() => undefined);
  }

  /** The ordered checkout lines of a deposit intent (price, sponsored discount, corporate benefit, credit, card; every line shown, negative for reductions). Codes and label keys as the reward module's `composeCheckout` plus CORPORATE_BENEFIT. */
  private depositLines(p: { amountMinor: number; rewardMinor: number; sponsoredMinor: number; corporateMinor?: number }): Array<{ code: string; amountMinor: number; labelKey: string }> {
    return composeLines({ sponsoredMinor: p.sponsoredMinor, corporateMinor: p.corporateMinor ?? 0, creditMinor: p.rewardMinor, cardMinor: p.amountMinor });
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
    const settings = await this.settingsOf(psp);
    let ev: PspWebhookEvent | null;
    try { ev = pspAdapter(psp, settings).verifyWebhook(rawBody, headers, query); } catch { throw badRequest('INVALID_PSP_PAYLOAD', 'PSP payload could not be parsed'); }
    if (!ev) throw badRequest('INVALID_PSP_SIGNATURE', 'PSP signature rejected');
    if (!ev || typeof ev !== 'object' || typeof ev.eventId !== 'string' || !ev.eventId || !PSP_EVENT_TYPES.includes(ev.type) || !Number.isSafeInteger(ev.amountMinor) || ev.amountMinor < 0) throw badRequest('INVALID_PSP_PAYLOAD', 'PSP event is missing eventId, type or a whole-number amountMinor');
    const eventId = `psp:${ev.eventId}`;
    try {
      await this.prisma.webhookReceipt.create({ data: { eventId, source: `psp:${psp}`, type: ev.type, aggregateId: ev.paymentId ?? ev.pspRef, payload: JSON.parse(rawBody), status: 'PROCESSED', processedAt: new Date() } });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') return { status: 'DUPLICATE' };
      throw e;
    }
    try {
      return { status: await this.applyPspEvent(psp, ev, settings) };
    } catch (e) {
      await this.prisma.webhookReceipt.delete({ where: { eventId } }).catch(() => undefined); // keep the event retryable
      throw e;
    }
  }

  private async settingsOf(psp: string): Promise<PspSettings> {
    const name = (['paymob', 'fawry', 'instapay', 'card'].includes(psp) ? psp : 'paymob') as 'paymob';
    return this.pspConfig ? this.pspConfig.settingsFor(name) : (await import('./psp-config')).resolveSettings(name, '*');
  }

  /** One verified, de-duplicated PSP event (a webhook or a status poll) -> the state change it means. */
  private async applyPspEvent(psp: string, ev: PspWebhookEvent, settings: PspSettings): Promise<string> {
    switch (ev.type) {
      case 'payment.captured': return this.capturePayment(ev, settings);
      case 'payment.authorized': return this.markAuthorized(ev);
      case 'payment.voided': return this.markVoided(ev);
      case 'payment.failed': {
        const where = { OR: [{ id: ev.paymentId ?? '-' }, { pspRef: ev.pspRef }], status: 'CREATED' };
        const failed = await this.prisma.paymentIntent.findMany({ where, select: { bookingId: true, corporateMinor: true } });
        await this.prisma.paymentIntent.updateMany({ where, data: { status: 'FAILED' } });
        for (const f of failed) if (f.bookingId) { if (this.rewards) await this.rewards.releaseForBooking(f.bookingId, 'PAYMENT_FAILED'); if (f.corporateMinor > 0) await this.corporate?.release(f.bookingId, 'PAYMENT_FAILED').catch(() => undefined); } // GRW-P2-B2 / GRW-P4-C: the reserved credit and benefit are free again
        return 'FAILED_RECORDED';
      }
      case 'refund.settled': return this.settleRefundFromWebhook(ev);
      case 'refund.failed': return this.failRefundFromWebhook(ev);
      case 'dispute.opened': return this.recordDispute(psp, ev, 'OPEN');
      case 'dispute.won': return this.recordDispute(psp, ev, 'WON');
      case 'dispute.lost': return this.recordDispute(psp, ev, 'LOST');
      default: return 'IGNORED';
    }
  }

  private async findIntent(ev: PspWebhookEvent) {
    return this.prisma.paymentIntent.findFirst({ where: { OR: [{ id: ev.paymentId ?? '-' }, { pspRef: ev.pspRef }, ...(ev.orderRef ? [{ pspRef: ev.orderRef }] : [])] } });
  }

  private async markAuthorized(ev: PspWebhookEvent): Promise<string> {
    const p = await this.findIntent(ev);
    if (!p) throw notFound('PAYMENT_NOT_FOUND', 'Unknown payment');
    if (ev.amountMinor !== p.amountMinor) { await this.prisma.auditLog.create({ data: { actor: 'psp', action: 'pay.amount_mismatch', resource: 'PaymentIntent', resourceId: p.id, metadata: { expected: p.amountMinor, got: ev.amountMinor, event: 'authorized' } } }); throw conflict('AMOUNT_MISMATCH', 'Authorised amount does not match intent'); }
    const r = await this.prisma.paymentIntent.updateMany({ where: { id: p.id, status: 'CREATED' }, data: { status: 'AUTHORIZED', authorizedAt: new Date(ev.occurredAt), ...(ev.card ? { cardBrand: ev.card.brand, cardLast4: ev.card.last4, threeDsStatus: ev.card.threeDs } : {}) } });
    return r.count ? 'AUTHORIZED' : 'ALREADY_PROCESSED';
  }

  /** The PSP voided an authorised payment (or we asked it to): nothing was ever captured, so no ledger moves; credit and benefit held for the booking go back. */
  private async markVoided(ev: PspWebhookEvent): Promise<string> {
    const p = await this.findIntent(ev);
    if (!p) throw notFound('PAYMENT_NOT_FOUND', 'Unknown payment');
    const r = await this.prisma.paymentIntent.updateMany({ where: { id: p.id, status: { in: ['CREATED', 'AUTHORIZED'] } }, data: { status: 'VOIDED', voidedAt: new Date(ev.occurredAt) } });
    if (!r.count) return 'ALREADY_PROCESSED';
    if (p.bookingId) { await this.rewards?.releaseForBooking(p.bookingId, 'PAYMENT_VOIDED'); if (p.corporateMinor > 0) await this.corporate?.release(p.bookingId, 'PAYMENT_VOIDED').catch(() => undefined); }
    return 'VOIDED';
  }

  /** Money path: idempotency key (payment id) + ledger entry + outbox events in ONE transaction. */
  private async capturePayment(ev: PspWebhookEvent, settings: PspSettings): Promise<string> {
    const p = await this.findIntent(ev);
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
    const f = feeFor(settings, p.amountMinor, ev.feeMinor ?? (cfg().pspFeeBps > 0 && settings.fee.percentBps === null ? Math.round((p.amountMinor * cfg().pspFeeBps) / 10000) : undefined)); // NEEDS_HUMAN: per-PSP fee config (PSP_FEES), the PSP-reported fee wins
    const fee = f.feeMinor;
    const card = ev.card; const fpOk = !!card?.fingerprint && (card.fingerprintStrength === 'STRONG' || settings.acceptWeakFingerprint);
    const postToPay = (p.sponsoredMinor > 0 || p.corporateMinor > 0) && !!this.rewards && (await this.rewards.postToPayLedger().catch(() => false)); // read before the transaction opens (no second pooled connection while one is held)
    const postSponsored = p.sponsoredMinor > 0 && postToPay; const postCorporate = p.corporateMinor > 0 && postToPay;
    let claimedNow = false;
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.paymentIntent.updateMany({ where: { id: p.id, status: { in: ['CREATED', 'FAILED', 'AUTHORIZED'] } }, data: { status: 'CAPTURED', capturedAt: new Date(ev.occurredAt), feeMinor: fee, ...(card ? { cardBrand: card.brand ?? null, cardLast4: card.last4 ?? null, threeDsStatus: card.threeDs ?? null, ...(fpOk ? { cardFingerprint: card.fingerprint } : {}) } : {}) } });
      if (!claimed.count) return;
      claimedNow = true;
      if (p.payLinkToken) await tx.payLink.updateMany({ where: { token: p.payLinkToken }, data: { status: 'PAID' } }); // a real PSP capture (not only the sandbox page) closes the link
      await this.postLedger(tx, { key: `capture:${p.id}`, kind: 'CAPTURE', postings: capture(p.clinicId, p.amountMinor), bookingId: p.bookingId, paymentId: p.id, clinicId: p.clinicId });
      if (p.rewardMinor > 0 && p.bookingId && this.rewards) { // GRW-P2-B2: the reservation becomes a REDEEM in this transaction; the Pay ledger moves only for the patient's own refund credit (always) and for promotional credit when REWARD_RULES.postToPayLedger is true
        const red = await this.rewards.redeemOnCapture(tx, { bookingId: p.bookingId, paymentId: p.id });
        if (red.totalMinor !== p.rewardMinor) await tx.auditLog.create({ data: { actor: 'system', action: 'pay.reward_mismatch', resource: 'PaymentIntent', resourceId: p.id, metadata: { expected: p.rewardMinor, redeemed: red.totalMinor } } });
        const posted = red.postedMinor;
        if (posted > 0) await this.postLedger(tx, { key: `reward-tender:${p.id}`, kind: 'REWARD_TENDER', postings: rewardTender(p.clinicId, red.patientRefundMinor, posted - red.patientRefundMinor), bookingId: p.bookingId, paymentId: p.id, clinicId: p.clinicId });
        await tx.paymentIntent.update({ where: { id: p.id }, data: { rewardMinor: red.totalMinor, rewardPostedMinor: posted } });
      }
      if (postSponsored && p.bookingId) { // GRW-P2-S: the provider-funded part reaches HELD from SPONSOR_FUNDED:clinicCredit (settled by the Clinic's wallet DEBIT); REWARD_RULES.postToPayLedger, default false (finance H-25)
        await this.postLedger(tx, { key: `sponsor-tender:${p.id}`, kind: 'SPONSOR_FUNDED', postings: sponsorTender(p.clinicId, p.sponsoredMinor), bookingId: p.bookingId, paymentId: p.id, clinicId: p.clinicId });
        await tx.paymentIntent.update({ where: { id: p.id }, data: { sponsoredPostedMinor: p.sponsoredMinor } });
      }
      if (p.corporateMinor > 0 && p.bookingId) { // GRW-P4-C: the corporate benefit ledger redeems what it held (own ledger, no wallet); the Pay ledger takes the corporate part into HELD only when postToPayLedger (H-25), exactly like the sponsored part
        if (postCorporate) {
          await this.postLedger(tx, { key: `corporate-tender:${p.id}`, kind: 'CORPORATE_FUNDED', postings: corporateTender(p.clinicId, p.corporateMinor), bookingId: p.bookingId, paymentId: p.id, clinicId: p.clinicId });
          await tx.paymentIntent.update({ where: { id: p.id }, data: { corporatePostedMinor: p.corporateMinor } });
        }
        await this.outbox.enqueue(tx, { type: 'pay.corporate_move', aggregateType: 'PaymentIntent', aggregateId: p.id, payload: { op: 'redeem', bookingId: p.bookingId, key: `capture:${p.id}`, reason: 'DEPOSIT_CAPTURED' }, dedupeKey: `pay.corporate_move:redeem:${p.id}` });
      }
      if (card && settings.threeDsMode === 'REQUIRED' && card.brand && card.threeDs !== 'PASSED') await tx.auditLog.create({ data: { actor: 'psp', action: 'pay.three_ds_not_passed', resource: 'PaymentIntent', resourceId: p.id, metadata: { threeDs: card.threeDs ?? 'UNKNOWN', psp: p.psp } } }); // tripwire: the vendor integration enforces 3DS, this proves it
      if (fee > 0) await this.postLedger(tx, { key: `fee:${p.id}`, kind: 'PSP_FEE', postings: pspFee(fee), paymentId: p.id, clinicId: p.clinicId });
      if (f.needsHuman) await tx.auditLog.create({ data: { actor: 'system', action: 'pay.fee_not_configured', resource: 'PaymentIntent', resourceId: p.id, metadata: { psp: p.psp } } });
      if (p.purpose !== 'DEPOSIT') {
        // vertical orders (pharmacy/lab): the owning module reacts; Kiorly clinic deposit endpoints are never called
        await this.outbox.enqueue(tx, { type: 'pay.order_captured', aggregateType: 'PaymentIntent', aggregateId: p.id, payload: { paymentId: p.id, purpose: p.purpose, orderRef: p.orderRef, amountMinor: p.amountMinor }, dedupeKey: `pay.order_captured:${p.id}` });
        return;
      }
      await this.outbox.enqueue(tx, { type: 'kiorly.deposit_paid', target: 'KIORLY', aggregateType: 'PaymentIntent', aggregateId: p.id, payload: { paymentId: p.id }, dedupeKey: `kiorly.deposit_paid:${p.id}` });
      await this.outbox.enqueue(tx, { type: 'pay.deposit_captured', aggregateType: 'PaymentIntent', aggregateId: p.id, payload: { paymentId: p.id, bookingId: p.bookingId, amountMinor: p.amountMinor }, dedupeKey: `pay.deposit_captured:${p.id}` });
    });
    if (claimedNow && fpOk && p.sub && this.signals) await this.signals.recordCardFingerprint(p.sub, card!.fingerprint!).catch(() => undefined); // the fraud signals (RF_SELF, RF_FARM): hashed, never blocking the payment
    return 'CAPTURED';
  }

  private async notifyKiorlyDeposit(payload: { paymentId: string }) {
    const p = await this.getIntent(payload.paymentId);
    // GRW-P2-B2: the Clinic is told the GROSS deposit (card plus credit) and how it was funded (never a patient identity); without credit the call is byte-identical to before
    // GRW-P2-S: and how much of it the provider's sponsored discount covered (`tender.sponsoredDiscountMinor`, contracts 1.12.0); gross = card + patient credit + sponsored
    // PAY-READY: the corporate benefit is part of the GROSS deposit (provider income unchanged); `tender.corporateBenefitMinor` is additive and sent only when a benefit applied (contracts bump + Clinic acceptance are a go-live item, LG-INT-PAY)
    const body = { amount: toMajor(p.amountMinor + p.rewardMinor + p.sponsoredMinor + p.corporateMinor), currency: p.currency, paymentRef: p.id, paidAt: (p.capturedAt ?? new Date()).toISOString(), ...(p.rewardMinor > 0 || p.sponsoredMinor > 0 || p.corporateMinor > 0 ? { tender: { cardMinor: p.amountMinor, patientCreditMinor: p.rewardMinor, ...(p.sponsoredMinor > 0 ? { sponsoredDiscountMinor: p.sponsoredMinor } : {}), ...(p.corporateMinor > 0 ? { corporateBenefitMinor: p.corporateMinor } : {}) } } : {}) };
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
    const pre = await this.prisma.paymentIntent.findUnique({ where: { id: paymentId }, select: { psp: true } });
    const pspSettings = await this.settingsOf(pre?.psp ?? 'paymob'); // read before the transaction opens (no second pooled connection while one is held)
    return run(async (tx) => {
      const rows = await tx.$queryRaw<PaymentIntent[]>(Prisma.sql`SELECT * FROM "PaymentIntent" WHERE id = ${paymentId} FOR UPDATE`);
      const p = rows[0];
      if (!p) throw notFound('PAYMENT_NOT_FOUND', 'Payment not found');
      if (!['CAPTURED', 'PARTIALLY_REFUNDED'].includes(p.status)) throw conflict('NOT_REFUNDABLE', `Payment is ${p.status}`);
      // PAY-READY double-refund guard: a payment under dispute is never refunded as well (the PSP would pay the patient twice); a LOST dispute already returned the money
      if (p.disputeState === 'OPEN') throw conflict('DISPUTE_OPEN', 'The payment is under dispute at the PSP; it cannot be refunded until the dispute is resolved');
      // Released (completed visit / forfeited deposit / fulfilled order) money is owed to the partner, no longer HELD: refunding it here would drive the HELD account negative.
      if (p.releasedAt) throw conflict('ALREADY_RELEASED', 'Payment was already released to the provider; a refund needs a payout reversal, not a refund request');
      const remaining = p.amountMinor - p.refundedMinor;
      const amount = o.amountMinor ?? remaining;
      if (amount <= 0 || amount > remaining) throw badRequest('REFUND_EXCEEDS_CAPTURE', 'Refund exceeds remaining captured amount', { remaining });
      if (amount < remaining && !pspSettings.partialRefunds) throw badRequest('PARTIAL_REFUND_NOT_SUPPORTED', 'This payment provider does not accept partial refunds', { remaining });
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
      if (p.sponsoredMinor > 0) {
        // GRW-P2-S (KX-30 14.2): a refund voids its pro-rata share of the sponsored discount; the patient is refunded only what the patient paid (card, and credit restored): the sponsored share is never paid to the patient as cash or credit
        const voided = sponsoredVoidedByRefund({ sponsoredMinor: p.sponsoredMinor, cardMinor: p.amountMinor, cardRefundedAfterMinor: p.refundedMinor + amount, alreadyVoidedMinor: p.sponsoredVoidedMinor });
        const postedVoid = Math.min(voided, p.sponsoredPostedMinor);
        if (postedVoid > 0) await this.postLedger(tx, { key: `sponsor-void:${refund.id}`, kind: 'SPONSOR_VOID', postings: sponsorVoid(heldForReview ? A.reviewHold(p.clinicId) : A.held(p.clinicId), postedVoid), bookingId: p.bookingId, paymentId, clinicId: p.clinicId });
        if (voided > 0) await tx.paymentIntent.update({ where: { id: paymentId }, data: { sponsoredVoidedMinor: p.sponsoredVoidedMinor + voided, sponsoredPostedMinor: p.sponsoredPostedMinor - postedVoid } });
      }
      if (p.corporateMinor > 0 && p.bookingId) {
        // GRW-P4-C: a refund gives back its pro-rata share of the corporate benefit (cumulative on the card fraction: exactly all of it once the whole card amount is refunded); the patient is refunded only what the patient paid
        const reversed = corporateReversedByRefund({ corporateMinor: p.corporateMinor, cardMinor: p.amountMinor, cardRefundedAfterMinor: p.refundedMinor + amount, alreadyReversedMinor: p.corporateVoidedMinor });
        const postedVoid = Math.min(reversed, p.corporatePostedMinor);
        if (postedVoid > 0) await this.postLedger(tx, { key: `corporate-void:${refund.id}`, kind: 'CORPORATE_VOID', postings: corporateVoid(heldForReview ? A.reviewHold(p.clinicId) : A.held(p.clinicId), postedVoid), bookingId: p.bookingId, paymentId, clinicId: p.clinicId });
        if (reversed > 0) {
          await tx.paymentIntent.update({ where: { id: paymentId }, data: { corporateVoidedMinor: p.corporateVoidedMinor + reversed, corporatePostedMinor: p.corporatePostedMinor - postedVoid } });
          await this.outbox.enqueue(tx, { type: 'pay.corporate_move', aggregateType: 'PaymentIntent', aggregateId: paymentId, payload: { op: 'reverse', bookingId: p.bookingId, amountMinor: reversed, key: `refund:${refund.id}`, reason: 'DEPOSIT_REFUNDED' }, dedupeKey: `pay.corporate_move:reverse:${refund.id}` });
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
    const settings = await this.settingsOf(r.payment.psp);
    if (!withinRefundWindow(settings, r.payment.capturedAt)) { // the PSP will not refund after its window: ops pays the patient another way (NEEDS_HUMAN policy); the refund is parked, never silently dropped
      await this.prisma.refund.update({ where: { id: r.id }, data: { status: 'FAILED', failedAt: new Date(), failureCode: 'REFUND_WINDOW_PASSED' } });
      await this.prisma.auditLog.create({ data: { actor: 'system', action: 'pay.refund_window_passed', resource: 'Refund', resourceId: r.id, metadata: { psp: r.payment.psp, windowDays: settings.refundWindowDays } } });
      return;
    }
    const prior = (await this.prisma.refund.aggregate({ where: { paymentId: r.paymentId, status: 'SETTLED', id: { not: r.id } }, _sum: { amountMinor: true } }))._sum.amountMinor ?? 0;
    const out = await pspAdapter(r.payment.psp, settings).refund({ pspRef: r.payment.pspRef ?? '', refundId: r.id, amountMinor: r.amountMinor, priorRefundedMinor: prior });
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

  /** PSP `refund.settled` webhook: matches the refund by the PSP refund reference (or the payment's open refund) and settles it once. The amount the PSP reports must equal OUR refund (a tampered or replayed partial-refund event never settles a different refund). */
  private async settleRefundFromWebhook(ev: PspWebhookEvent): Promise<string> {
    const byOrder = ev.orderRef ? await this.prisma.paymentIntent.findFirst({ where: { pspRef: ev.orderRef }, select: { id: true } }) : null;
    const r = await this.prisma.refund.findFirst({
      where: { OR: [{ pspRefundRef: ev.pspRef }, ...(ev.refundRef ? [{ pspRefundRef: ev.refundRef }] : []), ...(ev.paymentId ? [{ paymentId: ev.paymentId, status: 'REQUESTED' }] : []), ...(byOrder ? [{ paymentId: byOrder.id, status: 'REQUESTED', amountMinor: ev.amountMinor }] : [])] },
      include: { payment: true }, orderBy: { createdAt: 'desc' },
    });
    if (!r) return 'REFUND_NOT_FOUND';
    if (r.status === 'SETTLED') return 'ALREADY_SETTLED';
    if (ev.amountMinor !== r.amountMinor) {
      await this.prisma.auditLog.create({ data: { actor: 'psp', action: 'pay.refund_amount_mismatch', resource: 'Refund', resourceId: r.id, metadata: { expected: r.amountMinor, got: ev.amountMinor } } });
      throw conflict('REFUND_AMOUNT_MISMATCH', 'Refund amount reported by the PSP does not match the refund');
    }
    await this.finalizeRefund(r, ev.refundRef || ev.pspRef || r.pspRefundRef || `webhook_${r.id}`);
    return 'REFUND_SETTLED';
  }

  /** PSP `refund.failed`: the refund stays owed to the patient (REFUND_PAYABLE), is marked FAILED with the PSP's code and appears in the reconciliation; ops retries or pays another way. */
  private async failRefundFromWebhook(ev: PspWebhookEvent): Promise<string> {
    const byOrder = ev.orderRef ? await this.prisma.paymentIntent.findFirst({ where: { pspRef: ev.orderRef }, select: { id: true } }) : null;
    const r = await this.prisma.refund.findFirst({ where: { OR: [{ pspRefundRef: ev.pspRef }, ...(ev.refundRef ? [{ pspRefundRef: ev.refundRef }] : []), ...(ev.paymentId ? [{ paymentId: ev.paymentId, status: 'REQUESTED' }] : []), ...(byOrder ? [{ paymentId: byOrder.id, status: 'REQUESTED', amountMinor: ev.amountMinor }] : [])] }, orderBy: { createdAt: 'desc' } });
    if (!r) return 'REFUND_NOT_FOUND';
    if (r.status !== 'REQUESTED') return 'ALREADY_PROCESSED';
    await this.prisma.refund.update({ where: { id: r.id }, data: { status: 'FAILED', failedAt: new Date(), failureCode: 'PSP_REFUND_FAILED' } });
    await this.prisma.auditLog.create({ data: { actor: 'psp', action: 'pay.refund_failed', resource: 'Refund', resourceId: r.id, metadata: { psp: ev.pspRef } } });
    return 'REFUND_FAILED';
  }

  /** Ops: put a FAILED refund back in the queue (after fixing the cause). The PSP call is idempotent on the refund id and checks what the PSP already refunded. */
  async retryRefund(refundId: string, actor: string) {
    const r = await this.prisma.refund.findUnique({ where: { id: refundId } });
    if (!r || r.status !== 'FAILED') throw conflict('NOT_RETRYABLE', 'Only a FAILED refund can be retried');
    await this.prisma.$transaction(async (tx) => {
      await tx.refund.update({ where: { id: refundId }, data: { status: 'REQUESTED', failedAt: null, failureCode: null } });
      await tx.auditLog.create({ data: { actor, action: 'pay.refund_retry', resource: 'Refund', resourceId: refundId } });
      await this.outbox.enqueue(tx, { type: 'pay.refund_requested', aggregateType: 'Refund', aggregateId: refundId, payload: { refundId }, dedupeKey: `pay.refund_requested:${refundId}:retry:${Date.now()}` });
    });
    return { refundId, status: 'REQUESTED' };
  }

  /** Booking cancelled/expired: refund a captured deposit; cancel an uncaptured intent. */
  async refundForBooking(bookingId: string, reason: string, opts: { destination?: 'ORIGINAL' | 'CREDIT'; source?: 'PATIENT_CANCEL' | 'PATIENT_REFUND_REQUEST' } = {}) {
    const p = await this.intentForBooking(bookingId);
    if (!p) return null;
    if (p.status === 'CREATED') { await this.prisma.paymentIntent.update({ where: { id: p.id }, data: { status: 'FAILED' } }); await this.rewards?.releaseForBooking(bookingId, 'BOOKING_ENDED'); if (p.corporateMinor > 0) await this.corporate?.release(bookingId, 'BOOKING_ENDED').catch(() => undefined); return null; }
    if (p.status === 'AUTHORIZED') { await this.voidAuthorized(p.id, 'system', `BOOKING_ENDED:${reason}`); return null; } // authorised only: cancel the hold on the card, nothing was captured
    if (p.disputeState === 'OPEN') return null; // PAY-READY: never refund a payment under dispute (the PSP would pay twice)
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
    const unwind = kind === 'FORFEITED' ? p.sponsoredPostedMinor : 0; // GRW-P2-S: a forfeited deposit earned no discount, so the sponsored part posted into HELD goes back to SPONSOR_FUNDED and is not paid to the clinic
    // GRW-P4-C: a no-show must not cost the employer: on a forfeit the corporate share goes back to the corporate benefit ledger (policy PAYMENT_CORPORATE_FORFEIT=reverse|keep, default reverse; NEEDS_HUMAN commercial term)
    const corpOpen = p.corporateMinor - p.corporateVoidedMinor;
    const corpBack = kind === 'FORFEITED' && corpOpen > 0 && (process.env.PAYMENT_CORPORATE_FORFEIT ?? 'reverse') !== 'keep' ? corpOpen : 0;
    const corpUnwind = Math.min(corpBack, p.corporatePostedMinor);
    const n = this.heldMinor(p) - unwind - corpUnwind;
    await this.prisma.$transaction(async (tx) => {
      const c = await tx.paymentIntent.updateMany({ where: { id: p.id, releasedAt: null }, data: { releasedAt: new Date(), releaseKind: kind } });
      if (!c.count) return;
      if (corpBack > 0 && bookingId) {
        if (corpUnwind > 0) await this.postLedger(tx, { key: `corporate-void-forfeit:${p.id}`, kind: 'CORPORATE_VOID', postings: corporateVoid(A.held(p.clinicId), corpUnwind), bookingId, paymentId: p.id, clinicId: p.clinicId });
        await tx.paymentIntent.update({ where: { id: p.id }, data: { corporateVoidedMinor: p.corporateVoidedMinor + corpBack, corporatePostedMinor: p.corporatePostedMinor - corpUnwind } });
        await this.outbox.enqueue(tx, { type: 'pay.corporate_move', aggregateType: 'PaymentIntent', aggregateId: p.id, payload: { op: 'reverse', bookingId, amountMinor: corpBack, key: `forfeit:${p.id}`, reason: 'DEPOSIT_FORFEITED' }, dedupeKey: `pay.corporate_move:forfeit:${p.id}` });
      }
      if (unwind > 0) {
        await this.postLedger(tx, { key: `sponsor-void-forfeit:${p.id}`, kind: 'SPONSOR_VOID', postings: sponsorVoid(A.held(p.clinicId), unwind), bookingId, paymentId: p.id, clinicId: p.clinicId });
        await tx.paymentIntent.update({ where: { id: p.id }, data: { sponsoredPostedMinor: 0, sponsoredVoidedMinor: p.sponsoredVoidedMinor + unwind } });
      }
      if (n > 0) await this.postLedger(tx, { key: `release:${p.id}`, kind: `RELEASE_${kind}`, postings: release(p.clinicId, n), bookingId, paymentId: p.id, clinicId: p.clinicId });
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
    if (p.status === 'CREATED') { await this.prisma.paymentIntent.update({ where: { id: p.id }, data: { status: 'FAILED' } }); await this.rewards?.releaseForBooking(bookingId, 'BOOKING_ENDED'); if (p.corporateMinor > 0) await this.corporate?.release(bookingId, 'BOOKING_ENDED').catch(() => undefined); return null; } // never paid: nothing to hold
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
    const released = await this.prisma.paymentIntent.findMany({ where: { purpose: 'DEPOSIT', status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED'] }, releasedAt: { not: null }, payoutId: null, OR: [{ disputeState: null }, { disputeState: 'WON' }] } }); // PAY-READY: a deposit under dispute (or lost) is never paid out // vertical partner payouts are NEEDS_HUMAN (merchant-of-record decision)
    // GRW-P2-S payout gate: a deposit whose sponsored part sits in the Pay ledger is paid out only after the Clinic has written the DEBIT (the sponsored amount is funded from the clinic's wallet). Until then the whole deposit waits for the next run.
    const due: PaymentIntent[] = []; const heldBack: { paymentId: string; holdMinor: number }[] = [];
    for (const p of released) {
      const hold = p.sponsoredPostedMinor > 0 ? (this.sponsored && p.bookingId ? await this.sponsored.payoutHoldMinor(p.bookingId, p.sponsoredPostedMinor) : p.sponsoredPostedMinor) : 0;
      if (hold > 0) heldBack.push({ paymentId: p.id, holdMinor: hold }); else due.push(p);
    }
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
    return { period, payouts: out, ...(heldBack.length ? { heldBack } : {}) };
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

  // ───────────── PAY-READY: authorise / capture / void, status polling, disputes ─────────────

  /** Manual capture mode: capture an AUTHORIZED payment at the PSP. The state change itself arrives like any capture (the PSP's callback, or the poll), through the same idempotent path. */
  async captureAuthorized(paymentId: string, actor: string) {
    const p = await this.getIntent(paymentId);
    if (p.status !== 'AUTHORIZED') throw conflict('NOT_AUTHORIZED', `Payment is ${p.status}`);
    const adapter = pspAdapter(p.psp, await this.settingsOf(p.psp));
    if (!adapter.capture) throw conflict('CAPTURE_NOT_SUPPORTED', 'This payment provider has no separate capture step');
    const out = await adapter.capture({ pspRef: p.pspRef ?? '', paymentId: p.id, amountMinor: p.amountMinor });
    await this.prisma.auditLog.create({ data: { actor, action: 'pay.capture_requested', resource: 'PaymentIntent', resourceId: p.id, metadata: { ref: out.pspCaptureRef } } });
    await this.pollOne(p.id).catch(() => undefined); // the callback usually follows; the poll closes the gap when it does not
    return { paymentId: p.id, requested: true };
  }

  /** Void an authorised (uncaptured) payment: the hold on the card is released. Idempotent. */
  async voidAuthorized(paymentId: string, actor: string, reason = 'VOID') {
    const p = await this.getIntent(paymentId);
    if (p.status === 'VOIDED') return { paymentId, status: 'VOIDED' };
    if (p.status !== 'AUTHORIZED') throw conflict('NOT_AUTHORIZED', `Payment is ${p.status}`);
    const adapter = pspAdapter(p.psp, await this.settingsOf(p.psp));
    if (!adapter.void) throw conflict('VOID_NOT_SUPPORTED', 'This payment provider cannot void an authorisation');
    await adapter.void({ pspRef: p.pspRef ?? '', paymentId: p.id });
    await this.markVoided({ eventId: `void:${p.id}`, type: 'payment.voided', pspRef: p.pspRef ?? '', paymentId: p.id, amountMinor: p.amountMinor, occurredAt: new Date().toISOString() });
    await this.prisma.auditLog.create({ data: { actor, action: 'pay.void', resource: 'PaymentIntent', resourceId: p.id, metadata: { reason } } });
    return { paymentId, status: 'VOIDED' };
  }

  /**
   * Status polling fallback for callbacks that never arrived (a PSP outage, a wrong webhook URL, a firewall): payments still CREATED / AUTHORIZED after `pollAfterMinutes` are asked about at the PSP
   * and the answer goes through the SAME idempotent path as a webhook (so a late webhook afterwards is a no-op). A payment unpaid after `pollGiveUpMinutes` is failed locally and its credit and
   * benefit hold released. Bounded per run; one failing PSP never stops the others (breaker-aware).
   */
  async pollPending(limit = 100): Promise<{ checked: number; changed: number; errors: number }> {
    const out = { checked: 0, changed: 0, errors: 0 };
    const rows = await this.prisma.paymentIntent.findMany({ where: { status: { in: ['CREATED', 'AUTHORIZED'] }, pspRef: { not: null }, createdAt: { lt: new Date(Date.now() - 60_000) } }, orderBy: { createdAt: 'asc' }, take: limit });
    for (const p of rows) {
      const s = await this.settingsOf(p.psp);
      if (Date.now() - p.createdAt.getTime() < s.pollAfterMinutes * 60_000) continue;
      if (p.lastPolledAt && Date.now() - p.lastPolledAt.getTime() < 2 * 60_000) continue;
      out.checked++;
      try { if (await this.pollOne(p.id)) out.changed++; } catch { out.errors++; }
    }
    return out;
  }

  /** Ask the PSP about one payment and apply its answer. Returns true when something changed. */
  async pollOne(paymentId: string): Promise<boolean> {
    const p = await this.getIntent(paymentId);
    const s = await this.settingsOf(p.psp);
    const adapter = pspAdapter(p.psp, s);
    await this.prisma.paymentIntent.update({ where: { id: p.id }, data: { lastPolledAt: new Date() } });
    if (!adapter.status) return false;
    const st = await adapter.status({ pspRef: p.pspRef ?? '', paymentId: p.id });
    const base = { pspRef: p.pspRef ?? '', paymentId: p.id, amountMinor: st.amountMinor ?? p.amountMinor, occurredAt: st.occurredAt ?? new Date().toISOString(), ...(st.currency ? { currency: st.currency } : {}), ...(st.card ? { card: st.card } : {}) };
    if (st.state === 'CAPTURED' && p.status !== 'CAPTURED') { await this.applyPollEvent(p.psp, { ...base, eventId: `poll:${p.id}:captured`, type: 'payment.captured', ...(st.feeMinor !== undefined ? { feeMinor: st.feeMinor } : {}) }, s); return true; }
    if (st.state === 'AUTHORIZED' && p.status === 'CREATED') { await this.applyPollEvent(p.psp, { ...base, eventId: `poll:${p.id}:authorized`, type: 'payment.authorized' }, s); return true; }
    if (st.state === 'VOIDED' && ['CREATED', 'AUTHORIZED'].includes(p.status)) { await this.applyPollEvent(p.psp, { ...base, eventId: `poll:${p.id}:voided`, type: 'payment.voided' }, s); return true; }
    if (st.state === 'FAILED' && p.status === 'CREATED') { await this.applyPollEvent(p.psp, { ...base, eventId: `poll:${p.id}:failed`, type: 'payment.failed' }, s); return true; }
    if (st.state === 'PENDING' && p.status === 'CREATED' && Date.now() - p.createdAt.getTime() > s.pollGiveUpMinutes * 60_000) { // never paid: free the credit and the benefit
      await this.applyPollEvent(p.psp, { ...base, eventId: `poll:${p.id}:expired`, type: 'payment.failed' }, s); return true;
    }
    return false;
  }

  private async applyPollEvent(psp: string, ev: PspWebhookEvent, settings: PspSettings) {
    const receipt = `psp:${ev.eventId}`;
    try { await this.prisma.webhookReceipt.create({ data: { eventId: receipt, source: `poll:${psp}`, type: ev.type, aggregateId: ev.paymentId ?? ev.pspRef, payload: { polled: true, type: ev.type } as never, status: 'PROCESSED', processedAt: new Date() } }); }
    catch (e) { if ((e as { code?: string }).code === 'P2002') return; throw e; }
    try { await this.applyPspEvent(psp, ev, settings); } catch (e) { await this.prisma.webhookReceipt.delete({ where: { eventId: receipt } }).catch(() => undefined); throw e; }
  }

  /**
   * A PSP dispute (chargeback): from a vendor webhook, a settlement file CHARGEBACK line, or an ops entry from the PSP dashboard. One PaymentDispute row per (psp, vendor dispute ref).
   *  OPEN : the deposit is frozen (no payout, no refund: the PSP would pay the patient twice), the reward credit tied to the booking and the referral decision are HELD through the growth port, the
   *         sponsored line is reported for ops; nothing is reversed or forgiven automatically.
   *  WON  : the freeze and the holds OPEN placed are released.
   *  LOST : the PSP took the money back: the ledger moves it out (from HELD if still held, from the provider's payable if released but not paid out, as CHARGEBACK_LOSS if already paid out);
   *         the sponsored and corporate shares go back; the reward holds stay for ops. NEEDS_HUMAN: who bears a lost chargeback.
   */
  async recordDispute(psp: string, ev: PspWebhookEvent, state: 'OPEN' | 'WON' | 'LOST'): Promise<string> {
    const p = await this.findIntent(ev);
    if (!p) throw notFound('PAYMENT_NOT_FOUND', 'Unknown payment');
    const ref = ev.dispute?.ref ?? ev.eventId;
    const amount = Math.min(ev.amountMinor || p.amountMinor, p.amountMinor);
    const existing = await this.prisma.paymentDispute.findUnique({ where: { psp_pspDisputeRef: { psp, pspDisputeRef: ref } } });
    if (existing && (existing.state === state || existing.state === 'LOST' || (existing.state === 'WON' && state === 'OPEN'))) return 'DUPLICATE_DISPUTE';
    const id = existing?.id ?? newId('dsp');
    const priorHolds = (existing?.holds ?? {}) as { referralHeld?: number };
    const signal = await this.signals?.onPaymentDispute({ paymentId: p.id, bookingId: p.bookingId, sub: p.sub, state, amountMinor: amount, currency: p.currency, psp, disputeRef: ref, priorHolds }).catch(() => null);
    await this.prisma.$transaction(async (tx) => {
      await tx.paymentDispute.upsert({ where: { psp_pspDisputeRef: { psp, pspDisputeRef: ref } }, create: { id, paymentId: p.id, psp, pspDisputeRef: ref, state, amountMinor: amount, currency: p.currency, reasonCode: ev.dispute?.reasonCode, evidenceDueAt: ev.dispute?.evidenceDueAt ? new Date(ev.dispute.evidenceDueAt) : undefined, holds: (signal ?? undefined) as never, ...(state !== 'OPEN' ? { resolvedAt: new Date() } : {}) }, update: { state, resolvedAt: state === 'OPEN' ? null : new Date(), ...(signal ? { holds: { ...priorHolds, ...(state === 'OPEN' ? signal : { releasedLots: signal.releasedLots, referralReleased: signal.referralReleased, heldLots: (priorHolds as any).heldLots ?? 0, referralHeld: (priorHolds as any).referralHeld ?? 0, sponsoredLine: signal.sponsoredLine }) } as never } : {}) } });
      if (state === 'OPEN') await tx.paymentIntent.update({ where: { id: p.id }, data: { disputeState: 'OPEN' } });
      else if (state === 'WON') await tx.paymentIntent.update({ where: { id: p.id }, data: { disputeState: 'WON' } });
      else await this.applyChargebackLoss(tx, p, amount, id);
      await tx.auditLog.create({ data: { actor: `psp:${psp}`, action: `pay.dispute_${state.toLowerCase()}`, resource: 'PaymentIntent', resourceId: p.id, metadata: { disputeRef: ref, amountMinor: amount, reasonCode: ev.dispute?.reasonCode ?? null } as never } });
    });
    return state === 'OPEN' ? 'DISPUTE_OPENED' : state === 'WON' ? 'DISPUTE_WON' : 'DISPUTE_LOST';
  }

  /** A lost chargeback: the money has left (the PSP debited Kiorex). Posted once per dispute (ledger key); the intent becomes REFUNDED for the lost amount. */
  private async applyChargebackLoss(tx: Tx, p: PaymentIntent, amount: number, disputeId: string) {
    const fresh = await tx.paymentIntent.findUniqueOrThrow({ where: { id: p.id } });
    const remaining = fresh.amountMinor - fresh.refundedMinor;
    const lost = Math.min(amount, remaining);
    if (lost <= 0) { await tx.paymentIntent.update({ where: { id: p.id }, data: { disputeState: 'LOST' } }); return; }
    const held = fresh.reviewState === 'HELD_FOR_REVIEW' ? A.reviewHold(fresh.clinicId) : A.held(fresh.clinicId);
    const posting = !fresh.releasedAt ? chargebackFromHeld(held, lost) : !fresh.payoutId ? chargebackFromPayable(fresh.clinicId, lost) : chargebackLoss(lost);
    const kind = !fresh.releasedAt ? 'CHARGEBACK_FROM_HELD' : !fresh.payoutId ? 'CHARGEBACK_FROM_PAYABLE' : 'CHARGEBACK_LOSS';
    await this.postLedger(tx, { key: `chargeback:${disputeId}`, kind, postings: posting, bookingId: fresh.bookingId, paymentId: fresh.id, clinicId: fresh.clinicId });
    const after = fresh.refundedMinor + lost;
    await tx.refund.create({ data: { id: newId('rf'), paymentId: fresh.id, amountMinor: lost, reason: `CHARGEBACK:${disputeId}`, idempotencyKey: `chargeback:${disputeId}`, status: 'SETTLED', settledAt: new Date(), pspRefundRef: `dispute:${disputeId}` } });
    await tx.paymentIntent.update({ where: { id: fresh.id }, data: { refundedMinor: after, status: after >= fresh.amountMinor ? 'REFUNDED' : 'PARTIALLY_REFUNDED', disputeState: 'LOST' } });
    // the sponsored and corporate shares are NOT the provider's or the patient's: they go back like on a refund (only the part still posted moves in the Pay ledger)
    if (fresh.sponsoredMinor > 0 && !fresh.releasedAt) {
      const voided = sponsoredVoidedByRefund({ sponsoredMinor: fresh.sponsoredMinor, cardMinor: fresh.amountMinor, cardRefundedAfterMinor: after, alreadyVoidedMinor: fresh.sponsoredVoidedMinor }); const postedVoid = Math.min(voided, fresh.sponsoredPostedMinor);
      if (postedVoid > 0) await this.postLedger(tx, { key: `sponsor-void-cb:${disputeId}`, kind: 'SPONSOR_VOID', postings: sponsorVoid(held, postedVoid), bookingId: fresh.bookingId, paymentId: fresh.id, clinicId: fresh.clinicId });
      if (voided > 0) await tx.paymentIntent.update({ where: { id: fresh.id }, data: { sponsoredVoidedMinor: fresh.sponsoredVoidedMinor + voided, sponsoredPostedMinor: fresh.sponsoredPostedMinor - postedVoid } });
    }
    if (fresh.corporateMinor > 0 && fresh.bookingId && !fresh.releasedAt) {
      const rev = corporateReversedByRefund({ corporateMinor: fresh.corporateMinor, cardMinor: fresh.amountMinor, cardRefundedAfterMinor: after, alreadyReversedMinor: fresh.corporateVoidedMinor }); const postedVoid = Math.min(rev, fresh.corporatePostedMinor);
      if (postedVoid > 0) await this.postLedger(tx, { key: `corporate-void-cb:${disputeId}`, kind: 'CORPORATE_VOID', postings: corporateVoid(held, postedVoid), bookingId: fresh.bookingId, paymentId: fresh.id, clinicId: fresh.clinicId });
      if (rev > 0) {
        await tx.paymentIntent.update({ where: { id: fresh.id }, data: { corporateVoidedMinor: fresh.corporateVoidedMinor + rev, corporatePostedMinor: fresh.corporatePostedMinor - postedVoid } });
        await this.outbox.enqueue(tx, { type: 'pay.corporate_move', aggregateType: 'PaymentIntent', aggregateId: fresh.id, payload: { op: 'reverse', bookingId: fresh.bookingId, amountMinor: rev, key: `chargeback:${disputeId}`, reason: 'DEPOSIT_CHARGEBACK' }, dedupeKey: `pay.corporate_move:cb:${disputeId}` });
      }
    }
    await this.outbox.enqueue(tx, { type: 'pay.refund_settled', aggregateType: 'PaymentIntent', aggregateId: fresh.id, payload: { paymentId: fresh.id, bookingId: fresh.bookingId, amountMinor: lost, destination: 'CHARGEBACK' }, dedupeKey: `pay.refund_settled:chargeback:${disputeId}` });
  }

  async auditOps(actor: string, action: string, resourceId: string, metadata: Record<string, unknown>) { await this.prisma.auditLog.create({ data: { actor, action, resource: 'PaymentIntent', resourceId, metadata: metadata as never } }); }

  /** Ops: the disputes list (newest first). */
  disputes(state?: string) { return this.prisma.paymentDispute.findMany({ where: state ? { state } : {}, orderBy: { openedAt: 'desc' }, take: 200 }); }

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

  /** Settlement lines and the daily reconciliation live in PayReconcileService (PAY-READY); these stay as the stable entry points (ops, the daily job, tests). */
  async importSettlementLines(lines: { psp: string; pspRef: string; kind: 'CAPTURE' | 'REFUND' | 'CHARGEBACK' | 'PAYOUT' | 'FEE_ADJUST'; amountMinor: number; feeMinor?: number; date: string }[]) { return this.recon!.importSettlementLines(lines); }
  async reconcileDaily(date = new Date()) { return this.recon!.reconcileDaily(date); }

  /** Import a vendor settlement / report file; chargebacks the file reports become disputes (the hold path below). */
  async importSettlementFile(i: { psp: string; filename: string; content: string; actor: string; format?: 'CSV' | 'JSON' }) {
    const r = await this.recon!.importFile(i);
    let disputes = 0;
    for (const c of r.chargebacks) {
      const pay = await this.prisma.paymentIntent.findFirst({ where: { psp: i.psp, pspRef: c.pspRef.replace(/#\d+$/, '') }, select: { id: true } });
      if (!pay) continue;
      const res = await this.recordDispute(i.psp, { eventId: `settlement:${r.fileId}:${c.pspRef}`, type: 'dispute.lost', pspRef: c.pspRef, paymentId: pay.id, amountMinor: c.amountMinor, occurredAt: new Date(`${c.date}T00:00:00Z`).toISOString(), dispute: { ref: `cb:${c.pspRef}` } }, 'LOST').catch(() => 'ERROR');
      if (res !== 'ERROR') disputes++;
    }
    return { ...r, disputesRecorded: disputes };
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
    const disputes = await this.prisma.paymentDispute.groupBy({ by: ['state'], _count: true, _sum: { amountMinor: true } });
    return { intents, refunds, payouts, reconciliationRuns: runs, balances, disputes: disputes.map((d) => ({ state: d.state, count: d._count, amountMinor: d._sum.amountMinor ?? 0 })), heldForReview: { count: held._count, amountMinor: (held._sum.amountMinor ?? 0) - (held._sum.refundedMinor ?? 0) } };
  }
}
