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
exports.CampaignReportService = exports.FUNNEL = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const growth_errors_1 = require("../growth-errors");
const kanon_1 = require("../analytics/kanon");
const formulas_1 = require("../analytics/formulas");
const campaign_service_1 = require("./campaign.service");
const market_day_1 = require("./market-day");
exports.FUNNEL = ['PageViewed', 'SearchStarted', 'ResultsViewed', 'ProviderViewed', 'SlotSelected', 'BookingInitiated', 'BookingConfirmed', 'BookingAttended', 'AttendedNewPatient'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
let CampaignReportService = class CampaignReportService {
    prisma;
    campaigns;
    constructor(prisma, campaigns) {
        this.prisma = prisma;
        this.campaigns = campaigns;
    }
    async report(id, q = {}, now = new Date(), includeRevenue = true) {
        const c = await this.campaigns.must(id);
        const zone = (0, market_day_1.marketTimezone)(c.market);
        const to = q.to && ISO.test(q.to) ? q.to : (0, market_day_1.localDay)(c.endsAt && c.endsAt < now ? c.endsAt : now, zone);
        const from = q.from && ISO.test(q.from) ? q.from : (() => { const start = c.startsAt ? (0, market_day_1.localDay)(c.startsAt, zone) : (0, market_day_1.addDays)(to, -29); return start < (0, market_day_1.addDays)(to, -365) ? (0, market_day_1.addDays)(to, -365) : start; })();
        if (from > to)
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'from must not be after to');
        if (Date.parse(to) - Date.parse(from) > 366 * 86_400_000)
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'a report covers at most 366 days');
        const range = { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) };
        const spendRows = await this.prisma.growthSpendEntry.findMany({ where: { campaignId: id, status: 'APPROVED', day: range }, select: { day: true, amountMinor: true, source: true }, orderBy: { day: 'asc' } });
        const pending = await this.prisma.growthSpendEntry.aggregate({ where: { campaignId: id, status: 'PENDING', day: range }, _sum: { amountMinor: true } });
        const spendByDay = new Map();
        for (const r of spendRows) {
            const d = r.day.toISOString().slice(0, 10);
            spendByDay.set(d, (spendByDay.get(d) ?? 0) + r.amountMinor);
        }
        const spendMinor = spendRows.reduce((s, r) => s + r.amountMinor, 0);
        const where = { market: c.market, campaignId: id, day: range };
        const totals = await this.prisma.growthMetricDaily.groupBy({ by: ['metric'], where, _sum: { value: true } });
        const sum = new Map(totals.map((t) => [t.metric, t._sum.value ?? 0]));
        const n = (m) => sum.get(m) ?? 0;
        const funnel = exports.FUNNEL.map((m) => { const count = (0, kanon_1.maskCount)(n(m)); return { stage: m, count, masked: count === kanon_1.MASK }; });
        const confirmed = n('BookingConfirmed');
        const anp = n('AttendedNewPatient');
        const views = n('PageViewed');
        const revenueNet = n('RevenueMinor') - n('RevenueReversedMinor');
        const cpa = (0, kanon_1.maskTotal)(confirmed, { cpaMinor: spendMinor > 0 && confirmed > 0 ? Math.round(spendMinor / confirmed) : null, conversionPct: (0, formulas_1.pct)(confirmed, views) });
        const cacCell = (0, kanon_1.maskTotal)(anp, { cacMinor: (() => { const v = (0, formulas_1.paidCac)(spendMinor, anp); return v === null ? null : Math.round(v); })() });
        const roasCell = (0, kanon_1.maskTotal)(confirmed, { roas: !includeRevenue ? null : (() => { const v = (0, formulas_1.roas)(revenueNet, spendMinor); return v === null ? null : Math.round(v * 100) / 100; })() });
        const byDayRows = await this.prisma.growthMetricDaily.groupBy({ by: ['day', 'metric'], where: { ...where, metric: { in: ['PageViewed', 'BookingConfirmed', 'BookingAttended'] } }, _sum: { value: true } });
        const days = new Map();
        for (const r of byDayRows) {
            const d = r.day.toISOString().slice(0, 10);
            const e = days.get(d) ?? {};
            e[r.metric] = r._sum.value ?? 0;
            days.set(d, e);
        }
        const dayKeys = [...new Set([...spendByDay.keys(), ...days.keys()])].sort();
        const maskedViews = (0, kanon_1.applyKAnonymity)(dayKeys.map((d) => ({ key: d, count: days.get(d)?.PageViewed ?? 0 })), { totalShown: true });
        const maskedConfirmed = (0, kanon_1.applyKAnonymity)(dayKeys.map((d) => ({ key: d, count: days.get(d)?.BookingConfirmed ?? 0 })), { totalShown: true });
        const daily = dayKeys.map((d, i) => ({ day: d, spendMinor: spendByDay.get(d) ?? 0, pageViews: maskedViews[i].count, bookingsConfirmed: maskedConfirmed[i].count }));
        const bySrcRows = await this.prisma.growthMetricDaily.groupBy({ by: ['sourceKind', 'metric'], where: { ...where, metric: { in: ['PageViewed', 'BookingConfirmed'] } }, _sum: { value: true } });
        const srcKeys = [...new Set(bySrcRows.map((r) => r.sourceKind || 'UNKNOWN'))].sort();
        const srcMap = (m) => (0, kanon_1.applyKAnonymity)(srcKeys.map((k) => ({ key: k, count: bySrcRows.filter((r) => (r.sourceKind || 'UNKNOWN') === k && r.metric === m).reduce((s, r) => s + (r._sum.value ?? 0), 0) })), { totalShown: true });
        const sv = srcMap('PageViewed');
        const sb = srcMap('BookingConfirmed');
        const bySource = srcKeys.map((k, i) => ({ sourceKind: k, pageViews: sv[i].count, bookingsConfirmed: sb[i].count }));
        const ext = await this.prisma.growthExternalMetricDaily.groupBy({ by: ['kind', 'metric'], where: { market: c.market, dimensionKey: { in: [c.id, c.utmCampaign] }, day: range }, _sum: { value: true } });
        const external = ext.length
            ? { connected: true, kinds: [...new Set(ext.map((e) => e.kind))], metrics: Object.fromEntries(ext.map((e) => [`${e.kind}.${e.metric}`, Number(e._sum.value ?? 0)])) }
            : { connected: false, kinds: [], metrics: {} };
        const used = Math.min(spendMinor, c.budgetTotalMinor);
        return {
            campaign: this.campaigns.brief(c), range: { from, to },
            budget: { totalMinor: c.budgetTotalMinor, dailyMinor: c.budgetDailyMinor, approvedSpendMinor: spendMinor, pendingSpendMinor: pending._sum.amountMinor ?? 0, utilisationBp: c.budgetTotalMinor ? Math.floor((used * 10_000) / c.budgetTotalMinor) : 0, currency: c.currency },
            funnel, kpis: { cpa, cac: cacCell, roas: roasCell, kMin: kanon_1.K_MIN, mask: kanon_1.MASK },
            revenue: includeRevenue ? { netMinor: revenueNet, masked: confirmed > 0 && confirmed < kanon_1.K_MIN, restricted: false, note: 'Kiorex commission revenue net of reversals; rewards, deposits and GBV are not revenue' } : { netMinor: null, masked: false, restricted: true, note: 'Revenue is a finance view' },
            daily, bySource, external,
            ratios: { spendPerView: (0, formulas_1.ratio)(spendMinor, views) === null ? null : Math.round((spendMinor / views) * 100) / 100 },
        };
    }
};
exports.CampaignReportService = CampaignReportService;
exports.CampaignReportService = CampaignReportService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, campaign_service_1.CampaignService])
], CampaignReportService);
//# sourceMappingURL=campaign-report.service.js.map