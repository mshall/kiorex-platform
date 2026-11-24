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
exports.RewardFinanceService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("../../prisma/generated/client");
const errors_1 = require("../../common/errors");
const prisma_service_1 = require("../../prisma/prisma.service");
let RewardFinanceService = class RewardFinanceService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async report(month, now = new Date()) {
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
            throw new errors_1.ApiError(400, 'GROWTH_INVALID_REQUEST', 'month must be YYYY-MM');
        const from = new Date(`${month}-01T00:00:00Z`);
        const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
        const rows = await this.prisma.$queryRaw(client_1.Prisma.sql `
      SELECT l."market", l."currency", l."kind", l."funding", l."ruleVersionId", l."campaignId",
        COALESCE(SUM(CASE WHEN e."type" = 'ISSUE' THEN e."amountMinor" END),0)::bigint AS issued, COALESCE(SUM(CASE WHEN e."type" = 'REDEEM' THEN e."amountMinor" END),0)::bigint AS redeemed,
        COALESCE(SUM(CASE WHEN e."type" = 'REVERSE' THEN e."amountMinor" END),0)::bigint AS reversed, COALESCE(SUM(CASE WHEN e."type" = 'EXPIRE' THEN e."amountMinor" END),0)::bigint AS expired
      FROM "RewardLedgerEntry" e JOIN "RewardLot" l ON l."id" = e."lotId" WHERE e."createdAt" >= ${from} AND e."createdAt" < ${to}
      GROUP BY 1,2,3,4,5,6 ORDER BY 1,2,3,4,5`);
        const out = rows.map((r) => ({ market: r.market, currency: r.currency, kind: r.kind, funding: r.funding, ruleVersionId: r.ruleVersionId, campaignId: r.campaignId, issuedMinor: Number(r.issued), redeemedMinor: Number(r.redeemed), reversedMinor: Number(r.reversed), expiredMinor: Number(r.expired) }));
        const sum = (k) => out.reduce((s, r) => s + r[k], 0);
        const open = await this.prisma.$queryRaw(client_1.Prisma.sql `
      SELECT l."market", l."currency", l."funding", SUM(b."available" + b."held" + b."reserved")::bigint AS s
      FROM "RewardLot" l CROSS JOIN LATERAL reward_lot_balance(l."id") b WHERE l."expiresAt" > ${now} AND (b."available" + b."held" + b."reserved") > 0 GROUP BY 1,2,3`);
        const keys = new Map();
        for (const r of open) {
            const k = `${r.market}/${r.currency}`;
            const cur = keys.get(k) ?? { market: r.market, currency: r.currency, platformFundedMinor: 0, serviceRecoveryMinor: 0, refundCreditLiabilityMinor: 0, totalMinor: 0 };
            const v = Number(r.s);
            if (r.funding === 'PATIENT_REFUND')
                cur.refundCreditLiabilityMinor += v;
            else if (r.funding === 'PLATFORM_SERVICE_RECOVERY')
                cur.serviceRecoveryMinor += v;
            else
                cur.platformFundedMinor += v;
            cur.totalMinor += v;
            keys.set(k, cur);
        }
        const loss = await this.prisma.rewardRecoverableLoss.aggregate({ where: { createdAt: { gte: from, lt: to } }, _sum: { amountMinor: true } });
        return {
            month, rows: out, totals: { issuedMinor: sum('issuedMinor'), redeemedMinor: sum('redeemedMinor'), reversedMinor: sum('reversedMinor'), expiredMinor: sum('expiredMinor') }, outstanding: [...keys.values()],
            recoverableLossMinor: loss._sum.amountMinor ?? 0, kiorexRevenueEffectMinor: 0,
            note: 'Facts only. Outstanding is a liability proxy of unexpired lots; refund credit is the patient\'s own money and is never revenue. The accounting treatment is NEEDS_HUMAN (finance and counsel, H-23).',
        };
    }
    csv(r) {
        const esc = (v) => { const s = String(v ?? ''); return /^[=+\-@\t\r]/.test(s) ? `'${s}` : /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
        const head = ['month', 'market', 'currency', 'kind', 'funding', 'ruleVersionId', 'campaignId', 'issuedMinor', 'redeemedMinor', 'reversedMinor', 'expiredMinor'];
        return '﻿' + [head.join(','), ...r.rows.map((x) => [r.month, x.market, x.currency, x.kind, x.funding, x.ruleVersionId, x.campaignId ?? '', x.issuedMinor, x.redeemedMinor, x.reversedMinor, x.expiredMinor].map(esc).join(','))].join('\n') + '\n';
    }
};
exports.RewardFinanceService = RewardFinanceService;
exports.RewardFinanceService = RewardFinanceService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], RewardFinanceService);
//# sourceMappingURL=reward-finance.service.js.map