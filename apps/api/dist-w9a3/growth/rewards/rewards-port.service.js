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
exports.RewardsPortService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const reward_events_service_1 = require("./reward-events.service");
const reward_issuance_service_1 = require("./reward-issuance.service");
const reward_policy_service_1 = require("./reward-policy.service");
const reward_redemption_service_1 = require("./reward-redemption.service");
const reward_reversal_service_1 = require("./reward-reversal.service");
let RewardsPortService = class RewardsPortService {
    prisma;
    redemption;
    issuance;
    policy;
    events;
    reversal;
    constructor(prisma, redemption, issuance, policy, events, reversal) {
        this.prisma = prisma;
        this.redemption = redemption;
        this.issuance = issuance;
        this.policy = policy;
        this.events = events;
        this.reversal = reversal;
    }
    reserveForDeposit(i) { return this.redemption.reserveForDeposit(i); }
    releaseForBooking(bookingId, reason) { return this.redemption.releaseForBooking(bookingId, reason); }
    redeemOnCapture(tx, i) { return this.redemption.redeemOnCapture(tx, i); }
    async onRefundCreated(tx, i) {
        const t = tx;
        const none = { restoredMinor: 0, patientRefundRestoredMinor: 0, promoRestoredMinor: 0, postedRestoredMinor: 0, lotIds: [] };
        const optionOffered = i.source !== null && (i.destination === 'CREDIT' || (await this.policy.refundCreditAvailable()));
        if (!optionOffered && i.paymentRewardMinor === 0 && !(await this.policy.rewardsOn()))
            return none;
        if (optionOffered && i.source) {
            const row = await t.refundDestinationChoice.create({ data: { refundId: i.refundId, bookingId: i.bookingId, sub: i.sub, choice: i.destination, source: i.source } });
            await this.events.emit(t, 'RefundDestinationChosen', 'RefundDestinationChoice', row.id, { choiceRef: row.id, market: row.market, refundRef: i.refundId, choice: i.destination, amountMinor: Math.max(1, i.cardRefundMinor), currency: i.currency, source: i.source, chosenAt: row.chosenAt.toISOString() }, row.id);
        }
        const restored = await this.redemption.restoreForRefund(t, i);
        await this.reversal.reverseForBooking(i.bookingId, 'REFUND').catch(() => undefined);
        return restored;
    }
    async issueRefundCredit(i) {
        if (!(await this.policy.refundCreditAvailable()))
            return null;
        const r = await this.issuance.issue({ kind: 'REFUND_CREDIT', sub: i.sub, amountMinor: i.amountMinor, funding: 'PATIENT_REFUND', idempotencyKey: (0, reward_issuance_service_1.issueKey)('refund-credit', i.refundId), reasonCode: 'REFUND_CHOICE', actor: 'system:pay', refundId: i.refundId, bookingId: i.bookingId, mode: 'CREDIT', currency: i.currency });
        return r.status === 'SKIPPED' ? null : { lotId: r.lotId };
    }
    refundCreditAvailable() { return this.policy.refundCreditAvailable(); }
    async postToPayLedger() { return (await this.policy.rewardRules()).rules.postToPayLedger; }
};
exports.RewardsPortService = RewardsPortService;
exports.RewardsPortService = RewardsPortService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, reward_redemption_service_1.RewardRedemptionService, reward_issuance_service_1.RewardIssuanceService, reward_policy_service_1.RewardPolicyService, reward_events_service_1.RewardEventsService, reward_reversal_service_1.RewardReversalService])
], RewardsPortService);
//# sourceMappingURL=rewards-port.service.js.map