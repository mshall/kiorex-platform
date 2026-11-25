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
exports.FraudHoldService = exports.relationshipIdsOf = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const reward_hold_service_1 = require("../rewards/reward-hold.service");
const reward_reversal_service_1 = require("../rewards/reward-reversal.service");
const growth_limiter_1 = require("../growth-limiter");
const relationshipIdsOf = (refs) => [...new Set(refs.filter((r) => !!r && /^(rel|cancel):/.test(r)).map((r) => r.split(':')[1]))];
exports.relationshipIdsOf = relationshipIdsOf;
const DAY = 86_400_000;
const FRAUD_ACTOR = 'system:fraud';
let FraudHoldService = class FraudHoldService {
    prisma;
    holds;
    reversal;
    limiter;
    log = new common_1.Logger('fraud-hold');
    constructor(prisma, holds, reversal, limiter) {
        this.prisma = prisma;
        this.holds = holds;
        this.reversal = reversal;
        this.limiter = limiter;
    }
    async lotsOf(relationshipIds) {
        if (!relationshipIds.length)
            return [];
        return this.prisma.rewardLot.findMany({ where: { relationshipId: { in: relationshipIds } }, select: { id: true, kind: true } });
    }
    async holdRewards(relationshipIds, reasonCode = 'FRAUD_REVIEW') {
        let held = 0;
        for (const l of await this.lotsOf(relationshipIds)) {
            const r = await this.holds.hold(l.id, reasonCode, FRAUD_ACTOR);
            if (r.heldMinor > 0)
                held++;
        }
        return held;
    }
    async releaseRewards(relationshipIds, reasonCode = 'FRAUD_CLEARED') {
        let n = 0;
        for (const l of await this.lotsOf(relationshipIds)) {
            const r = await this.holds.release(l.id, FRAUD_ACTOR, reasonCode);
            if (r.releasedMinor > 0)
                n++;
        }
        return n;
    }
    async reverseRewards(relationshipIds, actor) {
        let reversedMinor = 0;
        let lots = 0;
        for (const l of await this.lotsOf(relationshipIds)) {
            const r = await this.reversal.reverseLot(l.id, 'FRAUD_CONFIRMED', actor);
            if (r.reversedMinor > 0) {
                reversedMinor += r.reversedMinor;
                lots++;
            }
        }
        return { reversedMinor, lots };
    }
    async suspendReferral(relationshipIds) {
        if (!relationshipIds.length)
            return 0;
        const rels = await this.prisma.referralRelationship.findMany({ where: { id: { in: relationshipIds } }, select: { codeId: true } });
        const r = await this.prisma.referralCode.updateMany({ where: { id: { in: rels.map((x) => x.codeId) }, status: 'ACTIVE' }, data: { status: 'SUSPENDED' } });
        return r.count;
    }
    async reinstateReferral(relationshipIds) {
        if (!relationshipIds.length)
            return 0;
        const rels = await this.prisma.referralRelationship.findMany({ where: { id: { in: relationshipIds } }, select: { codeId: true } });
        return (await this.prisma.referralCode.updateMany({ where: { id: { in: rels.map((x) => x.codeId) }, status: 'SUSPENDED' }, data: { status: 'ACTIVE' } })).count;
    }
    async throttleOrigin(originRef, minutes = 60) {
        await this.limiter.limiter.hit(`fraud:origin-throttle:${originRef}`, 1, minutes * 60_000);
    }
    async originThrottled(originRef) {
        const r = await this.limiter.limiter.blocked(`fraud:origin-throttle:${originRef}`, 1, 60 * 60_000);
        return !r.ok;
    }
    async quarantineTouch(touchRef) {
        await this.prisma.auditLog.create({ data: { actor: FRAUD_ACTOR, action: 'growth.fraud.touch_quarantine', resource: 'GrowthTouchpoint', resourceId: touchRef, metadata: { reversible: true } } });
    }
    async quarantinedTouchIds(since) {
        return (await this.prisma.auditLog.findMany({ where: { action: 'growth.fraud.touch_quarantine', createdAt: { gte: since } }, select: { resourceId: true } })).map((r) => r.resourceId).filter(Boolean);
    }
    async apply(action, ctx) {
        try {
            switch (action) {
                case 'HOLD_REWARD': return `held ${await this.holdRewards(ctx.relationshipIds)} lot(s)`;
                case 'SUSPEND_REFERRAL': return `suspended ${await this.suspendReferral(ctx.relationshipIds)} code(s)`;
                case 'THROTTLE_ORIGIN':
                    if (ctx.originRef) {
                        await this.throttleOrigin(ctx.originRef);
                        return 'origin throttled';
                    }
                    return 'no origin';
                case 'QUARANTINE_TOUCH':
                    if (ctx.touchRef) {
                        await this.quarantineTouch(ctx.touchRef);
                        return 'touch quarantined';
                    }
                    return 'no touch';
                default: return 'none';
            }
        }
        catch (e) {
            this.log.warn(`apply ${action} failed: ${e.message}`);
            return `failed: ${e.message.slice(0, 80)}`;
        }
    }
    static DAY = DAY;
};
exports.FraudHoldService = FraudHoldService;
exports.FraudHoldService = FraudHoldService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, reward_hold_service_1.RewardHoldService, reward_reversal_service_1.RewardReversalService, growth_limiter_1.GrowthLimiter])
], FraudHoldService);
//# sourceMappingURL=fraud-hold.service.js.map