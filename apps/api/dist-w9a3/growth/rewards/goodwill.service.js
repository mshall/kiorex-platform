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
exports.GoodwillService = void 0;
const market_core_public_1 = require("../../market/market-core-public");
const common_1 = require("@nestjs/common");
const errors_1 = require("../../common/errors");
const privacy_hash_1 = require("../../common/privacy-hash");
const prisma_service_1 = require("../../prisma/prisma.service");
const goodwill_limits_1 = require("./goodwill-limits");
const reward_events_service_1 = require("./reward-events.service");
const reward_issuance_service_1 = require("./reward-issuance.service");
const reward_policy_service_1 = require("./reward-policy.service");
const startOfDayUtc = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
let GoodwillService = class GoodwillService {
    prisma;
    policy;
    issuance;
    events;
    constructor(prisma, policy, issuance, events) {
        this.prisma = prisma;
        this.policy = policy;
        this.issuance = issuance;
        this.events = events;
    }
    async phoneRelated(actor, targetSub) {
        if (actor.sub === targetSub)
            return true;
        if (!actor.phone)
            return false;
        const sig = await this.prisma.referralIdentitySignal.findFirst({ where: { kind: 'PHONE', valueHash: (0, privacy_hash_1.addressHash)(actor.phone), sub: targetSub } });
        return !!sig;
    }
    async grant(actor, i) {
        if (!(await this.policy.rewardsOn()) || !(await this.policy.goodwillOn()))
            throw new errors_1.ApiError(403, 'FEATURE_DISABLED', 'Support goodwill is switched off', { key: 'growth.support_goodwill', scope: 'global' });
        const now = i.now ?? new Date();
        const { rules } = await this.policy.rewardRules();
        const today = await this.prisma.goodwillGrant.aggregate({ where: { grantedBy: actor.sub, createdAt: { gte: startOfDayUtc(now) } }, _sum: { amountMinor: true } });
        const pending = await this.prisma.rewardApprovalRequest.aggregate({ where: { kind: 'GOODWILL', requestedBy: actor.sub, status: 'PENDING', createdAt: { gte: startOfDayUtc(now) } }, _sum: { amountMinor: true } });
        const p90 = await this.prisma.goodwillGrant.aggregate({ where: { sub: i.sub, createdAt: { gte: new Date(now.getTime() - 90 * 86_400_000) } }, _sum: { amountMinor: true } });
        const v = (0, goodwill_limits_1.checkGoodwill)(rules.credit.goodwill, i, { actorGrantedTodayMinor: (today._sum.amountMinor ?? 0) + (pending._sum.amountMinor ?? 0), patientGranted90dMinor: p90._sum.amountMinor ?? 0, actorIsTarget: await this.phoneRelated(actor, i.sub) });
        if (!v.ok)
            throw new errors_1.ApiError(422, `GOODWILL_${v.code}`, 'The goodwill grant is outside the limits', { reason: v.code });
        if (i.bookingId && !(await this.prisma.bookingIntent.findFirst({ where: { id: i.bookingId, sub: i.sub }, select: { id: true } })))
            throw new errors_1.ApiError(422, 'GOODWILL_REFERENCE_INVALID', 'The booking reference does not belong to this patient');
        if (v.needsSecondApprover) {
            const r = await this.prisma.rewardApprovalRequest.create({ data: { kind: 'GOODWILL', sub: i.sub, amountMinor: i.amountMinor, reason: i.reason, bookingId: i.bookingId ?? null, ticketRef: i.ticketRef ?? null, requestedBy: actor.sub } });
            await this.prisma.auditLog.create({ data: { actor: actor.sub, action: 'growth.goodwill.request', resource: 'RewardApprovalRequest', resourceId: r.id, metadata: { reason: i.reason, amountMinor: i.amountMinor } } });
            return { status: 'PENDING_APPROVAL', requestId: r.id };
        }
        return this.issueGrant(actor.sub, null, { sub: i.sub, reason: i.reason, amountMinor: i.amountMinor, bookingId: i.bookingId ?? null, ticketRef: i.ticketRef ?? null, key: (0, reward_issuance_service_1.issueKey)('goodwill', actor.sub, i.sub, i.reason, i.bookingId ?? i.ticketRef ?? '-', now.getTime()) }, now);
    }
    async issueGrant(grantedBy, approvedBy, g, now, outer) {
        const res = await this.issuance.issue({ kind: 'GOODWILL', sub: g.sub, amountMinor: g.amountMinor, funding: 'PLATFORM_SERVICE_RECOVERY', idempotencyKey: g.key, reasonCode: g.reason, actor: grantedBy, now, bookingId: g.bookingId }, outer);
        if (res.status === 'SKIPPED')
            throw new errors_1.ApiError(422, `GOODWILL_${res.reason}`, 'The goodwill grant could not be issued', { reason: res.reason });
        const db = outer ?? this.prisma;
        const existing = await db.goodwillGrant.findFirst({ where: { lotId: res.lotId } });
        const grant = existing ?? await db.goodwillGrant.create({ data: { sub: g.sub, reason: g.reason, bookingId: g.bookingId, ticketRef: g.ticketRef, amountMinor: g.amountMinor, lotId: res.lotId, grantedBy, approvedBy } });
        await db.auditLog.create({ data: { actor: approvedBy ?? grantedBy, action: 'growth.goodwill.grant', resource: 'GoodwillGrant', resourceId: grant.id, metadata: { reason: g.reason, amountMinor: g.amountMinor, secondApproval: !!approvedBy, lotId: res.lotId } } });
        await this.events.emit(db, 'GoodwillGranted', 'GoodwillGrant', grant.id, { grantRef: grant.id, lotRef: res.lotId, market: market_core_public_1.DEFAULT_MARKET, reason: g.reason, amountMinor: g.amountMinor, currency: 'EGP', secondApproval: !!approvedBy, at: now.toISOString() }, grant.id);
        return { status: 'GRANTED', grantId: grant.id, lotId: res.lotId };
    }
    async decide(actor, requestId, decision, note, now = new Date()) {
        const r = await this.prisma.rewardApprovalRequest.findUnique({ where: { id: requestId } });
        if (!r)
            throw new errors_1.ApiError(404, 'APPROVAL_NOT_FOUND', 'Approval request not found');
        if (r.status !== 'PENDING')
            throw new errors_1.ApiError(409, 'APPROVAL_ALREADY_DECIDED', 'This request was already decided');
        if (r.requestedBy === actor.sub)
            throw new errors_1.ApiError(403, 'APPROVAL_SELF_DECISION', 'The person who asked cannot decide the request');
        if (decision === 'REJECTED') {
            await this.prisma.rewardApprovalRequest.update({ where: { id: r.id }, data: { status: 'REJECTED', decidedBy: actor.sub, decidedAt: now, decisionNote: note?.slice(0, 300) } });
            await this.prisma.auditLog.create({ data: { actor: actor.sub, action: 'growth.reward_approval.reject', resource: 'RewardApprovalRequest', resourceId: r.id, metadata: { kind: r.kind } } });
            return { status: 'REJECTED', requestId: r.id };
        }
        return this.prisma.$transaction(async (tx) => {
            let lotId;
            if (r.kind === 'GOODWILL')
                lotId = (await this.issueGrant(r.requestedBy, actor.sub, { sub: r.sub, reason: r.reason, amountMinor: r.amountMinor, bookingId: r.bookingId, ticketRef: r.ticketRef, key: (0, reward_issuance_service_1.issueKey)('goodwill-request', r.id) }, now, tx)).lotId;
            else {
                const res = await this.issuance.issue({ kind: 'PROMO', sub: r.sub, amountMinor: r.amountMinor, funding: 'PLATFORM_MARKETING', idempotencyKey: (0, reward_issuance_service_1.issueKey)('manual-request', r.id), reasonCode: 'MANUAL_ISSUE', actor: r.requestedBy, now }, tx);
                if (res.status === 'SKIPPED')
                    throw new errors_1.ApiError(422, `MANUAL_ISSUE_${res.reason}`, 'The manual issuance could not be issued', { reason: res.reason });
                lotId = res.lotId;
                await tx.auditLog.create({ data: { actor: actor.sub, action: 'growth.manual_issue.approve', resource: 'RewardApprovalRequest', resourceId: r.id, metadata: { amountMinor: r.amountMinor, lotId } } });
            }
            const closed = await tx.rewardApprovalRequest.updateMany({ where: { id: r.id, status: 'PENDING' }, data: { status: 'APPROVED', decidedBy: actor.sub, decidedAt: now, decisionNote: note?.slice(0, 300), lotId } });
            if (!closed.count)
                throw new errors_1.ApiError(409, 'APPROVAL_ALREADY_DECIDED', 'This request was already decided');
            return { status: 'APPROVED', requestId: r.id, lotId };
        }, { timeout: 20_000 });
    }
    async manualIssue(actor, i) {
        if (!(await this.policy.rewardsOn()))
            throw new errors_1.ApiError(403, 'FEATURE_DISABLED', 'Rewards are switched off', { key: 'growth.rewards', scope: 'global' });
        const now = i.now ?? new Date();
        const { rules } = await this.policy.rewardRules();
        if (!i.reason?.trim() || i.reason.length > 300)
            throw new errors_1.ApiError(422, 'MANUAL_REASON_REQUIRED', 'A reason (up to 300 characters) is required');
        if (!Number.isInteger(i.amountMinor) || i.amountMinor <= 0)
            throw new errors_1.ApiError(422, 'AMOUNT_INVALID', 'amountMinor must be a positive whole number');
        if (await this.phoneRelated(actor, i.sub))
            throw new errors_1.ApiError(422, 'MANUAL_SELF_GRANT', 'A grant to your own or a related account is not allowed');
        const day = startOfDayUtc(now);
        const [a, b] = await Promise.all([
            this.prisma.rewardLot.aggregate({ where: { issuedBy: actor.sub, createdAt: { gte: day }, kind: 'PROMO' }, _sum: { amountMinor: true } }),
            this.prisma.rewardApprovalRequest.aggregate({ where: { kind: 'MANUAL_ISSUE', requestedBy: actor.sub, status: 'PENDING', createdAt: { gte: day } }, _sum: { amountMinor: true } }),
        ]);
        if ((a._sum.amountMinor ?? 0) + (b._sum.amountMinor ?? 0) + i.amountMinor > rules.manualDailyCapPerActorMinor)
            throw new errors_1.ApiError(422, 'MANUAL_DAILY_CAP', 'The daily cap for manual issuance is reached');
        if (i.amountMinor > rules.manualApprovalAboveMinor) {
            const r = await this.prisma.rewardApprovalRequest.create({ data: { kind: 'MANUAL_ISSUE', sub: i.sub, amountMinor: i.amountMinor, reason: i.reason.trim(), bookingId: i.bookingId ?? null, ticketRef: i.ticketRef ?? null, requestedBy: actor.sub } });
            await this.prisma.auditLog.create({ data: { actor: actor.sub, action: 'growth.manual_issue.request', resource: 'RewardApprovalRequest', resourceId: r.id, metadata: { amountMinor: i.amountMinor } } });
            return { status: 'PENDING_APPROVAL', requestId: r.id };
        }
        const res = await this.issuance.issue({ kind: 'PROMO', sub: i.sub, amountMinor: i.amountMinor, funding: 'PLATFORM_MARKETING', idempotencyKey: (0, reward_issuance_service_1.issueKey)('manual', actor.sub, i.sub, now.getTime(), i.amountMinor), reasonCode: 'MANUAL_ISSUE', actor: actor.sub, now });
        if (res.status === 'SKIPPED')
            throw new errors_1.ApiError(422, `MANUAL_ISSUE_${res.reason}`, 'The manual issuance could not be issued', { reason: res.reason });
        await this.prisma.auditLog.create({ data: { actor: actor.sub, action: 'growth.manual_issue', resource: 'RewardLot', resourceId: res.lotId, metadata: { amountMinor: i.amountMinor, reason: i.reason.trim().slice(0, 120) } } });
        return { status: 'ISSUED', lotId: res.lotId };
    }
    pending(take = 100) { return this.prisma.rewardApprovalRequest.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, take, select: { id: true, kind: true, amountMinor: true, reason: true, bookingId: true, ticketRef: true, requestedBy: true, createdAt: true } }); }
};
exports.GoodwillService = GoodwillService;
exports.GoodwillService = GoodwillService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, reward_policy_service_1.RewardPolicyService, reward_issuance_service_1.RewardIssuanceService, reward_events_service_1.RewardEventsService])
], GoodwillService);
//# sourceMappingURL=goodwill.service.js.map