"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReferralQualificationService = void 0;
const market_core_public_1 = require("../../market/market-core-public");
const common_1 = require("@nestjs/common");
const errors_1 = require("../../common/errors");
const prisma_service_1 = require("../../prisma/prisma.service");
const reward_events_service_1 = require("../rewards/reward-events.service");
const reward_issuance_service_1 = require("../rewards/reward-issuance.service");
const reward_policy_service_1 = require("../rewards/reward-policy.service");
const reward_reversal_service_1 = require("../rewards/reward-reversal.service");
const referral_fraud_service_1 = require("./referral-fraud.service");
const referral_identity_service_1 = require("./referral-identity.service");
const referral_qualification_1 = require("./referral-qualification");
const DAY = 86_400_000;
let ReferralQualificationService = class ReferralQualificationService {
    prisma;
    policy;
    fraud;
    identity;
    issuance;
    reversal;
    events;
    log = new common_1.Logger('referral-qualification');
    constructor(prisma, policy, fraud, identity, issuance, reversal, events) {
        this.prisma = prisma;
        this.policy = policy;
        this.fraud = fraud;
        this.identity = identity;
        this.issuance = issuance;
        this.reversal = reversal;
        this.events = events;
    }
    async onBookingCompleted(bookingId) {
        try {
            const b = await this.prisma.bookingIntent.findUnique({ where: { id: bookingId } });
            if (!b || b.dependantId)
                return;
            const rel = await this.prisma.referralRelationship.findUnique({ where: { market_refereeSub: { market: market_core_public_1.DEFAULT_MARKET, refereeSub: b.sub } } });
            if (!rel || !['SIGNED_UP', 'BOOKED'].includes(rel.status)) {
                await this.afterRepeat(b.id, b.sub);
                return;
            }
            const { rules } = await this.policy.referralRules();
            const holdUntil = new Date((b.terminalAt ?? new Date()).getTime() + rules.qualification.holdDays * DAY);
            await this.prisma.referralRelationship.updateMany({ where: { id: rel.id, status: { in: ['SIGNED_UP', 'BOOKED'] } }, data: { status: 'BOOKED', firstBookingId: rel.firstBookingId ?? b.id, completedAt: rel.completedAt ?? b.terminalAt ?? new Date(), holdUntil: rel.holdUntil ?? holdUntil } });
            if (!(await this.policy.referralOn()))
                return;
            await this.evaluate(rel.id);
        }
        catch (e) {
            this.log.warn(`referral hook for completed booking ${bookingId} failed: ${e.message}`);
        }
    }
    async onBookingCancelled(bookingId) {
        try {
            const rels = await this.prisma.referralRelationship.findMany({ where: { OR: [{ firstBookingId: bookingId }, { qualifiedBookingId: bookingId }] } });
            for (const rel of rels) {
                if (rel.status === 'QUALIFIED') {
                    const out = await this.reversal.reverseForBooking(bookingId, 'BOOKING_CANCELLED');
                    if (out.length)
                        await this.fraud.record([{ ruleId: 'RF_CANCEL_ABUSE', score: 80, action: 'REVERSE', reason: 'cancelled after the reward' }], { subject: rel.referrerSub, evidenceRef: `cancel:${rel.id}`, score: 80 });
                }
                else if (['SIGNED_UP', 'BOOKED'].includes(rel.status) && (await this.policy.referralOn()))
                    await this.evaluate(rel.id);
            }
        }
        catch (e) {
            this.log.warn(`referral hook for cancelled booking ${bookingId} failed: ${e.message}`);
        }
    }
    async afterRepeat(bookingId, refereeSub) {
        const { rules } = await this.policy.referralRules();
        if (rules.repeatBonus.count <= 0 || !(await this.policy.referralOn()))
            return;
        const rel = await this.prisma.referralRelationship.findUnique({ where: { market_refereeSub: { market: market_core_public_1.DEFAULT_MARKET, refereeSub } } });
        if (!rel || rel.status !== 'QUALIFIED' || !rel.qualifiedBookingId || rel.qualifiedBookingId === bookingId)
            return;
        const b = await this.prisma.bookingIntent.findUnique({ where: { id: bookingId } });
        const first = await this.prisma.bookingIntent.findUnique({ where: { id: rel.qualifiedBookingId } });
        const after = await this.prisma.rewardLot.count({ where: { relationshipId: rel.id, kind: 'REPEAT' } });
        if (!b || b.status !== 'COMPLETED' || !(0, referral_qualification_1.repeatEligible)(rules, { completedAfterFirst: after, firstCompletedAt: first?.terminalAt ?? null, bookingCompletedAt: b.terminalAt }))
            return;
        const { rules: rr, versionId } = await this.policy.rewardRules();
        await this.issuance.issue({ kind: 'REPEAT', sub: rel.referrerSub, amountMinor: rr.amounts.repeatMinor, funding: 'PLATFORM_MARKETING', idempotencyKey: (0, reward_issuance_service_1.issueKey)('ref', rel.id, 'repeat', bookingId, versionId), reasonCode: 'REPEAT_BOOKING', actor: 'system:referral', qualifyingBookingId: bookingId, relationshipId: rel.id });
    }
    async evaluate(relationshipId, o = {}) {
        const now = o.now ?? new Date();
        const out = { relationshipId, result: 'UNCHANGED', issued: {} };
        const rel = await this.prisma.referralRelationship.findUnique({ where: { id: relationshipId }, include: { code: true } });
        if (!rel || ['QUALIFIED', 'REJECTED', 'EXPIRED'].includes(rel.status))
            return out;
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
        let verdict = qFacts ? await this.fraud.evaluate('QUALIFICATION', qFacts) : { action: 'ALLOW', signals: [], score: 0 };
        if (qFacts)
            verdict = (await this.fraud.escalate(verdict, 'REWARD', qFacts, { subject: rel.referrerSub, evidenceRef: `rel:${rel.id}`, relationshipIds: [rel.id] }));
        if (verdict.signals.length)
            await this.fraud.record(verdict.signals, { subject: rel.referrerSub, evidenceRef: `rel:${rel.id}`, score: verdict.score });
        const ageDays = referrerProfile ? Math.floor((now.getTime() - referrerProfile.createdAt.getTime()) / DAY) : 0;
        const budgetExhausted = false;
        const facts = {
            now, relationship: { createdAt: rel.createdAt, status: rel.status, reviewState: rel.reviewState },
            referee: { phoneVerified: !!refereeProfile?.phone || refereePhoneHashes.length > 0, existingPatientBeforeClaim: existing > 0, phoneSeenOnOtherAccount: phoneOther },
            booking: booking ? { status: booking.status, careType: bookingCareType(booking), completedAt: rel.completedAt ?? booking.terminalAt, refundedOrDisputed: refunded, providerLedByReferrerLink: providerLed, firstBookingAt: booking.createdAt } : null,
            referrer: { suspended: rel.code.status !== 'ACTIVE', accountAgeDays: ageDays, completedBookings: referrerDone, qualified30d: q30, qualifiedYear: qYear },
            campaignCapReached: false,
            budgetExhausted, fraudAction: verdict.action === 'HOLD' ? 'HOLD' : verdict.action === 'REJECT' || verdict.action === 'REVERSE' ? 'REJECT' : 'ALLOW',
        };
        let res = (0, referral_qualification_1.qualify)(facts, rules);
        if (o.override && res.result === 'PENDING' && res.checks.filter((c) => c.state === 'PENDING').every((c) => ['HOLD_PERIOD', 'FRAUD', 'RULE_BUDGET', 'REFERRER_EARNED'].includes(c.key)))
            res = { ...res, result: 'QUALIFIED' };
        const pre = await this.issuance.policySnapshot();
        return this.prisma.$transaction(async (tx) => {
            const locked = await tx.$queryRaw `SELECT "status" FROM "ReferralRelationship" WHERE "id" = ${rel.id} FOR UPDATE`;
            if (!locked[0] || ['QUALIFIED', 'REJECTED', 'EXPIRED'].includes(locked[0].status))
                return out;
            await tx.referralQualificationCheck.createMany({ data: res.checks.map((c) => ({ relationshipId: rel.id, checkKey: c.key, passed: c.state === 'PASS', detail: { state: c.state, ...(c.reason ? { reason: c.reason } : {}), ...(c.detail ?? {}) } })) });
            if (verdict.action === 'HOLD' && res.result !== 'REJECTED')
                await tx.referralRelationship.update({ where: { id: rel.id }, data: { reviewState: 'HOLD' } });
            if (res.result === 'REJECTED') {
                await tx.referralRelationship.update({ where: { id: rel.id }, data: { status: res.reason === 'EXPIRED' ? 'EXPIRED' : 'REJECTED', rejectReason: res.reason ?? 'REJECTED' } });
                await this.events.emit(tx, 'ReferralRejected', 'ReferralRelationship', rel.id, { relationshipRef: rel.id, market: rel.market, reasonCode: res.reason ?? 'REJECTED', rejectedAt: now.toISOString() }, `${rel.id}:rej`);
                return { ...out, result: 'REJECTED', reason: res.reason };
            }
            if (res.result === 'PENDING')
                return { ...out, result: 'PENDING' };
            const issued = {};
            const role = async (kind, sub, amount) => {
                const r = await this.issuance.issue({ kind, sub, amountMinor: amount, funding: 'PLATFORM_MARKETING', idempotencyKey: (0, reward_issuance_service_1.issueKey)('ref', rel.id, kind.toLowerCase(), rewardVersion), reasonCode: kind === 'REFERRER' ? 'REFERRER_QUALIFIED' : 'REFEREE_WELCOME', actor: 'system:referral', qualifyingBookingId: booking.id, relationshipId: rel.id, now, pre }, tx);
                return r;
            };
            const a = await role('REFERRER', rel.referrerSub, rw.amounts.referrerMinor);
            const b = await role('REFEREE', rel.refereeSub, rw.amounts.refereeMinor);
            if ((a.status === 'SKIPPED' && a.reason === 'BUDGET_EXHAUSTED') || (b.status === 'SKIPPED' && b.reason === 'BUDGET_EXHAUSTED'))
                throw new BudgetWait();
            if (a.status !== 'SKIPPED')
                issued.referrer = a.lotId;
            if (b.status !== 'SKIPPED')
                issued.referee = b.lotId;
            await tx.referralQualificationCheck.create({ data: { relationshipId: rel.id, checkKey: 'REWARD_ISSUED', passed: !!(issued.referrer || issued.referee), detail: { referrer: a.status === 'SKIPPED' ? a.reason : 'ISSUED', referee: b.status === 'SKIPPED' ? b.reason : 'ISSUED' } } });
            await tx.referralRelationship.update({ where: { id: rel.id }, data: { status: 'QUALIFIED', qualifiedAt: now, qualifiedBookingId: booking.id, reviewState: rel.reviewState === 'HOLD' ? 'RELEASED' : rel.reviewState } });
            await this.events.emit(tx, 'ReferralQualified', 'ReferralRelationship', rel.id, { relationshipRef: rel.id, market: rel.market, ruleVersion: rel.ruleVersionId, qualifiedAt: now.toISOString() }, rel.id);
            return { ...out, result: 'QUALIFIED', issued };
        }, { timeout: 30_000 }).catch((e) => { if (e instanceof BudgetWait)
            return { ...out, result: 'PENDING', reason: 'BUDGET_EXHAUSTED' }; throw e; });
    }
    async providerLedByReferrer(bookingId, referrerSub) {
        const d = await this.prisma.growthAttributionDecision.findFirst({ where: { bookingId }, orderBy: { createdAt: 'desc' }, select: { origin: true } }).catch(() => null);
        return d?.origin === 'PROVIDER_LED';
    }
    async runDue(now = new Date()) {
        if (!(await this.policy.referralOn()))
            return { evaluated: 0, expired: 0 };
        const { rules } = await this.policy.referralRules();
        const due = await this.prisma.referralRelationship.findMany({ where: { status: 'BOOKED', holdUntil: { lte: now }, reviewState: { in: ['NONE', 'RELEASED'] } }, take: 200, select: { id: true } });
        for (const d of due)
            await this.evaluate(d.id, { now }).catch((e) => this.log.warn(`evaluate ${d.id} failed: ${e.message}`));
        const stale = await this.prisma.referralRelationship.findMany({ where: { status: 'SIGNED_UP', createdAt: { lt: new Date(now.getTime() - rules.qualification.lookbackDays * DAY) } }, take: 200, select: { id: true } });
        for (const s of stale)
            await this.evaluate(s.id, { now }).catch(() => undefined);
        return { evaluated: due.length, expired: stale.length };
    }
    async decide(actor, id, decision, note, now = new Date()) {
        const rel = await this.prisma.referralRelationship.findUnique({ where: { id } });
        if (!rel)
            throw new errors_1.ApiError(404, 'REFERRAL_NOT_FOUND', 'Relationship not found');
        if (['QUALIFIED', 'REJECTED', 'EXPIRED'].includes(rel.status))
            throw new errors_1.ApiError(409, 'REFERRAL_ALREADY_DECIDED', `The relationship is ${rel.status}`);
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
        const open = await this.prisma.auditLog.findFirst({ where: { action: 'growth.referral.override_requested', resourceId: id, createdAt: { gte: new Date(now.getTime() - DAY) } }, orderBy: { createdAt: 'desc' } });
        if (!open || open.actor === actor.sub) {
            if (open?.actor === actor.sub)
                throw new errors_1.ApiError(409, 'OVERRIDE_NEEDS_SECOND_PERSON', 'A different person must confirm this override');
            await this.prisma.auditLog.create({ data: { actor: actor.sub, action: 'growth.referral.override_requested', resource: 'ReferralRelationship', resourceId: id, metadata: { note: note?.slice(0, 200) } } });
            return { status: 'OVERRIDE_REQUESTED' };
        }
        await this.prisma.auditLog.create({ data: { actor: actor.sub, action: 'growth.referral.override_confirmed', resource: 'ReferralRelationship', resourceId: id, metadata: { requestedBy: open.actor } } });
        return { ...(await this.evaluate(id, { now, override: true })), status: 'OVERRIDDEN' };
    }
};
exports.ReferralQualificationService = ReferralQualificationService;
exports.ReferralQualificationService = ReferralQualificationService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, reward_policy_service_1.RewardPolicyService, referral_fraud_service_1.ReferralFraudService, referral_identity_service_1.ReferralIdentityService,
        reward_issuance_service_1.RewardIssuanceService, reward_reversal_service_1.RewardReversalService, reward_events_service_1.RewardEventsService])
], ReferralQualificationService);
class BudgetWait extends Error {
}
const bookingCareType = (b) => (b.serviceLocation === 'HOME' ? 'HOME_VISIT' : b.telehealth ? 'VIDEO' : 'IN_CLINIC');
//# sourceMappingURL=referral-qualification.service.js.map