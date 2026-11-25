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
exports.CorporateReportService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("../../prisma/generated/client");
const errors_1 = require("../../common/errors");
const prisma_service_1 = require("../../prisma/prisma.service");
const corporate_config_1 = require("./corporate-config");
const corporate_privacy_1 = require("./corporate-privacy");
let CorporateReportService = class CorporateReportService {
    prisma;
    config;
    constructor(prisma, config) {
        this.prisma = prisma;
        this.config = config;
    }
    async report(accountId, now = new Date()) {
        const a = await this.prisma.corporateAccount.findUnique({ where: { id: accountId } });
        if (!a)
            throw (0, errors_1.notFound)('CORPORATE_ACCOUNT_NOT_FOUND', 'Corporate account not found');
        const k = (0, corporate_privacy_1.effectiveK)((await this.config.get(a.market, now)).minAggregateK);
        const [enrolled, active, ways, users, spend, perMonth] = await Promise.all([
            this.prisma.corporateMember.count({ where: { accountId } }),
            this.prisma.corporateMember.count({ where: { accountId, endedAt: null } }),
            this.prisma.corporateMember.groupBy({ by: ['verifiedBy'], where: { accountId }, _count: { _all: true } }),
            this.prisma.$queryRaw(client_1.Prisma.sql `SELECT count(DISTINCT "memberId") AS users, count(DISTINCT "bookingId") AS visits FROM "CorporateBenefitEntry" WHERE "accountId" = ${accountId} AND "type" = 'REDEEM'`),
            this.prisma.$queryRaw(client_1.Prisma.sql `SELECT sum(CASE "type" WHEN 'REDEEM' THEN "amountMinor" WHEN 'REVERSE' THEN -"amountMinor" END) AS s FROM "CorporateBenefitEntry" WHERE "accountId" = ${accountId} AND "type" IN ('REDEEM','REVERSE')`),
            this.prisma.$queryRaw(client_1.Prisma.sql `SELECT to_char("createdAt", 'YYYY-MM') AS m, count(DISTINCT "memberId") AS users, sum(CASE "type" WHEN 'REDEEM' THEN "amountMinor" WHEN 'REVERSE' THEN -"amountMinor" END) AS s FROM "CorporateBenefitEntry" WHERE "accountId" = ${accountId} AND "type" IN ('REDEEM','REVERSE') GROUP BY 1 ORDER BY 1 DESC LIMIT 24`),
        ]);
        const utilisers = Number(users[0]?.users ?? 0n);
        const visits = Number(users[0]?.visits ?? 0n);
        const total = Math.max(0, Number(spend[0]?.s ?? 0n));
        const byWay = (0, corporate_privacy_1.maskBreakdown)({ CODE: ways.find((w) => w.verifiedBy === 'CODE')?._count._all ?? 0, HR_LIST: ways.find((w) => w.verifiedBy === 'HR_LIST')?._count._all ?? 0, DOMAIN_EMAIL: ways.find((w) => w.verifiedBy === 'DOMAIN_EMAIL')?._count._all ?? 0 }, k);
        const out = {
            accountId, k, currency: a.currency,
            enrolment: { enrolled: (0, corporate_privacy_1.maskCount)(enrolled, k), active: (0, corporate_privacy_1.maskCount)(active, k), byVerification: byWay },
            utilisation: { membersWhoUsedBenefit: (0, corporate_privacy_1.maskCount)(utilisers, k), sponsoredVisits: utilisers >= k ? (0, corporate_privacy_1.maskCount)(visits, k) : null, sponsoredValueMinor: (0, corporate_privacy_1.maskTotal)(total, utilisers, k) },
            byMonth: perMonth.map((r) => ({ month: r.m, membersWhoUsedBenefit: (0, corporate_privacy_1.maskCount)(Number(r.users), k), sponsoredValueMinor: (0, corporate_privacy_1.maskTotal)(Math.max(0, Number(r.s ?? 0n)), Number(r.users), k) })),
            suppressed: [],
        };
        const walk = (o, path) => { if (o && typeof o === 'object')
            for (const [key, v] of Object.entries(o)) {
                if (v === null)
                    out.suppressed.push(`${path}${key}`);
                else
                    walk(v, `${path}${key}.`);
            } };
        walk({ enrolment: out.enrolment, utilisation: out.utilisation }, '');
        return out;
    }
    async monthlyStatement(accountId, month) {
        const [y, m] = month.split('-').map(Number);
        const from = new Date(Date.UTC(y, m - 1, 1));
        const to = new Date(Date.UTC(y, m, 1));
        const r = await this.prisma.$queryRaw(client_1.Prisma.sql `SELECT sum(CASE "type" WHEN 'REDEEM' THEN "amountMinor" WHEN 'REVERSE' THEN -"amountMinor" END) AS s, count(*) AS n FROM "CorporateBenefitEntry" WHERE "accountId" = ${accountId} AND "type" IN ('REDEEM','REVERSE') AND "createdAt" >= ${from} AND "createdAt" < ${to}`);
        return { accountId, month, sponsorSpendMinor: Math.max(0, Number(r[0]?.s ?? 0n)), ledgerEntries: Number(r[0]?.n ?? 0n) };
    }
};
exports.CorporateReportService = CorporateReportService;
exports.CorporateReportService = CorporateReportService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, corporate_config_1.CorporateConfigService])
], CorporateReportService);
//# sourceMappingURL=corporate-report.service.js.map