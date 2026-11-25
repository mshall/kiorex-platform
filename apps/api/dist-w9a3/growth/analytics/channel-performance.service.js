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
exports.ChannelPerformanceService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const market_day_1 = require("../campaigns/market-day");
const growth_errors_1 = require("../growth-errors");
const port_1 = require("../integrations/port");
const external_metrics_service_1 = require("./external-metrics.service");
const formulas_1 = require("./formulas");
const kanon_1 = require("./kanon");
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const round2 = (n) => (n === null ? null : Math.round(n * 100) / 100);
let ChannelPerformanceService = class ChannelPerformanceService {
    prisma;
    ext;
    constructor(prisma, ext) {
        this.prisma = prisma;
        this.ext = ext;
    }
    async report(q, now = new Date()) {
        const zone = (0, market_day_1.marketTimezone)(q.market);
        const to = q.to && ISO.test(q.to) ? q.to : (0, market_day_1.localDay)(now, zone);
        const from = q.from && ISO.test(q.from) ? q.from : (0, market_day_1.addDays)(to, -29);
        if (from > to)
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'from must not be after to');
        if (Date.parse(to) - Date.parse(from) > 366 * 86_400_000)
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'a report covers at most 366 days');
        const range = { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) };
        const market = q.market;
        const external = await this.ext.load(market, from, to);
        const [fp, spendRows, camps, rewardRows, cruxAvg] = await Promise.all([
            this.prisma.growthMetricDaily.groupBy({ by: ['campaign', 'sourceKind', 'metric'], where: { market, day: range, metric: { in: ['AttendedNewPatient', 'BookingConfirmed', 'PatientRegistered', 'AppInstalled', 'RevenueMinor', 'RevenueReversedMinor'] } }, _sum: { value: true } }),
            this.prisma.growthSpendEntry.groupBy({ by: ['campaign', 'campaignId'], where: { market, status: 'APPROVED', day: range }, _sum: { amountMinor: true } }),
            this.prisma.growthCampaign.findMany({ where: { market, status: { in: ['ACTIVE', 'PAUSED', 'SCHEDULED', 'COMPLETED'] } }, select: { id: true, name: true, utmCampaign: true, status: true }, take: 200 }),
            this.prisma.rewardLedgerEntry.groupBy({ by: ['type'], where: { type: { in: ['REDEEM', 'REVERSE'] }, createdAt: { gte: range.gte, lt: new Date(range.lte.getTime() + 86_400_000) }, lot: { market, funding: 'PLATFORM_MARKETING' } }, _sum: { amountMinor: true } }),
            this.prisma.growthExternalMetricDaily.groupBy({ by: ['metric', 'dimensionKey'], where: { market, kind: 'crux', day: range }, _avg: { value: true } }),
        ]);
        const fpSum = (m, f = () => true) => fp.filter((r) => r.metric === m && f(r)).reduce((s, r) => s + (r._sum.value ?? 0), 0);
        const approvedByKey = new Map();
        for (const r of spendRows)
            approvedByKey.set(r.campaign, (approvedByKey.get(r.campaign) ?? 0) + (r._sum.amountMinor ?? 0));
        const totalApproved = [...approvedByKey.values()].reduce((a, b) => a + b, 0);
        const rewardCost = Math.max(0, (rewardRows.find((r) => r.type === 'REDEEM')?._sum.amountMinor ?? 0) - (rewardRows.find((r) => r.type === 'REVERSE')?._sum.amountMinor ?? 0));
        const channels = Object.keys(external).map((kind) => {
            const e = external[kind];
            const t = e.totals;
            const spend = t.spend_minor ?? 0;
            const clicks = t.clicks ?? 0;
            const imp = t.impressions ?? 0;
            return {
                kind, label: port_1.INTEGRATION_META[kind].label, connected: e.connected, synthetic: e.connected && e.synthetic, lastRunAt: e.lastRunAt, paid: port_1.PAID_KINDS.includes(kind),
                metrics: e.connected ? { spendMinor: port_1.PAID_KINDS.includes(kind) ? spend : null, impressions: t.impressions ?? null, clicks: t.clicks ?? null, conversions: t.conversions ?? null, ctrPct: (0, formulas_1.ctrPct)(clicks, imp), cpcMinor: (0, formulas_1.cpc)(spend, clicks), cpmMinor: (0, formulas_1.cpm)(spend, imp) } : null,
            };
        });
        const paidKeys = new Set();
        for (const k of port_1.PAID_KINDS)
            for (const key of Object.keys(external[k].byKey))
                paidKeys.add(key);
        for (const c of camps)
            paidKeys.add(c.utmCampaign);
        const campaigns = [...paidKeys].sort().map((key) => {
            const camp = camps.find((c) => c.utmCampaign === key);
            const extSpend = port_1.PAID_KINDS.some((k) => external[k].connected && key in external[k].byKey) ? port_1.PAID_KINDS.reduce((s, k) => s + (external[k].byKey[key]?.spend_minor ?? 0), 0) : null;
            const sum = (m) => port_1.PAID_KINDS.reduce((s, k) => s + (external[k].byKey[key]?.[m] ?? 0), 0);
            const anp = fpSum('AttendedNewPatient', (r) => r.campaign === key);
            const confirmed = fpSum('BookingConfirmed', (r) => r.campaign === key);
            const approved = approvedByKey.get(key) ?? 0;
            const rec = (0, formulas_1.reconcileSpend)(extSpend, approved);
            const revenue = fpSum('RevenueMinor', (r) => r.campaign === key) - fpSum('RevenueReversedMinor', (r) => r.campaign === key);
            const cac = (0, formulas_1.guardRatio)((0, formulas_1.ratio)(rec.usedMinor, anp) === null ? null : Math.round(rec.usedMinor / anp), { people: anp, spendMinor: rec.usedMinor });
            const roasG = (0, formulas_1.guardRatio)(q.includeRevenue ? (() => { const v = (0, formulas_1.roas)(revenue, rec.usedMinor); return v === null ? null : round2(v); })() : null, { people: confirmed, spendMinor: rec.usedMinor });
            return {
                key, campaignId: camp?.id ?? null, name: camp?.name ?? null, status: camp?.status ?? null,
                external: extSpend === null ? null : { spendMinor: extSpend, impressions: sum('impressions'), clicks: sum('clicks'), conversions: sum('conversions'), cpcMinor: (0, formulas_1.cpc)(extSpend, sum('clicks')), ctrPct: (0, formulas_1.ctrPct)(sum('clicks'), sum('impressions')) },
                synthetic: port_1.PAID_KINDS.some((k) => external[k].synthetic && key in external[k].byKey),
                firstParty: { attendedNewPatients: (0, kanon_1.maskCount)(anp), bookingsConfirmed: (0, kanon_1.maskCount)(confirmed) },
                spend: { approvedMinor: approved, externalMinor: extSpend, usedMinor: rec.usedMinor, source: rec.source, deltaBp: rec.deltaBp, conflict: rec.conflict, note: rec.note },
                cacMinor: cac.hidden ? kanon_1.MASK : cac.value, cacHidden: cac.hidden,
                roas: !q.includeRevenue ? null : roasG.hidden ? kanon_1.MASK : roasG.value, roasHidden: q.includeRevenue ? roasG.hidden : 'FINANCE_ONLY',
                revenueToDateMinor: q.includeRevenue ? (confirmed > 0 && confirmed < kanon_1.K_MIN ? kanon_1.MASK : revenue) : null,
            };
        });
        const anpAll = fpSum('AttendedNewPatient');
        const mixOf = (kinds) => fpSum('AttendedNewPatient', (r) => kinds.includes(r.sourceKind));
        const paidAnp = mixOf(['CAMPAIGN']);
        const organicAnp = mixOf(['ORGANIC_SEARCH', 'DIRECT']);
        const referralAnp = mixOf(['REFERRAL']);
        const providerAnp = mixOf(['PROVIDER_LINK', 'PROVIDER_QR', 'WIDGET']);
        const otherAnp = Math.max(0, anpAll - paidAnp - organicAnp - referralAnp - providerAnp);
        const mix = [['PAID', paidAnp], ['ORGANIC', organicAnp], ['REFERRAL', referralAnp], ['PROVIDER', providerAnp], ['OTHER', otherAnp]];
        const totalSpend = Math.max(totalApproved, campaigns.reduce((s, c) => s + c.spend.usedMinor, 0));
        const withoutRewards = (0, formulas_1.guardRatio)((0, formulas_1.ratio)(totalSpend, anpAll) === null ? null : Math.round(totalSpend / anpAll), { people: anpAll, spendMinor: totalSpend });
        const bl = (0, formulas_1.blendedCacWithRewards)(totalSpend, rewardCost, anpAll);
        const withRewards = (0, formulas_1.guardRatio)(bl === null ? null : Math.round(bl), { people: anpAll, spendMinor: totalSpend });
        const revenueAll = fpSum('RevenueMinor') - fpSum('RevenueReversedMinor');
        const merG = (0, formulas_1.guardRatio)(q.includeRevenue ? (() => { const v = (0, formulas_1.mer)(revenueAll, totalSpend); return v === null ? null : round2(v); })() : null, { people: fpSum('BookingConfirmed'), spendMinor: totalSpend });
        const installs = (external.playconsole.totals.installs ?? 0) + (external.appstoreconnect.totals.downloads ?? 0);
        const storeConnected = external.playconsole.connected || external.appstoreconnect.connected;
        const registered = fpSum('PatientRegistered');
        const appInstalledFp = fpSum('AppInstalled');
        const firstBookings = anpAll;
        const funnelPeople = Math.min(registered || 0, installs || 0);
        const appFunnel = {
            storeConnected, installsStore: storeConnected ? installs : null, listingViews: storeConnected ? (external.playconsole.totals.store_listing_views ?? 0) + (external.appstoreconnect.totals.product_page_views ?? 0) : null,
            installsFirstParty: (0, kanon_1.maskCount)(appInstalledFp), registrations: (0, kanon_1.maskCount)(registered), firstCompletedBookings: (0, kanon_1.maskCount)(firstBookings),
            installToRegistrationPct: storeConnected && registered >= kanon_1.K_MIN && funnelPeople >= kanon_1.K_MIN ? (0, formulas_1.installToRegistration)(registered, installs) : null,
            registrationToFirstBookingPct: registered >= kanon_1.K_MIN && firstBookings >= kanon_1.K_MIN ? (0, formulas_1.registrationToFirstBooking)(firstBookings, registered) : null,
        };
        const organic = Object.entries(external.searchconsole.byKey).sort().map(([template, m]) => ({ template, clicks: m.clicks ?? 0, impressions: m.impressions ?? 0, ctrPct: (0, formulas_1.ctrPct)(m.clicks ?? 0, m.impressions ?? 0) }));
        const vitals = ['lcp_p75', 'inp_p75', 'cls_p75'].map((metric) => ({ metric, byTemplate: cruxAvg.filter((r) => r.metric === metric).map((r) => ({ template: r.dimensionKey, value: Math.round(Number(r._avg.value ?? 0)) })) }));
        return {
            market, range: { from, to }, currency: 'EGP', kMin: kanon_1.K_MIN, mask: kanon_1.MASK, spendFloorMinor: formulas_1.SPEND_FLOOR_MINOR,
            definitions: { cac: 'spend / attended new patients; adapter spend replaces approved spend when they differ by more than 5 percent', blendedCac: 'spend plus reward cost, divided by attended new patients', roas: 'Kiorex revenue in the window / spend (revenue to date, not LTV)', mer: 'Kiorex revenue / total marketing spend' },
            channels, campaigns, mix: mix.map(([k, n]) => ({ key: k, count: (0, kanon_1.maskCount)(n) })),
            blended: { spendMinor: totalSpend, rewardCostMinor: rewardCost, attendedNewPatients: (0, kanon_1.maskCount)(anpAll), cacWithoutRewardsMinor: withoutRewards.hidden ? kanon_1.MASK : withoutRewards.value, cacWithRewardsMinor: withRewards.hidden ? kanon_1.MASK : withRewards.value, hidden: withoutRewards.hidden, merHidden: q.includeRevenue ? merG.hidden : 'FINANCE_ONLY', mer: !q.includeRevenue ? null : merG.hidden ? kanon_1.MASK : merG.value },
            appFunnel, organic, vitals,
            notConnected: channels.filter((c) => !c.connected).map((c) => c.kind),
            gaps: [...(channels.every((c) => !c.connected) ? ['NO_INTEGRATION_CONNECTED'] : []), ...(channels.some((c) => c.synthetic) ? ['SYNTHETIC_DATA_PRESENT'] : []), ...campaigns.filter((c) => c.spend.conflict).map((c) => `SPEND_CONFLICT:${c.key}`)],
        };
    }
};
exports.ChannelPerformanceService = ChannelPerformanceService;
exports.ChannelPerformanceService = ChannelPerformanceService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, external_metrics_service_1.ExternalMetricsService])
], ChannelPerformanceService);
//# sourceMappingURL=channel-performance.service.js.map