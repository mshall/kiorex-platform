import { DEFAULT_MARKET } from '../../market/market-core-public';
import { Injectable, Logger } from '@nestjs/common';
import { ApiError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import type { ReferralPort } from '../growth-ports-public';
import { RewardEventsService } from '../rewards/reward-events.service';
import { RewardIssuanceService, issueKey } from '../rewards/reward-issuance.service';
import { RewardPolicyService } from '../rewards/reward-policy.service';
import { RewardReversalService } from '../rewards/reward-reversal.service';
import { ReferralFraudService } from './referral-fraud.service';
import { ReferralIdentityService } from './referral-identity.service';
import { qualify, repeatEligible, type QualFacts, type QualResult } from './referral-qualification';

const DAY = 86_400_000;
export interface EvaluateOptions { now?: Date; override?: boolean; reviewedAllow?: boolean }
export interface EvaluateOutcome { relationshipId: string; result: 'QUALIFIED' | 'PENDING' | 'REJECTED' | 'UNCHANGED'; reason?: string; issued: { referrer?: string; referee?: string } }

/**
 * Referral qualification (GRW-P2-B1). `evaluate` is the single place a relationship becomes QUALIFIED or REJECTED: it gathers the facts, runs the pure `qualify`, appends one
 * ReferralQualificationCheck row per check, and on QUALIFIED issues the two reward lots through the ledger with idempotency keys `ref:<relationship>:<role>:<rule version>` in the same transaction as
 * the status change, so a concurrent or repeated evaluation emits exactly one ReferralQualified and issues exactly one pair of lots. The relationship row is locked for the transaction.
 * A referral never touches attribution or commission, and nothing here reads the Clinic. The referrer is never told who qualified (counts only).
 */
@Injectable()
export class ReferralQualificationService implements ReferralPort {
  private readonly log = new Logger('referral-qualification');
  constructor(
    private readonly prisma: PrismaService, private readonly policy: RewardPolicyService, private readonly fraud: ReferralFraudService, private readonly identity: ReferralIdentityService,
    private readonly issuance: RewardIssuanceService, private readonly reversal: RewardReversalService, private readonly events: RewardEventsService,
  ) {}

  // ───────────── booking facts (ReferralPort) ─────────────

  async onBookingCompleted(bookingId: string): Promise<void> {
    try {
      const b = await this.prisma.bookingIntent.findUnique({ where: { id: bookingId } });
      if (!b || b.dependantId) return; // dependants never qualify a referral
      const rel = await this.prisma.referralRelationship.findUnique({ where: { market_refereeSub: { market: DEFAULT_MARKET, refereeSub: b.sub } } });
      if (!rel || !['SIGNED_UP', 'BOOKED'].includes(rel.status)) { await this.afterRepeat(b.id, b.sub); return; }
      const { rules } = await this.policy.referralRules();
      const holdUntil = new Date((b.terminalAt ?? new Date()).getTime() + rules.qualification.holdDays * DAY);
      await this.prisma.referralRelationship.updateMany({ where: { id: rel.id, status: { in: ['SIGNED_UP', 'BOOKED'] } }, data: { status: 'BOOKED', firstBookingId: rel.firstBookingId ?? b.id, completedAt: rel.completedAt ?? b.terminalAt ?? new Date(), holdUntil: rel.holdUntil ?? holdUntil } });
      if (!(await this.policy.referralOn())) return; // the relationship keeps its facts; nothing is qualified while the launch-locked flag is not effective
      await this.evaluate(rel.id);
    } catch (e) { this.log.warn(`referral hook for completed booking ${bookingId} failed: ${(e as Error).message}`); }
  }

  /** A cancellation or refund after the visit: reverse the reward inside the window, or let the relationship fail its refund check. */
  async onBookingCancelled(bookingId: string): Promise<void> {
    try {
      const rels = await this.prisma.referralRelationship.findMany({ where: { OR: [{ firstBookingId: bookingId }, { qualifiedBookingId: bookingId }] } });
      for (const rel of rels) {
        if (rel.status === 'QUALIFIED') {
          const out = await this.reversal.reverseForBooking(bookingId, 'BOOKING_CANCELLED');
          if (out.length) await this.fraud.record([{ ruleId: 'RF_CANCEL_ABUSE', score: 80, action: 'REVERSE', reason: 'cancelled after the reward' }], { subject: rel.referrerSub, evidenceRef: `cancel:${rel.id}`, score: 80 });
        } else if (['SIGNED_UP', 'BOOKED'].includes(rel.status) && (await this.policy.referralOn())) await this.evaluate(rel.id);
      }
    } catch (e) { this.log.warn(`referral hook for cancelled booking ${bookingId} failed: ${(e as Error).message}`); }
  }

  /** Repeat bookings (off by default): an eligible further completed booking of a qualified referee earns one smaller referrer lot. */
  private async afterRepeat(bookingId: string, refereeSub: string) {
    const { rules } = await this.policy.referralRules();
    if (rules.repeatBonus.count <= 0 || !(await this.policy.referralOn())) return;
    const rel = await this.prisma.referralRelationship.findUnique({ where: { market_refereeSub: { market: DEFAULT_MARKET, refereeSub } } });
    if (!rel || rel.status !== 'QUALIFIED' || !rel.qualifiedBookingId || rel.qualifiedBookingId === bookingId) return;
    const b = await this.prisma.bookingIntent.findUnique({ where: { id: bookingId } });
    const first = await this.prisma.bookingIntent.findUnique({ where: { id: rel.qualifiedBookingId } });
    const after = await this.prisma.rewardLot.count({ where: { relationshipId: rel.id, kind: 'REPEAT' } });
    if (!b || b.status !== 'COMPLETED' || !repeatEligible(rules, { completedAfterFirst: after, firstCompletedAt: first?.terminalAt ?? null, bookingCompletedAt: b.terminalAt })) return;
    const { rules: rr, versionId } = await this.policy.rewardRules();
    await this.issuance.issue({ kind: 'REPEAT', sub: rel.referrerSub, amountMinor: rr.amounts.repeatMinor, funding: 'PLATFORM_MARKETING', idempotencyKey: issueKey('ref', rel.id, 'repeat', bookingId, versionId), reasonCode: 'REPEAT_BOOKING', actor: 'system:referral', qualifyingBookingId: bookingId, relationshipId: rel.id });
  }

  // ───────────── evaluation ─────────────

  async evaluate(relationshipId: string, o: EvaluateOptions = {}): Promise<EvaluateOutcome> {
    const now = o.now ?? new Date();
    const out: EvaluateOutcome = { relationshipId, result: 'UNCHANGED', issued: {} };
    const rel = await this.prisma.referralRelationship.findUnique({ where: { id: relationshipId }, include: { code: true } });
    if (!rel || ['QUALIFIED', 'REJECTED', 'EXPIRED'].includes(rel.status)) return out;
    const [{ rules }, { rules: rw, versionId: rewardVersion }] = await Promise.all([this.policy.referralRules(), this.policy.rewardRules()]);

    const booking = rel.firstBookingId ? await this.prisma.bookingIntent.findUnique({ where: { id: rel.firstBookingId } }) : null;
    const referrerProfile = await this.prisma.patientProfile.findUnique({ where: { sub: rel.referrerSub }, select: { createdAt: true } });
    const refereeProfile = await this.prisma.patientProfile.findUnique({ where: { sub: rel.refereeSub }, select: { phone: true } });
    const refereePhoneHashes = await this.identity.hashesOf(rel.refereeSub, 'PHONE');
    const [q30, qYear, referrerDone, existing] = await Promise.all([
      this.prisma.referralRelationship.count({ where: { referrerSub: rel.referrerSub, status: 'QUALIFIED', qualifiedAt: { gte: new Date(now.getTime() - 30 * DAY) } } }),
      this.prisma.referralRelationship.count({ where: { referrerSub: rel.referrerSub, status: 'QUALIFIED', qualifiedAt: { gte: new Date(now.getTime() - 365 * DAY) } } }),
      this.prisma.bookingIntent.count({ where: { sub: rel.referrerSub, status: 'COMPLETED' } }),
      this.prisma.bookingIntent.count({ where: { sub: rel.refereeSub, dependantId: null, createdAt: { lt: rel.createdAt }, status: { in: ['COMPLETED', 'CHECKED_IN', 'NO_SHOW', 'PENDING_CLINIC', 'CONFIRMED'] } } }),
    ]);
    const phoneOther = refereePhoneHashes.length ? (await Promise.all(refereePhoneHashes.map((h) => this.identity.seenOnOtherSub('PHONE', h, rel.refereeSub)))).some(Boolean) : false;
    const refunded = booking ? (booking.depositStatus === 'REFUNDED' && booking.status !== 'CANCELLED') || (await this.prisma.paymentIntent.count({ where: { bookingId: booking.id, status: { in: ['REFUNDED', 'PARTIALLY_REFUNDED'] } } })) > 0 : false;
    const providerLed = booking ? await this.providerLedByReferrer(booking.id, rel.referrerSub) : false;
    const skipFraud = o.override || o.reviewedAllow || rel.reviewState === 'RELEASED';
    const qFacts = skipFraud ? null : await this.fraud.qualificationFacts({ id: rel.id, referrerSub: rel.referrerSub, refereeSub: rel.refereeSub, createdAt: rel.createdAt, qualifiedAt: rel.qualifiedAt }, booking, now);
    let verdict = qFacts ? await this.fraud.evaluate('QUALIFICATION', qFacts) : { action: 'ALLOW' as const, signals: [] as never[], score: 0 };
    // GRW-P3-D: fraud v2 scores the same facts (shadow unless a rule is enforced; it can only make the verdict stronger)
    if (qFacts) verdict = (await this.fraud.escalate(verdict as never, 'REWARD', qFacts, { subject: rel.referrerSub, evidenceRef: `rel:${rel.id}`, relationshipIds: [rel.id] })) as typeof verdict;
    if (verdict.signals.length) await this.fraud.record(verdict.signals, { subject: rel.referrerSub, evidenceRef: `rel:${rel.id}`, score: verdict.score });

    const ageDays = referrerProfile ? Math.floor((now.getTime() - referrerProfile.createdAt.getTime()) / DAY) : 0;
    const budgetExhausted = false; // issuance reports BUDGET_EXHAUSTED itself and the transaction then rolls back to PENDING (below)
    const facts: QualFacts = {
      now, relationship: { createdAt: rel.createdAt, status: rel.status, reviewState: rel.reviewState },
      referee: { phoneVerified: !!refereeProfile?.phone || refereePhoneHashes.length > 0, existingPatientBeforeClaim: existing > 0, phoneSeenOnOtherAccount: phoneOther },
      booking: booking ? { status: booking.status, careType: bookingCareType(booking), completedAt: rel.completedAt ?? booking.terminalAt, refundedOrDisputed: refunded, providerLedByReferrerLink: providerLed, firstBookingAt: booking.createdAt } : null,
      referrer: { suspended: rel.code.status !== 'ACTIVE', accountAgeDays: ageDays, completedBookings: referrerDone, qualified30d: q30, qualifiedYear: qYear },
      campaignCapReached: false, // a campaign has no reward budget field yet (P2-A as-built); the per-campaign cap lives in REWARD_RULES and is enforced at issuance
      budgetExhausted, fraudAction: verdict.action === 'HOLD' ? 'HOLD' : verdict.action === 'REJECT' || verdict.action === 'REVERSE' ? 'REJECT' : 'ALLOW',
    };
    let res: QualResult = qualify(facts, rules);
    if (o.override && res.result === 'PENDING' && res.checks.filter((c) => c.state === 'PENDING').every((c) => ['HOLD_PERIOD', 'FRAUD', 'RULE_BUDGET', 'REFERRER_EARNED'].includes(c.key))) res = { ...res, result: 'QUALIFIED' };

    const pre = await this.issuance.policySnapshot(); // before the transaction opens
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ status: string }[]>`SELECT "status" FROM "ReferralRelationship" WHERE "id" = ${rel.id} FOR UPDATE`;
      if (!locked[0] || ['QUALIFIED', 'REJECTED', 'EXPIRED'].includes(locked[0].status)) return out; // another evaluation finished first
      await tx.referralQualificationCheck.createMany({ data: res.checks.map((c) => ({ relationshipId: rel.id, checkKey: c.key, passed: c.state === 'PASS', detail: { state: c.state, ...(c.reason ? { reason: c.reason } : {}), ...(c.detail ?? {}) } })) });
      if (verdict.action === 'HOLD' && res.result !== 'REJECTED') await tx.referralRelationship.update({ where: { id: rel.id }, data: { reviewState: 'HOLD' } });
      if (res.result === 'REJECTED') {
        await tx.referralRelationship.update({ where: { id: rel.id }, data: { status: res.reason === 'EXPIRED' ? 'EXPIRED' : 'REJECTED', rejectReason: res.reason ?? 'REJECTED' } });
        await this.events.emit(tx, 'ReferralRejected', 'ReferralRelationship', rel.id, { relationshipRef: rel.id, market: rel.market, reasonCode: res.reason ?? 'REJECTED', rejectedAt: now.toISOString() }, `${rel.id}:rej`);
        return { ...out, result: 'REJECTED' as const, reason: res.reason };
      }
      if (res.result === 'PENDING') return { ...out, result: 'PENDING' as const };

      // QUALIFIED: both lots through the ledger in this transaction; the same keys make a repeat a no-op
      const issued: { referrer?: string; referee?: string } = {};
      const role = async (kind: 'REFERRER' | 'REFEREE', sub: string, amount: number) => {
        const r = await this.issuance.issue({ kind, sub, amountMinor: amount, funding: 'PLATFORM_MARKETING', idempotencyKey: issueKey('ref', rel.id, kind.toLowerCase(), rewardVersion), reasonCode: kind === 'REFERRER' ? 'REFERRER_QUALIFIED' : 'REFEREE_WELCOME', actor: 'system:referral', qualifyingBookingId: booking!.id, relationshipId: rel.id, now, pre }, tx);
        return r;
      };
      const a = await role('REFERRER', rel.referrerSub, rw.amounts.referrerMinor);
      const b = await role('REFEREE', rel.refereeSub, rw.amounts.refereeMinor);
      if ((a.status === 'SKIPPED' && a.reason === 'BUDGET_EXHAUSTED') || (b.status === 'SKIPPED' && b.reason === 'BUDGET_EXHAUSTED')) throw new BudgetWait();
      if (a.status !== 'SKIPPED') issued.referrer = a.lotId;
      if (b.status !== 'SKIPPED') issued.referee = b.lotId;
      await tx.referralQualificationCheck.create({ data: { relationshipId: rel.id, checkKey: 'REWARD_ISSUED', passed: !!(issued.referrer || issued.referee), detail: { referrer: a.status === 'SKIPPED' ? a.reason : 'ISSUED', referee: b.status === 'SKIPPED' ? b.reason : 'ISSUED' } } });
      await tx.referralRelationship.update({ where: { id: rel.id }, data: { status: 'QUALIFIED', qualifiedAt: now, qualifiedBookingId: booking!.id, reviewState: rel.reviewState === 'HOLD' ? 'RELEASED' : rel.reviewState } });
      await this.events.emit(tx, 'ReferralQualified', 'ReferralRelationship', rel.id, { relationshipRef: rel.id, market: rel.market, ruleVersion: rel.ruleVersionId, qualifiedAt: now.toISOString() }, rel.id);
      return { ...out, result: 'QUALIFIED' as const, issued };
    }, { timeout: 30_000 }).catch((e) => { if (e instanceof BudgetWait) return { ...out, result: 'PENDING' as const, reason: 'BUDGET_EXHAUSTED' }; throw e; });
  }

  private async providerLedByReferrer(bookingId: string, referrerSub: string): Promise<boolean> {
    // a referral never pays for a booking a provider brought (provider-led evidence only removes a fee, and then no referral reward is due either)
    const d = await this.prisma.growthAttributionDecision.findFirst({ where: { bookingId }, orderBy: { createdAt: 'desc' }, select: { origin: true } }).catch(() => null);
    return d?.origin === 'PROVIDER_LED';
  }

  // ───────────── jobs and reviewer decisions ─────────────

  /** Relationships whose hold window ended (and are not under fraud review) are evaluated; relationships past the claim window without a visit expire. */
  async runDue(now = new Date()): Promise<{ evaluated: number; expired: number }> {
    if (!(await this.policy.referralOn())) return { evaluated: 0, expired: 0 };
    const { rules } = await this.policy.referralRules();
    const due = await this.prisma.referralRelationship.findMany({ where: { status: 'BOOKED', holdUntil: { lte: now }, reviewState: { in: ['NONE', 'RELEASED'] } }, take: 200, select: { id: true } });
    for (const d of due) await this.evaluate(d.id, { now }).catch((e) => this.log.warn(`evaluate ${d.id} failed: ${(e as Error).message}`));
    const stale = await this.prisma.referralRelationship.findMany({ where: { status: 'SIGNED_UP', createdAt: { lt: new Date(now.getTime() - rules.qualification.lookbackDays * DAY) } }, take: 200, select: { id: true } });
    for (const s of stale) await this.evaluate(s.id, { now }).catch(() => undefined);
    return { evaluated: due.length, expired: stale.length };
  }

  async decide(actor: { sub: string }, id: string, decision: 'QUALIFY_OVERRIDE' | 'REJECT' | 'RELEASE_HOLD', note: string | undefined, now = new Date()) {
    const rel = await this.prisma.referralRelationship.findUnique({ where: { id } });
    if (!rel) throw new ApiError(404, 'REFERRAL_NOT_FOUND', 'Relationship not found');
    if (['QUALIFIED', 'REJECTED', 'EXPIRED'].includes(rel.status)) throw new ApiError(409, 'REFERRAL_ALREADY_DECIDED', `The relationship is ${rel.status}`);
    if (decision === 'REJECT') {
      await this.prisma.$transaction(async (tx) => {
        await tx.referralRelationship.update({ where: { id }, data: { status: 'REJECTED', rejectReason: 'FRAUD_HOLD', reviewState: 'REJECTED' } });
        await tx.referralQualificationCheck.create({ data: { relationshipId: id, checkKey: 'REVIEW_DECISION', passed: false, detail: { decision, by: actor.sub.slice(0, 40) } } });
        await this.events.emit(tx, 'ReferralRejected', 'ReferralRelationship', id, { relationshipRef: id, market: rel.market, reasonCode: 'FRAUD_HOLD', rejectedAt: now.toISOString() }, `${id}:review`);
        await tx.auditLog.create({ data: { actor: actor.sub, action: 'growth.referral.reject', resource: 'ReferralRelationship', resourceId: id, metadata: { note: note?.slice(0, 200) } } });
      });
      return { status: 'REJECTED' };
    }
    if (decision === 'RELEASE_HOLD') {
      await this.prisma.referralRelationship.update({ where: { id }, data: { reviewState: 'RELEASED' } });
      await this.prisma.auditLog.create({ data: { actor: actor.sub, action: 'growth.referral.release_hold', resource: 'ReferralRelationship', resourceId: id, metadata: { note: note?.slice(0, 200) } } });
      return { ...(await this.evaluate(id, { now, reviewedAllow: true })), status: 'RELEASED' };
    }
    // QUALIFY_OVERRIDE moves money: two different people. The first call records the request, a DIFFERENT super admin's identical call executes it.
    const open = await this.prisma.auditLog.findFirst({ where: { action: 'growth.referral.override_requested', resourceId: id, createdAt: { gte: new Date(now.getTime() - DAY) } }, orderBy: { createdAt: 'desc' } });
    if (!open || open.actor === actor.sub) {
      if (open?.actor === actor.sub) throw new ApiError(409, 'OVERRIDE_NEEDS_SECOND_PERSON', 'A different person must confirm this override');
      await this.prisma.auditLog.create({ data: { actor: actor.sub, action: 'growth.referral.override_requested', resource: 'ReferralRelationship', resourceId: id, metadata: { note: note?.slice(0, 200) } } });
      return { status: 'OVERRIDE_REQUESTED' };
    }
    await this.prisma.auditLog.create({ data: { actor: actor.sub, action: 'growth.referral.override_confirmed', resource: 'ReferralRelationship', resourceId: id, metadata: { requestedBy: open.actor } } });
    return { ...(await this.evaluate(id, { now, override: true })), status: 'OVERRIDDEN' };
  }
}

class BudgetWait extends Error {}
const bookingCareType = (b: { serviceLocation: string; telehealth: unknown }): string => (b.serviceLocation === 'HOME' ? 'HOME_VISIT' : b.telehealth ? 'VIDEO' : 'IN_CLINIC');
