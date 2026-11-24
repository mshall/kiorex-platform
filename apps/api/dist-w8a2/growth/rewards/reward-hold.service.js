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
exports.RewardHoldService = void 0;
const common_1 = require("@nestjs/common");
const errors_1 = require("../../common/errors");
const prisma_service_1 = require("../../prisma/prisma.service");
const reward_events_service_1 = require("./reward-events.service");
const reward_ledger_service_1 = require("./reward-ledger.service");
const reward_math_1 = require("./reward-math");
const reward_policy_service_1 = require("./reward-policy.service");
let RewardHoldService = class RewardHoldService {
    prisma;
    ledger;
    policy;
    events;
    constructor(prisma, ledger, policy, events) {
        this.prisma = prisma;
        this.ledger = ledger;
        this.policy = policy;
        this.events = events;
    }
    async hold(lotId, reasonCode, actor) {
        return this.prisma.$transaction(async (tx) => {
            if (!(await tx.rewardLot.findUnique({ where: { id: lotId }, select: { id: true } })))
                throw new errors_1.ApiError(404, 'REWARD_LOT_NOT_FOUND', 'Reward lot not found');
            await this.ledger.lock(tx, [lotId]);
            const { versionId } = await this.policy.rewardRules();
            const b = await this.ledger.balance(tx, lotId);
            if (b.available <= 0)
                return { heldMinor: 0 };
            const last = await tx.rewardLedgerEntry.findFirst({ where: { lotId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true } });
            await this.ledger.append(tx, { lotId, type: 'HOLD', amountMinor: b.available, idempotencyKey: (0, reward_math_1.entryKey)('hold', lotId, last?.id ?? '-', b.available), ruleVersionId: versionId, reasonCode, actor });
            await this.ledger.refreshStatus(tx, lotId);
            const lot = await tx.rewardLot.findUniqueOrThrow({ where: { id: lotId } });
            await this.events.emit(tx, 'RewardHeld', 'RewardLot', lotId, { lotRef: lotId, market: lot.market, mode: lot.mode, amountMinor: b.available, currency: lot.currency, reasonCode, idempotencyKey: (0, reward_math_1.entryKey)('hold', lotId, last?.id ?? '-', b.available), at: new Date().toISOString() }, `${lotId}:${last?.id ?? '-'}`);
            await tx.auditLog.create({ data: { actor, action: 'growth.reward.hold', resource: 'RewardLot', resourceId: lotId, metadata: { reasonCode, amountMinor: b.available } } });
            return { heldMinor: b.available };
        });
    }
    async release(lotId, actor, reasonCode = 'FRAUD_CLEARED') {
        return this.prisma.$transaction(async (tx) => {
            if (!(await tx.rewardLot.findUnique({ where: { id: lotId }, select: { id: true } })))
                throw new errors_1.ApiError(404, 'REWARD_LOT_NOT_FOUND', 'Reward lot not found');
            await this.ledger.lock(tx, [lotId]);
            const { versionId } = await this.policy.rewardRules();
            const b = await this.ledger.balance(tx, lotId);
            if (b.held <= 0)
                return { releasedMinor: 0 };
            const last = await tx.rewardLedgerEntry.findFirst({ where: { lotId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true } });
            await this.ledger.append(tx, { lotId, type: 'RELEASE_HOLD', amountMinor: b.held, idempotencyKey: (0, reward_math_1.entryKey)('release-hold', lotId, last?.id ?? '-', b.held), ruleVersionId: versionId, reasonCode, actor });
            await this.ledger.refreshStatus(tx, lotId);
            await tx.auditLog.create({ data: { actor, action: 'growth.reward.release_hold', resource: 'RewardLot', resourceId: lotId, metadata: { reasonCode, amountMinor: b.held } } });
            return { releasedMinor: b.held };
        });
    }
    async autoRelease(now = new Date()) {
        const { rules } = await this.policy.rewardRules();
        const cutoff = new Date(now.getTime() - rules.holdMaxDays * 86_400_000);
        const lots = await this.prisma.$queryRaw `SELECT l."id" FROM "RewardLot" l WHERE l."status" = 'HELD' AND NOT EXISTS (SELECT 1 FROM "RewardLedgerEntry" e WHERE e."lotId" = l."id" AND e."type" = 'HOLD' AND e."createdAt" > ${cutoff})`;
        let n = 0;
        for (const l of lots) {
            const r = await this.release(l.id, 'system:hold-timeout', 'HOLD_TIMEOUT');
            if (r.releasedMinor > 0)
                n++;
        }
        return n;
    }
};
exports.RewardHoldService = RewardHoldService;
exports.RewardHoldService = RewardHoldService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, reward_ledger_service_1.RewardLedgerService, reward_policy_service_1.RewardPolicyService, reward_events_service_1.RewardEventsService])
], RewardHoldService);
//# sourceMappingURL=reward-hold.service.js.map