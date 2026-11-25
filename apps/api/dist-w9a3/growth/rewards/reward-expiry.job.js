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
exports.RewardExpiryJob = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("../../prisma/generated/client");
const config_1 = require("../../common/config");
const outbox_public_1 = require("../../outbox/outbox-public");
const prisma_service_1 = require("../../prisma/prisma.service");
const reward_events_service_1 = require("./reward-events.service");
const reward_hold_service_1 = require("./reward-hold.service");
const reward_ledger_service_1 = require("./reward-ledger.service");
const reward_policy_service_1 = require("./reward-policy.service");
const reward_redemption_service_1 = require("./reward-redemption.service");
let RewardExpiryJob = class RewardExpiryJob {
    prisma;
    ledger;
    policy;
    events;
    outbox;
    redemption;
    holds;
    log = new common_1.Logger('reward-expiry');
    timer;
    constructor(prisma, ledger, policy, events, outbox, redemption, holds) {
        this.prisma = prisma;
        this.ledger = ledger;
        this.policy = policy;
        this.events = events;
        this.outbox = outbox;
        this.redemption = redemption;
        this.holds = holds;
    }
    onModuleInit() {
        if (!(0, config_1.cfg)().jobsEnabled)
            return;
        this.timer = setInterval(() => void this.runOnce().catch((e) => this.log.warn(`reward housekeeping failed: ${e.message}`)), 3600_000);
        this.timer.unref();
    }
    onModuleDestroy() { if (this.timer)
        clearInterval(this.timer); }
    async runOnce(now = new Date()) {
        const { rules, versionId } = await this.policy.rewardRules();
        const out = { expiredLots: 0, expiredMinor: 0, refundCreditRefunds: 0, releasedReservations: 0, releasedHolds: 0, endedMembers: 0 };
        const due = await this.prisma.rewardLot.findMany({ where: { expiresAt: { lte: now }, status: { in: ['ACTIVE', 'HELD'] } }, orderBy: { expiresAt: 'asc' }, take: 500, select: { id: true } });
        for (const { id } of due) {
            await this.prisma.$transaction(async (tx) => {
                await this.ledger.lock(tx, [id]);
                let t = await this.ledger.totals(tx, id);
                const last = await tx.rewardLedgerEntry.findFirst({ where: { lotId: id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true } });
                if (t.held > 0) {
                    await this.ledger.append(tx, { lotId: id, type: 'RELEASE_HOLD', amountMinor: t.held, idempotencyKey: (0, reward_ledger_service_1.expireKey)(id, `${last?.id}:rh`, t.held), ruleVersionId: versionId, reasonCode: 'EXPIRED', actor: 'system:expiry' });
                    t = await this.ledger.totals(tx, id);
                }
                if (t.available > 0) {
                    const lot = await tx.rewardLot.findUniqueOrThrow({ where: { id } });
                    await this.ledger.append(tx, { lotId: id, type: 'EXPIRE', amountMinor: t.available, idempotencyKey: (0, reward_ledger_service_1.expireKey)(id, last?.id ?? '-', t.available), ruleVersionId: versionId, reasonCode: 'EXPIRED', actor: 'system:expiry' });
                    await this.events.emit(tx, 'RewardExpired', 'RewardLot', id, { lotRef: id, market: lot.market, mode: lot.mode, amountMinor: t.available, currency: lot.currency, reasonCode: 'EXPIRED', idempotencyKey: (0, reward_ledger_service_1.expireKey)(id, last?.id ?? '-', t.available), at: now.toISOString() }, `${id}:${t.available}:${last?.id ?? '-'}`);
                    out.expiredLots++;
                    out.expiredMinor += t.available;
                    if (lot.kind === 'REFUND_CREDIT' && rules.credit.refundAsCredit.refundCreditOnExpiry === 'REFUND_TO_ORIGINAL') {
                        await this.outbox.enqueue(tx, { type: 'pay.refund_credit_expired', aggregateType: 'RewardLot', aggregateId: id, payload: { lotId: id, amountMinor: t.available }, dedupeKey: `pay.refund_credit_expired:${id}:${t.available}:${last?.id ?? '-'}` });
                        out.refundCreditRefunds++;
                    }
                }
                await this.ledger.refreshStatus(tx, id);
            });
        }
        out.releasedReservations = await this.releaseStaleReservations(now);
        out.releasedHolds = await this.holds.autoRelease(now);
        out.endedMembers = await this.endLeftMembers(now);
        return out;
    }
    async releaseStaleReservations(now) {
        const cutoff = new Date(now.getTime() - 15 * 60_000);
        const rows = await this.prisma.$queryRaw(client_1.Prisma.sql `
      SELECT DISTINCT e."bookingId" FROM "RewardLedgerEntry" e WHERE e."type" = 'RESERVE' AND e."bookingId" IS NOT NULL AND e."createdAt" < ${cutoff}
        AND NOT EXISTS (SELECT 1 FROM "PaymentIntent" p WHERE p."bookingId" = e."bookingId" AND p."status" IN ('CAPTURED','PARTIALLY_REFUNDED','REFUNDED'))
        AND (EXISTS (SELECT 1 FROM "BookingIntent" b WHERE b."id" = e."bookingId" AND b."status" IN ('CANCELLED','EXPIRED','NO_SHOW','COMPLETED'))
          OR NOT EXISTS (SELECT 1 FROM "PaymentIntent" p2 WHERE p2."bookingId" = e."bookingId" AND p2."status" = 'CREATED'))
      LIMIT 500`);
        let n = 0;
        for (const r of rows)
            n += await this.redemption.releaseForBooking(r.bookingId, 'STALE_RESERVATION');
        return n;
    }
    async endLeftMembers(now) {
        const members = await this.prisma.rewardHouseholdMember.findMany({ where: { endedAt: null, memberSub: { startsWith: 'dep:' } }, take: 1000 });
        let n = 0;
        for (const m of members) {
            const dep = await this.prisma.dependant.findUnique({ where: { id: m.memberSub.slice(4) } });
            if (!dep || dep.deletedAt || (dep.expiresAt && dep.expiresAt <= now)) {
                await this.prisma.rewardHouseholdMember.update({ where: { householdId_memberSub: { householdId: m.householdId, memberSub: m.memberSub } }, data: { endedAt: now } });
                n++;
            }
        }
        return n;
    }
};
exports.RewardExpiryJob = RewardExpiryJob;
exports.RewardExpiryJob = RewardExpiryJob = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, reward_ledger_service_1.RewardLedgerService, reward_policy_service_1.RewardPolicyService, reward_events_service_1.RewardEventsService, outbox_public_1.OutboxService, reward_redemption_service_1.RewardRedemptionService, reward_hold_service_1.RewardHoldService])
], RewardExpiryJob);
//# sourceMappingURL=reward-expiry.job.js.map