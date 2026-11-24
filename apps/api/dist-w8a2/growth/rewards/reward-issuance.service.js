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
exports.issueKey = exports.RewardIssuanceService = exports.SKIP_REASONS = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("../../prisma/generated/client");
const crypto_1 = require("../../common/crypto");
const ids_1 = require("../../common/ids");
const prisma_service_1 = require("../../prisma/prisma.service");
const growth_flags_1 = require("../growth-flags");
const reward_coupon_1 = require("./reward-coupon");
const reward_events_service_1 = require("./reward-events.service");
const reward_ledger_service_1 = require("./reward-ledger.service");
const reward_math_1 = require("./reward-math");
const reward_policy_service_1 = require("./reward-policy.service");
const reward_rules_1 = require("./reward-rules");
exports.SKIP_REASONS = ['REWARDS_OFF', 'ZERO_AMOUNT', 'ANNUAL_CAP', 'CAMPAIGN_CAP', 'BUDGET_EXHAUSTED', 'MAX_OPEN_BALANCE', 'RECOVERABLE_LOSS_BLOCK', 'MAX_ACTIVE_LOTS', 'CURRENCY_MISMATCH', 'QUALIFYING_VISIT_REQUIRED'];
const EXEMPT = new Set(['REFUND_CREDIT', 'RESTORED']);
const NEEDS_VISIT = new Set(['REFERRER', 'REFEREE', 'REPEAT', 'WELCOME', 'CAMPAIGN']);
let RewardIssuanceService = class RewardIssuanceService {
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
    async policySnapshot() {
        const { rules, versionId } = await this.policy.rewardRules();
        return { rules, versionId, rewardsOn: await this.policy.rewardsOn(), mode: await this.policy.issueMode(rules) };
    }
    async issue(i, outer) {
        const run = (fn) => (outer ? fn(outer) : this.prisma.$transaction(fn, { timeout: 30_000, maxWait: 30_000 }));
        const now = i.now ?? new Date();
        if (!Number.isInteger(i.amountMinor) || i.amountMinor < 0)
            throw new RangeError('amountMinor must be a non-negative integer');
        const existing = await (outer ?? this.prisma).rewardLedgerEntry.findUnique({ where: { idempotencyKey: i.idempotencyKey }, include: { lot: true } });
        if (existing)
            return { status: 'EXISTING', lotId: existing.lotId, mode: existing.lot.mode, amountMinor: existing.amountMinor };
        if (i.amountMinor === 0)
            return { status: 'SKIPPED', reason: 'ZERO_AMOUNT' };
        const pol = i.pre ?? (await this.policySnapshot());
        const { rules, versionId } = pol;
        if (!EXEMPT.has(i.kind) && !pol.rewardsOn)
            return { status: 'SKIPPED', reason: 'REWARDS_OFF' };
        if ((i.currency ?? rules.currency) !== rules.currency)
            return { status: 'SKIPPED', reason: 'CURRENCY_MISMATCH' };
        if (NEEDS_VISIT.has(i.kind) && !i.qualifyingBookingId)
            return { status: 'SKIPPED', reason: 'QUALIFYING_VISIT_REQUIRED' };
        const mode = i.mode ?? pol.mode;
        const owner = i.sub;
        return run(async (tx) => {
            await tx.$executeRaw `SELECT pg_advisory_xact_lock(hashtext(${`reward-issue:${owner}`}))`;
            const again = await tx.rewardLedgerEntry.findUnique({ where: { idempotencyKey: i.idempotencyKey }, include: { lot: true } });
            if (again)
                return { status: 'EXISTING', lotId: again.lotId, mode: again.lot.mode, amountMinor: again.amountMinor };
            if (!EXEMPT.has(i.kind)) {
                const blocked = await tx.rewardRecoverableLoss.findFirst({ where: { sub: owner, createdAt: { gt: new Date(now.getTime() - reward_rules_1.RECOVERABLE_LOSS_BLOCK_DAYS * 86_400_000) } } });
                if (blocked)
                    return { status: 'SKIPPED', reason: 'RECOVERABLE_LOSS_BLOCK' };
                const skip = await this.capSkip(tx, rules, i, owner, now);
                if (skip)
                    return { status: 'SKIPPED', reason: skip };
                if (i.funding === 'PLATFORM_MARKETING') {
                    const ceiling = rules.ruleBudgetCeilingMinor;
                    if (ceiling <= 0 || i.amountMinor > ceiling)
                        return { status: 'SKIPPED', reason: 'BUDGET_EXHAUSTED' };
                    const took = await tx.$queryRaw(client_1.Prisma.sql `
            INSERT INTO "RewardIssuanceBudget" ("ruleVersionId","issuedMinor","ceilingMinor","updatedAt") VALUES (${versionId}, ${i.amountMinor}, ${ceiling}, timezone('UTC', now()))
            ON CONFLICT ("ruleVersionId") DO UPDATE SET "issuedMinor" = "RewardIssuanceBudget"."issuedMinor" + ${i.amountMinor}, "updatedAt" = timezone('UTC', now())
            WHERE "RewardIssuanceBudget"."issuedMinor" + ${i.amountMinor} <= "RewardIssuanceBudget"."ceilingMinor" RETURNING "ruleVersionId"`);
                    if (!took.length)
                        return { status: 'SKIPPED', reason: 'BUDGET_EXHAUSTED' };
                }
            }
            const household = await tx.rewardHousehold.findFirst({ where: { ownerSub: owner }, select: { id: true } });
            const expiresAt = i.expiresAt ?? (0, reward_math_1.addMonths)(now, i.kind === 'REFUND_CREDIT' ? rules.credit.refundAsCredit.refundCreditExpiryMonths : rules.expiryMonths);
            const code = mode === 'COUPON' && i.kind !== 'RESTORED' && i.kind !== 'REFUND_CREDIT' ? (0, reward_coupon_1.generateCoupon)() : null;
            const lot = await tx.rewardLot.create({ data: {
                    id: (0, ids_1.newId)('rwl'), market: growth_flags_1.GROWTH_DEFAULT_MARKET, sub: i.sub, ownerSub: owner, householdId: household?.id ?? null, kind: i.kind, mode: i.kind === 'REFUND_CREDIT' || i.kind === 'RESTORED' ? (i.mode ?? 'CREDIT') : mode,
                    currency: rules.currency, amountMinor: i.amountMinor, status: 'ACTIVE', ruleVersionId: versionId, relationshipId: i.relationshipId ?? null, campaignId: i.campaignId ?? null, expiresAt,
                    funding: i.funding, scope: (i.scope ?? {}), qualifyingBookingId: i.qualifyingBookingId ?? null, issuedBy: i.actor, reasonCode: i.reasonCode,
                    couponCodeHash: code ? (0, reward_coupon_1.couponHash)(code) : null, couponCodeSealed: code ? (0, crypto_1.encryptField)(code) : null,
                } });
            await this.ledger.append(tx, { lotId: lot.id, type: 'ISSUE', amountMinor: i.amountMinor, idempotencyKey: i.idempotencyKey, ruleVersionId: versionId, reasonCode: i.reasonCode, actor: i.actor, currency: rules.currency, bookingId: i.bookingId ?? i.qualifyingBookingId ?? null, relationshipId: i.relationshipId ?? null, refundId: i.refundId ?? null });
            await this.events.emit(tx, 'RewardIssued', 'RewardLot', lot.id, { lotRef: lot.id, market: lot.market, mode: lot.mode, amountMinor: lot.amountMinor, currency: lot.currency, reasonCode: i.reasonCode, idempotencyKey: i.idempotencyKey, at: now.toISOString() }, i.idempotencyKey);
            return { status: 'ISSUED', lotId: lot.id, mode: lot.mode, amountMinor: lot.amountMinor };
        });
    }
    async capSkip(tx, rules, i, owner, now) {
        if (i.funding === 'PLATFORM_MARKETING') {
            const yr = await tx.$queryRaw(client_1.Prisma.sql `SELECT COALESCE(SUM(e."amountMinor"),0)::bigint AS s FROM "RewardLedgerEntry" e JOIN "RewardLot" l ON l."id" = e."lotId" WHERE e."type" = 'ISSUE' AND COALESCE(l."ownerSub", l."sub") = ${owner} AND l."funding" = 'PLATFORM_MARKETING' AND l."kind" NOT IN ('RESTORED','REFUND_CREDIT') AND e."createdAt" >= ${(0, reward_math_1.yearStart)(now)}`);
            if (rules.perUserAnnualCapMinor <= 0 || Number(yr[0]?.s ?? 0) + i.amountMinor > rules.perUserAnnualCapMinor)
                return 'ANNUAL_CAP';
            if (i.campaignId) {
                const c = await tx.$queryRaw(client_1.Prisma.sql `SELECT COALESCE(SUM(e."amountMinor"),0)::bigint AS s FROM "RewardLedgerEntry" e JOIN "RewardLot" l ON l."id" = e."lotId" WHERE e."type" = 'ISSUE' AND l."campaignId" = ${i.campaignId}`);
                if (rules.perCampaignCapMinor <= 0 || Number(c[0]?.s ?? 0) + i.amountMinor > rules.perCampaignCapMinor)
                    return 'CAMPAIGN_CAP';
            }
        }
        const open = await tx.$queryRaw(client_1.Prisma.sql `SELECT COALESCE(SUM(b."available" + b."reserved"),0)::bigint AS s, COUNT(*)::bigint AS n FROM "RewardLot" l CROSS JOIN LATERAL reward_lot_balance(l."id") b WHERE COALESCE(l."ownerSub", l."sub") = ${owner} AND l."expiresAt" > ${now} AND l."status" IN ('ACTIVE','HELD') AND (b."available" + b."reserved" + b."held") > 0 AND l."funding" <> 'PATIENT_REFUND'`);
        if (Number(open[0]?.s ?? 0) + i.amountMinor > rules.credit.maxOpenBalanceMinor)
            return 'MAX_OPEN_BALANCE';
        if (Number(open[0]?.n ?? 0) >= reward_rules_1.MAX_ACTIVE_LOTS)
            return 'MAX_ACTIVE_LOTS';
        return null;
    }
};
exports.RewardIssuanceService = RewardIssuanceService;
exports.RewardIssuanceService = RewardIssuanceService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, reward_ledger_service_1.RewardLedgerService, reward_policy_service_1.RewardPolicyService, reward_events_service_1.RewardEventsService])
], RewardIssuanceService);
const issueKey = (...parts) => (0, reward_math_1.entryKey)('issue', ...parts);
exports.issueKey = issueKey;
//# sourceMappingURL=reward-issuance.service.js.map