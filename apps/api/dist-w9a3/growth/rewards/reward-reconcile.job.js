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
exports.RewardReconcileJob = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("../../prisma/generated/client");
const config_1 = require("../../common/config");
const prisma_service_1 = require("../../prisma/prisma.service");
const checkout_lines_1 = require("./checkout-lines");
const growth_flags_1 = require("../growth-flags");
let RewardReconcileJob = class RewardReconcileJob {
    prisma;
    log = new common_1.Logger('reward-reconcile');
    timer;
    constructor(prisma) {
        this.prisma = prisma;
    }
    onModuleInit() {
        if (!(0, config_1.cfg)().jobsEnabled)
            return;
        this.timer = setInterval(() => { if (new Date().getUTCHours() === 3)
            void this.run().catch((e) => this.log.warn(`reward reconcile failed: ${e.message}`)); }, 3600_000);
        this.timer.unref();
    }
    onModuleDestroy() { if (this.timer)
        clearInterval(this.timer); }
    async check(id, name, q) {
        const rows = await this.prisma.$queryRaw(q);
        return { id, name, ok: rows.length === 0, count: rows.length, sample: rows.slice(0, 10).map((r) => r.ref) };
    }
    async run(now = new Date()) {
        const checks = [];
        checks.push(await this.check('RC-1', 'lot balances never negative', client_1.Prisma.sql `SELECT l."id" AS ref FROM "RewardLot" l CROSS JOIN LATERAL reward_lot_balance(l."id") b WHERE b."available" < 0 OR b."held" < 0 OR b."reserved" < 0`));
        checks.push(await this.check('RC-2', 'lot balances equal ledger totals per market and currency', client_1.Prisma.sql `
      WITH a AS (SELECT l."market", l."currency", SUM(b."available" + b."held" + b."reserved")::bigint AS bal FROM "RewardLot" l CROSS JOIN LATERAL reward_lot_balance(l."id") b GROUP BY 1, 2),
           z AS (SELECT l."market", l."currency", SUM(CASE e."type" WHEN 'ISSUE' THEN e."amountMinor" WHEN 'REDEEM' THEN -e."amountMinor" WHEN 'REVERSE' THEN -e."amountMinor" WHEN 'EXPIRE' THEN -e."amountMinor" ELSE 0 END)::bigint AS bal
                 FROM "RewardLedgerEntry" e JOIN "RewardLot" l ON l."id" = e."lotId" GROUP BY 1, 2)
      SELECT COALESCE(a."market", z."market") || '/' || COALESCE(a."currency", z."currency") AS ref FROM a FULL JOIN z ON a."market" = z."market" AND a."currency" = z."currency" WHERE COALESCE(a.bal, 0) <> COALESCE(z.bal, 0)`));
        const redeemed = await this.prisma.$queryRaw(client_1.Prisma.sql `SELECT "bookingId", SUM("amountMinor")::bigint AS redeemed FROM "RewardLedgerEntry" WHERE "type" = 'REDEEM' AND "bookingId" IS NOT NULL GROUP BY "bookingId"`);
        const bad = [];
        for (const r of redeemed) {
            const snap = await this.prisma.rewardCheckoutLine.findFirst({ where: { bookingId: r.bookingId }, orderBy: { createdAt: 'desc' } });
            const lines = (snap?.lines ?? []);
            const credit = -(lines.find((l) => l.code === 'PATIENT_CREDIT')?.amountMinor ?? 0);
            if (!snap || !(0, checkout_lines_1.linesBalance)(lines) || credit !== Number(r.redeemed))
                bad.push(r.bookingId);
        }
        const snaps = await this.prisma.rewardCheckoutLine.findMany({ select: { id: true, lines: true }, take: 5000 });
        for (const s of snaps)
            if (!(0, checkout_lines_1.linesBalance)(s.lines))
                bad.push(`snapshot:${s.id}`);
        checks.push({ id: 'RC-3', name: 'checkout lines add up and match the credit redeemed', ok: bad.length === 0, count: bad.length, sample: bad.slice(0, 10) });
        checks.push(await this.check('RC-4', 'refund allocation: restored credit within credit paid, exact on a full refund', client_1.Prisma.sql `
      SELECT p."id" AS ref FROM "PaymentIntent" p LEFT JOIN LATERAL (SELECT COALESCE(SUM("amountMinor"),0)::bigint AS s FROM "RewardLot" WHERE "kind" = 'RESTORED' AND "reasonCode" LIKE 'RESTORED:' || p."id" || '%') r ON true
      WHERE p."rewardMinor" > 0 AND (r.s > p."rewardMinor" OR (p."status" = 'REFUNDED' AND r.s <> p."rewardMinor"))`));
        checks.push(await this.check('RC-5', 'separate ledgers: no provider-wallet reference, no mixed currency', client_1.Prisma.sql `
      SELECT e."id" AS ref FROM "RewardLedgerEntry" e JOIN "RewardLot" l ON l."id" = e."lotId"
      WHERE e."currency" <> l."currency" OR e."actor" ~* '^(tenant|clinic|org|wallet):' OR e."reasonCode" ~* '^(CR_|WALLET|PROVIDER_CREDIT)' OR e."idempotencyKey" ~* 'tenant|wallet'`));
        checks.push(await this.check('RC-6', 'refund credit issued equals credited refunds', client_1.Prisma.sql `
      SELECT 'total' AS ref WHERE (SELECT COALESCE(SUM(e."amountMinor"),0) FROM "RewardLedgerEntry" e JOIN "RewardLot" l ON l."id" = e."lotId" WHERE e."type" = 'ISSUE' AND l."kind" = 'REFUND_CREDIT')
        <> (SELECT COALESCE(SUM(r."amountMinor"),0) FROM "Refund" r JOIN "RefundDestinationChoice" c ON c."refundId" = r."id" WHERE c."choice" = 'CREDIT' AND r."status" = 'CREDITED')`));
        checks.push(await this.check('RC-7', 'no payment creates value', client_1.Prisma.sql `
      SELECT e."id" AS ref FROM "RewardLedgerEntry" e JOIN "RewardLot" l ON l."id" = e."lotId" WHERE e."type" = 'ISSUE' AND (e."payLinkId" IS NOT NULL OR (l."kind" = 'REFUND_CREDIT' AND e."refundId" IS NULL) OR e."reasonCode" ILIKE '%TOPUP%' OR e."reasonCode" ILIKE '%LOAD%')`));
        const ok = checks.every((c) => c.ok);
        let caseRef = null;
        if (!ok) {
            const a = await this.prisma.auditLog.create({ data: { actor: 'system:reward-reconcile', action: 'growth.reward_reconcile_failed', resource: 'RewardReconcileRun', metadata: { failed: checks.filter((c) => !c.ok).map((c) => ({ id: c.id, count: c.count })) } } });
            caseRef = a.id;
            this.log.error(`reward reconcile failed: ${checks.filter((c) => !c.ok).map((c) => c.id).join(', ')} (case ${a.id})`);
        }
        await this.prisma.rewardReconcileRun.create({ data: { market: growth_flags_1.GROWTH_DEFAULT_MARKET, ranAt: now, results: checks, ok, caseRef } });
        return { ok, checks, ranAt: now.toISOString() };
    }
    latest(take = 30) { return this.prisma.rewardReconcileRun.findMany({ orderBy: { ranAt: 'desc' }, take }); }
};
exports.RewardReconcileJob = RewardReconcileJob;
exports.RewardReconcileJob = RewardReconcileJob = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], RewardReconcileJob);
//# sourceMappingURL=reward-reconcile.job.js.map