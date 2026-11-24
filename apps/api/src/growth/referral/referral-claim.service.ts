import { Injectable } from '@nestjs/common';
import { ApiError } from '../../common/errors';
import { addressHash, ipHashOf, subRefOf } from '../../common/privacy-hash';
import { PrismaService } from '../../prisma/prisma.service';
import { GROWTH_DEFAULT_MARKET } from '../growth-flags';
import { GrowthLimiter } from '../growth-limiter';
import { RewardEventsService } from '../rewards/reward-events.service';
import { RewardPolicyService } from '../rewards/reward-policy.service';
import { normalizeReferralCode } from './referral-code';
import { ReferralFraudService } from './referral-fraud.service';
import { ReferralIdentityService } from './referral-identity.service';

export interface ClaimResult { status: string; reason?: string }
const REJECTION = 'REFERRAL_REJECTED';
const rejected = (reason: string) => new ApiError(409, REJECTION, 'This invite cannot be used', { status: 'REJECTED', reason });

/**
 * Referral claim (GRW-P2-B1): `POST /growth/v1/referral/claim {code}` by the invited person. FIRST CLAIM WINS: one relationship per person and market, a second claim of any code answers
 * the first one's status and changes nothing. Every refusal has the SAME shape (409 REFERRAL_REJECTED with a machine `reason`), and the reason never says who owns the code: an unknown code, a
 * malformed one and a suspended one all answer CODE_SUSPENDED (no oracle). A self-referral is refused with the same shape. A visitor touch of kind REFERRAL (consented) is only read to measure
 * the claim window and the claim speed; with no consent the code travels as contractual referral data in this request.
 */
@Injectable()
export class ReferralClaimService {
  constructor(private readonly prisma: PrismaService, private readonly policy: RewardPolicyService, private readonly identity: ReferralIdentityService, private readonly fraud: ReferralFraudService, private readonly events: RewardEventsService, private readonly limiter: GrowthLimiter) {}

  async claim(u: { sub: string; phone?: string }, rawCode: unknown, ctx: { visitorKey?: string | null; ip?: string; via?: 'LINK' | 'SIGNUP' | 'APP'; now?: Date } = {}): Promise<ClaimResult> {
    const now = ctx.now ?? new Date();
    await this.limiter.take('referral-claim', u.sub.slice(0, 24), 20, 3600_000);
    const code = normalizeReferralCode(rawCode);
    if (!code) throw new ApiError(400, 'GROWTH_INVALID_REQUEST', 'code must be 8 characters');
    const market = GROWTH_DEFAULT_MARKET;
    const first = await this.prisma.referralRelationship.findUnique({ where: { market_refereeSub: { market, refereeSub: u.sub } } });
    if (first) { if (first.status === 'REJECTED') throw rejected(first.rejectReason ?? 'REJECTED'); return { status: first.status }; }

    const { rules, versionId } = await this.policy.referralRules();
    if (!rules.enabled) throw rejected('RULES_DISABLED');
    const row = await this.prisma.referralCode.findUnique({ where: { code } });
    const phoneHash = u.phone ? addressHash(u.phone) : undefined;
    await this.identity.recordPhone(u.sub, u.phone);
    if (ctx.ip) await this.identity.record(u.sub, 'IP24', ipHashOf(ctx.ip, now));
    if (!row || row.status !== 'ACTIVE') throw rejected('CODE_SUSPENDED'); // unknown, malformed and suspended look the same
    if (row.sub === u.sub) throw rejected('SELF_REFERRAL');

    const touch = ctx.visitorKey ? await this.prisma.growthTouchpoint.findFirst({ where: { visitorKey: ctx.visitorKey, kind: 'REFERRAL', linkCode: code, occurredAt: { gte: new Date(now.getTime() - rules.qualification.lookbackDays * 86_400_000) } }, orderBy: { occurredAt: 'desc' } }) : null;
    // the claim window (30 days) is measured from the consented touch when there is one; without it this request is the start of the window

    const existing = await this.existingPatient(u.sub, now);
    const facts = await this.fraud.claimFacts({ referrerSub: row.sub, refereeSub: u.sub, refereePhoneHash: phoneHash, ipHash: ctx.ip ? ipHashOf(ctx.ip, now) : undefined, touch: touch ? { id: touch.id, occurredAt: touch.occurredAt, ipHash: touch.ipHash } : null, now });
    let verdict = await this.fraud.evaluate('CLAIM', facts);
    verdict = await this.fraud.escalate(verdict, 'REFERRAL_CLAIM', facts, { subject: row.sub, evidenceRef: `claim:${row.id}:${subRefOf(u.sub).slice(0, 12)}` }); // GRW-P3-D (shadow unless a rule is enforced)
    await this.fraud.record(verdict.signals, { subject: row.sub, evidenceRef: `claim:${row.id}:${subRefOf(u.sub).slice(0, 12)}`, score: verdict.score });

    let status = 'SIGNED_UP'; let reason: string | undefined;
    if (existing) { status = 'REJECTED'; reason = 'ALREADY_PATIENT'; }
    else if (verdict.action === 'REJECT') { status = 'REJECTED'; reason = verdict.signals.some((s) => s.ruleId === 'RF_DUP_ACCOUNT') ? 'DUPLICATE_IDENTITY' : verdict.signals.some((s) => s.ruleId === 'RF_SELF') ? 'SELF_REFERRAL' : 'FRAUD_HOLD'; }
    else if (verdict.action === 'HOLD') { status = 'SIGNED_UP'; }
    try {
      const rel = await this.prisma.$transaction(async (tx) => {
        const r = await tx.referralRelationship.create({ data: { market, referrerSub: row.sub, refereeSub: u.sub, codeId: row.id, touchId: touch?.id ?? null, status, rejectReason: reason ?? null, ruleVersionId: versionId, reviewState: verdict.action === 'HOLD' ? 'HOLD' : 'NONE', claimedVia: ctx.via ?? 'LINK', createdAt: now } });
        if (status === 'REJECTED') await this.events.emit(tx, 'ReferralRejected', 'ReferralRelationship', r.id, { relationshipRef: r.id, market, reasonCode: reason!, rejectedAt: now.toISOString() }, r.id);
        else await this.events.emit(tx, 'ReferralRelationshipCreated', 'ReferralRelationship', r.id, { relationshipRef: r.id, market, ruleVersion: versionId, createdAt: now.toISOString() }, r.id);
        return r;
      });
      if (rel.status === 'REJECTED') throw rejected(rel.rejectReason!);
      return { status: rel.status };
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') { const won = await this.prisma.referralRelationship.findUnique({ where: { market_refereeSub: { market, refereeSub: u.sub } } }); if (won) return { status: won.status }; } // two parallel claims: the first stored one wins, the other reads it
      throw e;
    }
  }

  /** A patient before the claim: a visit already attended, or an active booking made before the code was claimed. A cancelled or never-confirmed attempt does not make someone an existing patient. */
  async existingPatient(sub: string, now: Date): Promise<boolean> {
    return !!(await this.prisma.bookingIntent.findFirst({ where: { sub, dependantId: null, createdAt: { lt: now }, status: { in: ['COMPLETED', 'CHECKED_IN', 'NO_SHOW', 'PENDING_CLINIC', 'CONFIRMED'] } }, select: { id: true } }));
  }
}
