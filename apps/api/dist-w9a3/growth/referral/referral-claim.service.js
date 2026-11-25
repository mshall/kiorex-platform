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
exports.ReferralClaimService = void 0;
const common_1 = require("@nestjs/common");
const errors_1 = require("../../common/errors");
const privacy_hash_1 = require("../../common/privacy-hash");
const prisma_service_1 = require("../../prisma/prisma.service");
const growth_flags_1 = require("../growth-flags");
const growth_limiter_1 = require("../growth-limiter");
const reward_events_service_1 = require("../rewards/reward-events.service");
const reward_policy_service_1 = require("../rewards/reward-policy.service");
const referral_code_1 = require("./referral-code");
const referral_fraud_service_1 = require("./referral-fraud.service");
const referral_identity_service_1 = require("./referral-identity.service");
const REJECTION = 'REFERRAL_REJECTED';
const rejected = (reason) => new errors_1.ApiError(409, REJECTION, 'This invite cannot be used', { status: 'REJECTED', reason });
let ReferralClaimService = class ReferralClaimService {
    prisma;
    policy;
    identity;
    fraud;
    events;
    limiter;
    constructor(prisma, policy, identity, fraud, events, limiter) {
        this.prisma = prisma;
        this.policy = policy;
        this.identity = identity;
        this.fraud = fraud;
        this.events = events;
        this.limiter = limiter;
    }
    async claim(u, rawCode, ctx = {}) {
        const now = ctx.now ?? new Date();
        await this.limiter.take('referral-claim', u.sub.slice(0, 24), 20, 3600_000);
        const code = (0, referral_code_1.normalizeReferralCode)(rawCode);
        if (!code)
            throw new errors_1.ApiError(400, 'GROWTH_INVALID_REQUEST', 'code must be 8 characters');
        const market = growth_flags_1.GROWTH_DEFAULT_MARKET;
        const first = await this.prisma.referralRelationship.findUnique({ where: { market_refereeSub: { market, refereeSub: u.sub } } });
        if (first) {
            if (first.status === 'REJECTED')
                throw rejected(first.rejectReason ?? 'REJECTED');
            return { status: first.status };
        }
        const { rules, versionId } = await this.policy.referralRules();
        if (!rules.enabled)
            throw rejected('RULES_DISABLED');
        const row = await this.prisma.referralCode.findUnique({ where: { code } });
        const phoneHash = u.phone ? (0, privacy_hash_1.addressHash)(u.phone) : undefined;
        await this.identity.recordPhone(u.sub, u.phone);
        if (ctx.ip)
            await this.identity.record(u.sub, 'IP24', (0, privacy_hash_1.ipHashOf)(ctx.ip, now));
        if (!row || row.status !== 'ACTIVE')
            throw rejected('CODE_SUSPENDED');
        if (row.sub === u.sub)
            throw rejected('SELF_REFERRAL');
        const touch = ctx.visitorKey ? await this.prisma.growthTouchpoint.findFirst({ where: { visitorKey: ctx.visitorKey, kind: 'REFERRAL', linkCode: code, occurredAt: { gte: new Date(now.getTime() - rules.qualification.lookbackDays * 86_400_000) } }, orderBy: { occurredAt: 'desc' } }) : null;
        const existing = await this.existingPatient(u.sub, now);
        const facts = await this.fraud.claimFacts({ referrerSub: row.sub, refereeSub: u.sub, refereePhoneHash: phoneHash, ipHash: ctx.ip ? (0, privacy_hash_1.ipHashOf)(ctx.ip, now) : undefined, touch: touch ? { id: touch.id, occurredAt: touch.occurredAt, ipHash: touch.ipHash } : null, now });
        let verdict = await this.fraud.evaluate('CLAIM', facts);
        verdict = await this.fraud.escalate(verdict, 'REFERRAL_CLAIM', facts, { subject: row.sub, evidenceRef: `claim:${row.id}:${(0, privacy_hash_1.subRefOf)(u.sub).slice(0, 12)}` });
        await this.fraud.record(verdict.signals, { subject: row.sub, evidenceRef: `claim:${row.id}:${(0, privacy_hash_1.subRefOf)(u.sub).slice(0, 12)}`, score: verdict.score });
        let status = 'SIGNED_UP';
        let reason;
        if (existing) {
            status = 'REJECTED';
            reason = 'ALREADY_PATIENT';
        }
        else if (verdict.action === 'REJECT') {
            status = 'REJECTED';
            reason = verdict.signals.some((s) => s.ruleId === 'RF_DUP_ACCOUNT') ? 'DUPLICATE_IDENTITY' : verdict.signals.some((s) => s.ruleId === 'RF_SELF') ? 'SELF_REFERRAL' : 'FRAUD_HOLD';
        }
        else if (verdict.action === 'HOLD') {
            status = 'SIGNED_UP';
        }
        try {
            const rel = await this.prisma.$transaction(async (tx) => {
                const r = await tx.referralRelationship.create({ data: { market, referrerSub: row.sub, refereeSub: u.sub, codeId: row.id, touchId: touch?.id ?? null, status, rejectReason: reason ?? null, ruleVersionId: versionId, reviewState: verdict.action === 'HOLD' ? 'HOLD' : 'NONE', claimedVia: ctx.via ?? 'LINK', createdAt: now } });
                if (status === 'REJECTED')
                    await this.events.emit(tx, 'ReferralRejected', 'ReferralRelationship', r.id, { relationshipRef: r.id, market, reasonCode: reason, rejectedAt: now.toISOString() }, r.id);
                else
                    await this.events.emit(tx, 'ReferralRelationshipCreated', 'ReferralRelationship', r.id, { relationshipRef: r.id, market, ruleVersion: versionId, createdAt: now.toISOString() }, r.id);
                return r;
            });
            if (rel.status === 'REJECTED')
                throw rejected(rel.rejectReason);
            return { status: rel.status };
        }
        catch (e) {
            if (e.code === 'P2002') {
                const won = await this.prisma.referralRelationship.findUnique({ where: { market_refereeSub: { market, refereeSub: u.sub } } });
                if (won)
                    return { status: won.status };
            }
            throw e;
        }
    }
    async existingPatient(sub, now) {
        return !!(await this.prisma.bookingIntent.findFirst({ where: { sub, dependantId: null, createdAt: { lt: now }, status: { in: ['COMPLETED', 'CHECKED_IN', 'NO_SHOW', 'PENDING_CLINIC', 'CONFIRMED'] } }, select: { id: true } }));
    }
};
exports.ReferralClaimService = ReferralClaimService;
exports.ReferralClaimService = ReferralClaimService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, reward_policy_service_1.RewardPolicyService, referral_identity_service_1.ReferralIdentityService, referral_fraud_service_1.ReferralFraudService, reward_events_service_1.RewardEventsService, growth_limiter_1.GrowthLimiter])
], ReferralClaimService);
//# sourceMappingURL=referral-claim.service.js.map