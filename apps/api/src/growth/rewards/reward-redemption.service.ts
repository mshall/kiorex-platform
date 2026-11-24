import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../prisma/generated/client';
import { ApiError } from '../../common/errors';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import type { RewardRedeemResult, RewardReserveInput, RewardReserveResult, RewardRestoreResult } from '../growth-ports-public';
import { composeCheckout } from './checkout-lines';
import { couponHash, normalizeCoupon } from './reward-coupon';
import { RewardEventsService } from './reward-events.service';
import { RewardIssuanceService, type Funding, issueKey } from './reward-issuance.service';
import { RewardLedgerService, type Db, type OpenLot } from './reward-ledger.service';
import { consumeFifo, entryKey, maxRedeemable } from './reward-math';
import { RewardPolicyService } from './reward-policy.service';
import type { RewardRules } from './reward-rules';

export interface RedemptionContext { sub: string; amountMinor: number; serviceKind: 'IN_CLINIC' | 'VIDEO' | 'HOME_VISIT'; specialty?: string | null; dependantId?: string | null; couponCode?: string | null; lotId?: string | null; now?: Date }
/** Policy answers read BEFORE a database transaction opens: a transaction must never wait for a second pooled connection (20 parallel checkouts would deadlock the pool). */
export interface PolicySnapshot { rewardsOn: boolean; creditOn: boolean; familyAvailable: boolean; rules: RewardRules; versionId: string }
export interface RedemptionPlan { applicableMinor: number; picks: Array<{ lotId: string; minor: number; kind: string; mode: string; funding: string }>; couponProblem?: 'COUPON_INVALID' | 'NOT_APPLICABLE'; notApplicable?: string[]; availableMinor: number; abuseCode?: string }

/**
 * Redemption of reward value against a Kiorex deposit (GRW-P2-B2). Order of use: scoped lots first, then first-expiring-first, then lot id (shared vectors). The amount a booking can use is
 * min(available, redemptionMaxBp of the deposit, deposit minus the card minimum), the card always keeps at least one minor unit. COUPON lots are used only on request (a code or a tap on the
 * voucher) and are single use (the unspent rest of the coupon expires with it); CREDIT lots apply automatically while growth.patient_credit is effective. A coupon belongs to ONE patient:
 * another account entering the code gets the same answer as a wrong code, and the attempt is recorded as an RF_REDEEM_ABUSE signal.
 * Reserve, redeem and release are keyed per booking and per payment, so a retried webhook or a double click never moves value twice.
 */
@Injectable()
export class RewardRedemptionService {
  private readonly log = new Logger('reward-redemption');
  constructor(private readonly prisma: PrismaService, private readonly ledger: RewardLedgerService, private readonly policy: RewardPolicyService, private readonly issuance: RewardIssuanceService, private readonly events: RewardEventsService) {}

  // ───────────── plan (read only) ─────────────

  async snapshot(): Promise<PolicySnapshot> {
    const { rules, versionId } = await this.policy.rewardRules();
    const [rewardsOn, creditOn, familyAvailable] = await Promise.all([this.policy.rewardsOn(), this.policy.creditOn(), this.policy.familyAvailable(rules)]);
    return { rewardsOn, creditOn, familyAvailable, rules, versionId };
  }

  async plan(c: RedemptionContext, db: Db = this.prisma, pre?: PolicySnapshot): Promise<RedemptionPlan> {
    const now = c.now ?? new Date();
    const none = (extra: Partial<RedemptionPlan> = {}): RedemptionPlan => ({ applicableMinor: 0, picks: [], availableMinor: 0, ...extra });
    const { rewardsOn, creditOn, familyAvailable, rules } = pre ?? (await this.snapshot());
    if (!rewardsOn) return none();
    // family sharing: a booking made FOR a dependant draws from the owner's credit only when household sharing is on, the owner enabled that dependant and the dependant is still under the guardian link
    if (c.dependantId) {
      const member = familyAvailable ? await db.rewardHouseholdMember.findFirst({ where: { memberSub: `dep:${c.dependantId}`, endedAt: null, household: { ownerSub: c.sub } } }) : null;
      const dep = member ? await db.dependant.findFirst({ where: { id: c.dependantId, guardianSub: c.sub, deletedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, select: { id: true } }) : null;
      if (!member || !dep) return none({ couponProblem: c.couponCode || c.lotId ? 'NOT_APPLICABLE' : undefined, notApplicable: ['DEPENDANT_NOT_ENABLED'] });
    }
    let open = await this.ledger.openLots(db, { owners: [c.sub], now });
    const code = c.couponCode ? normalizeCoupon(c.couponCode) : null;
    let couponProblem: RedemptionPlan['couponProblem']; let abuseCode: string | undefined;
    const explicit = new Set<string>();
    if (c.couponCode) {
      if (!code) couponProblem = 'COUPON_INVALID';
      else {
        const lot = open.find((l) => l.couponCodeHash === couponHash(code));
        if (lot) explicit.add(lot.id);
        else {
          couponProblem = 'COUPON_INVALID';
          const other = await db.rewardLot.findFirst({ where: { couponCodeHash: couponHash(code) }, select: { id: true, sub: true } });
          if (other && other.sub !== c.sub) abuseCode = code;
        }
      }
    }
    if (c.lotId) { if (open.some((l) => l.id === c.lotId && l.mode === 'COUPON')) explicit.add(c.lotId); else couponProblem = couponProblem ?? 'COUPON_INVALID'; }
    open = open.filter((l) => (l.mode === 'CREDIT' ? creditOn : explicit.has(l.id)));
    const inScope = open.filter((l) => this.scopeOk(l, c));
    const notApplicable = open.filter((l) => !this.scopeOk(l, c)).map((l) => l.id);
    const available = inScope.reduce((s, l) => s + l.availableMinor, 0);
    const room = maxRedeemable({ availableMinor: available, amountMinor: c.amountMinor, redemptionMaxBp: rules.redemptionMaxBp, minPayableMinor: rules.minPayableMinor });
    const picks = room > 0 ? consumeFifo(inScope.map((l) => ({ id: l.id, remainingMinor: l.availableMinor, expiresAt: l.expiresAt, scoped: this.isScoped(l) })), room, now) : [];
    const by = new Map(inScope.map((l) => [l.id, l]));
    return {
      applicableMinor: (picks ?? []).reduce((s, p) => s + p.minor, 0), availableMinor: available, couponProblem, ...(abuseCode ? { abuseCode } : {}),
      picks: (picks ?? []).map((p) => ({ lotId: p.lotId, minor: p.minor, kind: by.get(p.lotId)!.kind, mode: by.get(p.lotId)!.mode, funding: by.get(p.lotId)!.funding })),
      ...(notApplicable.length ? { notApplicable } : {}),
    };
  }
  private isScoped(l: OpenLot) { const s = l.scope as { serviceKinds?: unknown[]; specialtyAllowlist?: unknown[] }; return (s.serviceKinds?.length ?? 0) > 0 || (s.specialtyAllowlist?.length ?? 0) > 0; }
  /** A scope restricts WHERE credit can be spent (service kind, counsel-approved specialty list). It is never a targeting attribute and the lot never stores why the patient got it. */
  private scopeOk(l: OpenLot, c: RedemptionContext): boolean {
    const s = l.scope as { serviceKinds?: string[]; specialtyAllowlist?: string[] };
    if (s.serviceKinds?.length && !s.serviceKinds.includes(c.serviceKind)) return false;
    if (s.specialtyAllowlist?.length && !(c.specialty && s.specialtyAllowlist.map((x) => x.toLowerCase()).includes(c.specialty.toLowerCase()))) return false;
    return true;
  }
  private async recordRedeemAbuse(code: string) {
    // a keyed hash only: the signal never carries the code, the account or the other patient (RF_REDEEM_ABUSE)
    await this.prisma.growthFraudSignal.create({ data: { ruleId: 'RF_REDEEM_ABUSE', subjectHash: couponHash(code).slice(0, 32), score: 90, evidenceRef: 'coupon-other-account' } }).catch(() => undefined);
  }

  /** The ordered checkout lines for a quote (no write). */
  async quoteLines(c: RedemptionContext) {
    const plan = await this.plan(c);
    if (plan.abuseCode) await this.recordRedeemAbuse(plan.abuseCode);
    const lines = composeCheckout({ priceMinor: c.amountMinor, creditMinor: plan.applicableMinor });
    return { lines: lines.lines, payableMinor: lines.cardMinor, applicableMinor: lines.creditMinor, couponProblem: plan.couponProblem, notApplicable: plan.notApplicable ?? [] };
  }

  // ───────────── reserve / release (booking deposit checkout) ─────────────

  async reserveForDeposit(i: RewardReserveInput): Promise<RewardReserveResult> {
    const empty: RewardReserveResult = { appliedMinor: 0, lines: composeCheckout({ priceMinor: Math.max(i.amountMinor, 1) }).lines, lots: [] };
    if (i.amountMinor < 1 || !(await this.policy.rewardsOn())) return empty; // switched off: nothing is read, written or materialised
    const pre = await this.snapshot(); // before the transaction: it must not need a second pooled connection while it holds one
    if (!pre.rewardsOn) return empty;
    let abuse: string | undefined;
    const out = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`reward-reserve:${i.bookingId}`}))`;
      const open = await this.ledger.openReservations(tx, i.bookingId);
      if (open.length) { // idempotent per booking: a second checkout of the same booking reuses its reservation
        const total = open.reduce((s, r) => s + r.minor, 0);
        return { appliedMinor: total, lines: composeCheckout({ priceMinor: i.amountMinor, creditMinor: total }).lines, lots: open.map((r) => ({ lotId: r.lotId, minor: r.minor })) };
      }
      const plan0 = await this.plan({ ...i, now: new Date() }, tx, pre);
      abuse = plan0.abuseCode;
      if (!plan0.picks.length) return { ...empty, lines: composeCheckout({ priceMinor: i.amountMinor }).lines, ...(plan0.couponProblem ? { couponProblem: plan0.couponProblem } : {}) };
      await this.ledger.lock(tx, plan0.picks.map((p) => p.lotId)); // serialise concurrent checkouts on the lots, then plan again on the committed state
      const plan = await this.plan({ ...i, now: new Date() }, tx, pre);
      const versionId = pre.versionId;
      let total = 0; const lots: Array<{ lotId: string; minor: number }> = [];
      for (const p of plan.picks) {
        const cycle = await tx.rewardLedgerEntry.count({ where: { lotId: p.lotId, bookingId: i.bookingId, type: 'UNRESERVE' } });
        await this.ledger.append(tx, { lotId: p.lotId, type: 'RESERVE', amountMinor: p.minor, idempotencyKey: entryKey('reserve', i.bookingId, p.lotId, cycle), ruleVersionId: versionId, reasonCode: 'CHECKOUT', actor: `patient:${i.sub.slice(0, 8)}`, bookingId: i.bookingId, currency: i.currency });
        await this.ledger.refreshStatus(tx, p.lotId);
        total += p.minor; lots.push({ lotId: p.lotId, minor: p.minor });
      }
      const composed = composeCheckout({ priceMinor: i.amountMinor, creditMinor: total });
      await tx.rewardCheckoutLine.create({ data: { sub: i.sub, bookingId: i.bookingId, priceMinor: i.amountMinor, lines: composed.lines as unknown as Prisma.InputJsonValue } });
      return { appliedMinor: total, lines: composed.lines, lots };
    }, { timeout: 30_000, maxWait: 30_000 }); // concurrent checkouts of one patient queue on the lot rows: they wait for the connection, they do not fail
    if (abuse) await this.recordRedeemAbuse(abuse);
    return out;
  }

  /** Release the open reservation of a booking: payment failed, the booking died, or the checkout was abandoned. Idempotent. Returns the amount released. */
  async releaseForBooking(bookingId: string, reason: string, outer?: Tx): Promise<number> {
    if (!outer && !(await this.ledger.openReservations(this.prisma, bookingId)).length) return 0; // the usual case (no credit used): no transaction, no configuration read
    const { versionId } = await this.policy.rewardRules(); // read before the transaction opens (see PolicySnapshot)
    const run = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => (outer ? fn(outer) : this.prisma.$transaction(fn, { timeout: 30_000, maxWait: 30_000 }));
    return run(async (tx) => {
      const open = await this.ledger.openReservations(tx, bookingId);
      if (!open.length) return 0;
      await this.ledger.lock(tx, open.map((o) => o.lotId));
      let n = 0;
      for (const r of open) {
        const cycle = await tx.rewardLedgerEntry.count({ where: { lotId: r.lotId, bookingId, type: 'UNRESERVE' } });
        await this.ledger.append(tx, { lotId: r.lotId, type: 'UNRESERVE', amountMinor: r.minor, idempotencyKey: entryKey('unreserve', bookingId, r.lotId, cycle), ruleVersionId: versionId, reasonCode: reason.slice(0, 60).replace(/[^A-Z0-9_]/gi, '_').toUpperCase() || 'RELEASED', actor: 'system:pay', bookingId });
        await this.ledger.refreshStatus(tx, r.lotId);
        n += r.minor;
      }
      return n;
    });
  }

  // ───────────── redeem (payment captured, same transaction as the capture) ─────────────

  async redeemOnCapture(tx: Tx, i: { bookingId: string; paymentId: string }): Promise<RewardRedeemResult> {
    const open = await this.ledger.openReservations(tx, i.bookingId);
    const out: RewardRedeemResult = { totalMinor: 0, patientRefundMinor: 0, promoMinor: 0, postedMinor: 0 };
    if (!open.length) return out;
    await this.ledger.lock(tx, open.map((o) => o.lotId));
    const { rules, versionId } = await this.policy.rewardRules();
    const post = rules.postToPayLedger;
    for (const r of open) {
      const lot = await tx.rewardLot.findUniqueOrThrow({ where: { id: r.lotId } });
      await this.ledger.append(tx, { lotId: r.lotId, type: 'REDEEM', amountMinor: r.minor, idempotencyKey: entryKey('redeem', i.paymentId, r.lotId), ruleVersionId: versionId, reasonCode: 'DEPOSIT_PAID', actor: 'system:pay', bookingId: i.bookingId });
      if (lot.mode === 'COUPON' && lot.kind !== 'RESTORED') { // a coupon is single use: the unspent rest expires with the redemption
        const bal = await this.ledger.balance(tx, r.lotId);
        if (bal.available > 0) await this.ledger.append(tx, { lotId: r.lotId, type: 'EXPIRE', amountMinor: bal.available, idempotencyKey: entryKey('expire', 'single-use', r.lotId), ruleVersionId: versionId, reasonCode: 'COUPON_SINGLE_USE', actor: 'system:pay', bookingId: i.bookingId });
      }
      await this.ledger.refreshStatus(tx, r.lotId);
      out.totalMinor += r.minor;
      if ((lot.funding as Funding) === 'PATIENT_REFUND') out.patientRefundMinor += r.minor; else out.promoMinor += r.minor;
      await this.events.emit(tx, 'RewardRedeemed', 'RewardLot', r.lotId, { lotRef: r.lotId, market: lot.market, mode: lot.mode, amountMinor: r.minor, currency: lot.currency, reasonCode: 'DEPOSIT_PAID', idempotencyKey: entryKey('redeem', i.paymentId, r.lotId), at: new Date().toISOString() }, `${i.paymentId}:${r.lotId}`);
    }
    out.postedMinor = out.patientRefundMinor + (post ? out.promoMinor : 0);
    return out;
  }

  // ───────────── restore on refund ─────────────

  /**
   * A refund of a deposit that was paid partly with credit gives the credit share back. The ledger has no un-redeem entry, so the value returns as NEW `RESTORED` lots (one per redeemed lot,
   * the same scope and funding label, expiry = the later of the original expiry and now + restoredLotMinDays, never counted against caps). Cumulative: the target is
   * round(cardRefundedAfter / card x credit), so a sequence of partial refunds never drifts and a full refund restores exactly the credit paid.
   */
  async restoreForRefund(tx: Tx, i: Parameters<import('../growth-ports-public').RewardsPort['onRefundCreated']>[1]): Promise<RewardRestoreResult> {
    const none: RewardRestoreResult = { restoredMinor: 0, patientRefundRestoredMinor: 0, promoRestoredMinor: 0, postedRestoredMinor: 0, lotIds: [] };
    if (i.paymentRewardMinor <= 0 || i.paymentCardMinor <= 0) return none;
    const redeemed = await this.ledger.redeemedFor(tx, i.bookingId);
    if (!redeemed.length) return none;
    const priorRestored = await tx.rewardLot.findMany({ where: { kind: 'RESTORED', reasonCode: { startsWith: `RESTORED:${i.paymentId}` } }, select: { id: true, amountMinor: true, funding: true } });
    const done = priorRestored.reduce((s, l) => s + l.amountMinor, 0);
    const cumulativeRefund = i.alreadyRefundedMinor + i.cardRefundMinor;
    const target = cumulativeRefund >= i.paymentCardMinor ? i.paymentRewardMinor : Math.round((cumulativeRefund / i.paymentCardMinor) * i.paymentRewardMinor);
    const now = Math.min(Math.max(0, target - done), i.paymentRewardMinor - done);
    if (now <= 0) return none;
    const { rules, versionId } = await this.policy.rewardRules();
    const pre = { rules, versionId, rewardsOn: true, mode: 'CREDIT' as const }; // RESTORED lots skip the switches and caps; the policy is passed so the issue does not read it again inside the refund transaction
    // largest-remainder split of `now` over the redeemed lots (proportional to what each one paid)
    const totalPaid = redeemed.reduce((s, r) => s + r.minor, 0);
    const shares = redeemed.map((r) => ({ r, exact: (now * r.minor) / totalPaid })).map((x) => ({ ...x, floor: Math.floor(x.exact) }));
    let left = now - shares.reduce((s, x) => s + x.floor, 0);
    shares.sort((a, b) => (b.exact - b.floor) - (a.exact - a.floor) || (a.r.lotId < b.r.lotId ? -1 : 1));
    for (const x of shares) if (left > 0) { x.floor += 1; left -= 1; }
    const out: RewardRestoreResult = { ...none, lotIds: [] };
    for (const x of shares.sort((a, b) => (a.r.lotId < b.r.lotId ? -1 : 1))) {
      if (x.floor <= 0) continue;
      const orig = await tx.rewardLot.findUniqueOrThrow({ where: { id: x.r.lotId } });
      const minExpiry = new Date(Date.now() + rules.credit.refundAsCredit.restoredLotMinDays * 86_400_000);
      const issued = await this.issuance.issue({
        kind: 'RESTORED', sub: orig.sub, amountMinor: x.floor, funding: orig.funding as Funding, mode: orig.mode as 'COUPON' | 'CREDIT', idempotencyKey: issueKey('restored', i.refundId, x.r.lotId), reasonCode: `RESTORED:${i.paymentId}`, actor: 'system:pay',
        scope: (orig.scope ?? {}) as Record<string, unknown>, campaignId: orig.campaignId, refundId: i.refundId, bookingId: i.bookingId, expiresAt: orig.expiresAt > minExpiry ? orig.expiresAt : minExpiry, pre,
      }, tx);
      if (issued.status === 'SKIPPED') { this.log.error(`restore of ${x.floor} for refund ${i.refundId} skipped: ${issued.reason}`); continue; }
      out.restoredMinor += x.floor; out.lotIds.push(issued.lotId);
      if (orig.funding === 'PATIENT_REFUND') out.patientRefundRestoredMinor += x.floor; else out.promoRestoredMinor += x.floor;
      await this.events.emit(tx, 'RewardRestored', 'RewardLot', issued.lotId, { lotRef: x.r.lotId, restoredLotRef: issued.lotId, market: orig.market, amountMinor: x.floor, currency: orig.currency, reasonCode: 'BOOKING_CANCELLED', at: new Date().toISOString() }, `${i.refundId}:${x.r.lotId}`);
    }
    // the part of the restored credit that sits in the Pay ledger HELD account goes back out of it: the patient's own refunded money is always posted, promotional credit only when it had been
    const patientTotal = redeemed.filter((r) => r.funding === 'PATIENT_REFUND').reduce((s, r) => s + r.minor, 0);
    const promoTotal = totalPaid - patientTotal;
    const promoPostedTotal = Math.max(0, i.paymentRewardPostedMinor - patientTotal);
    out.postedRestoredMinor = cumulativeRefund >= i.paymentCardMinor ? i.paymentRewardPostedMinor
      : Math.min(i.paymentRewardPostedMinor, out.patientRefundRestoredMinor + (promoTotal > 0 && promoPostedTotal > 0 ? Math.round((out.promoRestoredMinor / promoTotal) * promoPostedTotal) : 0));
    return out;
  }
}
