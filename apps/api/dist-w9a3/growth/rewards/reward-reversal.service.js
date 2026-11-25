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
exports.RewardReversalService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const reward_events_service_1 = require("./reward-events.service");
const reward_ledger_service_1 = require("./reward-ledger.service");
const reward_math_1 = require("./reward-math");
const reward_policy_service_1 = require("./reward-policy.service");
let RewardReversalService = class RewardReversalService {
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
    async reverseLot(lotId, reasonCode, actor, o = {}, outer) {
        const run = (fn) => (outer ? fn(outer) : this.prisma.$transaction(fn, { timeout: 20_000 }));
        return run(async (tx) => {
            const lot = await tx.rewardLot.findUnique({ where: { id: lotId } });
            if (!lot)
                return { lotId, reversedMinor: 0, recoverableLossMinor: 0, skipped: 'LOT_NOT_FOUND' };
            if (lot.kind === 'REFUND_CREDIT' || lot.kind === 'RESTORED' || lot.funding === 'PATIENT_REFUND')
                return { lotId, reversedMinor: 0, recoverableLossMinor: 0, skipped: 'NEVER_REVERSED_KIND' };
            await this.ledger.lock(tx, [lotId]);
            const { versionId } = await this.policy.rewardRules();
            let t = await this.ledger.totals(tx, lotId);
            if (t.held > 0) {
                await this.ledger.append(tx, { lotId, type: 'RELEASE_HOLD', amountMinor: t.held, idempotencyKey: (0, reward_math_1.entryKey)('release-hold', lotId, 'for-reverse', t.held, t.issued), ruleVersionId: versionId, reasonCode: 'FRAUD_CLEARED', actor });
                t = await this.ledger.totals(tx, lotId);
            }
            const split = (0, reward_math_1.reversalSplit)({ issuedMinor: t.issued, redeemedMinor: t.redeemed });
            let reversed = 0;
            if (t.available > 0) {
                await this.ledger.append(tx, { lotId, type: 'REVERSE', amountMinor: t.available, idempotencyKey: (0, reward_math_1.entryKey)('reverse', lotId, o.bookingId ?? 'manual', t.available), ruleVersionId: versionId, reasonCode, actor, bookingId: o.bookingId ?? null });
                reversed = t.available;
                await this.events.emit(tx, 'RewardReversed', 'RewardLot', lotId, { lotRef: lotId, market: lot.market, mode: lot.mode, amountMinor: reversed, currency: lot.currency, reasonCode, idempotencyKey: (0, reward_math_1.entryKey)('reverse', lotId, o.bookingId ?? 'manual', t.available), at: (o.now ?? new Date()).toISOString() }, `${lotId}:${o.bookingId ?? 'manual'}:${reversed}`);
            }
            let loss = 0;
            if (split.recoverableLossMinor > 0) {
                loss = split.recoverableLossMinor;
                await tx.rewardRecoverableLoss.upsert({ where: { lotId_bookingId: { lotId, bookingId: o.bookingId ?? 'MANUAL' } }, create: { sub: lot.ownerSub ?? lot.sub, lotId, amountMinor: loss, reasonCode, bookingId: o.bookingId ?? 'MANUAL' }, update: {} });
            }
            await this.ledger.refreshStatus(tx, lotId);
            return reversed || loss ? { lotId, reversedMinor: reversed, recoverableLossMinor: loss } : { lotId, reversedMinor: 0, recoverableLossMinor: 0, skipped: 'NOTHING_AVAILABLE' };
        });
    }
    async reverseForBooking(bookingId, reasonCode = 'REFUND', now = new Date()) {
        const { rules } = await this.policy.rewardRules();
        const lots = await this.prisma.rewardLot.findMany({ where: { qualifyingBookingId: bookingId, kind: { notIn: ['REFUND_CREDIT', 'RESTORED'] }, funding: { not: 'PATIENT_REFUND' } } });
        const out = [];
        for (const lot of lots) {
            if (now.getTime() > lot.createdAt.getTime() + rules.reversalWindowDays * 86_400_000)
                continue;
            out.push(await this.reverseLot(lot.id, reasonCode, 'system:reversal', { bookingId, now }));
            if (lot.relationshipId)
                await this.prisma.referralQualificationCheck.create({ data: { relationshipId: lot.relationshipId, checkKey: 'REVERSED_AFTER_REFUND', passed: false, detail: { reasonCode } } }).catch(() => undefined);
        }
        return out;
    }
};
exports.RewardReversalService = RewardReversalService;
exports.RewardReversalService = RewardReversalService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, reward_ledger_service_1.RewardLedgerService, reward_policy_service_1.RewardPolicyService, reward_events_service_1.RewardEventsService])
], RewardReversalService);
//# sourceMappingURL=reward-reversal.service.js.map