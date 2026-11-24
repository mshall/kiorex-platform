import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { addDays, localDay, marketTimezone } from '../campaigns/market-day';
import { growthError } from '../growth-errors';
import { INTEGRATION_META, PAID_KINDS, type GrowthIntegrationKind } from '../integrations/port';
import { ExternalMetricsService } from './external-metrics.service';
import { blendedCacWithRewards, cpc, cpm, ctrPct, guardRatio, installToRegistration, mer as merOf, ratio, reconcileSpend, registrationToFirstBooking, roas as roasOf, SPEND_FLOOR_MINOR } from './formulas';
import { K_MIN, MASK, maskCount, type Masked } from './kanon';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const round2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);

/**
 * Advanced acquisition analytics (GRW-P2-F). First-party facts (the rollup, k >= 10) next to external aggregates (read-only adapters). Definitions, so a number cannot be gamed:
 *  - CAC = spend / attended new patients attributed to the campaign; spend is approved manual spend, replaced by the adapter figure when the two disagree by more than 5 percent (the note says so).
 *  - Blended CAC adds the reward cost (redeemed minus reversed, marketing-funded lots) and is always shown beside the one without it.
 *  - ROAS = Kiorex revenue facts in the window / spend, labelled "revenue to date", a finance view; MER = Kiorex revenue / total marketing spend.
 *  - Every ratio hides itself under k < 10 or under the spend floor and prints its denominators. Missing external data is "not connected", never zero.
 * No person-level field is read: only GrowthMetricDaily, GrowthSpendEntry, GrowthExternalMetricDaily and the reward ledger SUM.
 */
@Injectable()
export class ChannelPerformanceService {
  constructor(private readonly prisma: PrismaService, private readonly ext: ExternalMetricsService) {}

  async report(q: { market: string; from?: string; to?: string; includeRevenue: boolean }, now = new Date()) {
    const zone = marketTimezone(q.market); const to = q.to && ISO.test(q.to) ? q.to : localDay(now, zone); const from = q.from && ISO.test(q.from) ? q.from : addDays(to, -29);
    if (from > to) throw growthError('GROWTH_INVALID_REQUEST', 'from must not be after to');
    if (Date.parse(to) - Date.parse(from) > 366 * 86_400_000) throw growthError('GROWTH_INVALID_REQUEST', 'a report covers at most 366 days');
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
    const fpSum = (m: string, f: (r: (typeof fp)[number]) => boolean = () => true) => fp.filter((r) => r.metric === m && f(r)).reduce((s, r) => s + (r._sum.value ?? 0), 0);
    const approvedByKey = new Map<string, number>(); for (const r of spendRows) approvedByKey.set(r.campaign, (approvedByKey.get(r.campaign) ?? 0) + (r._sum.amountMinor ?? 0));
    const totalApproved = [...approvedByKey.values()].reduce((a, b) => a + b, 0);
    const rewardCost = Math.max(0, (rewardRows.find((r) => r.type === 'REDEEM')?._sum.amountMinor ?? 0) - (rewardRows.find((r) => r.type === 'REVERSE')?._sum.amountMinor ?? 0));

    // ── channels (one row per integration)
    const channels = (Object.keys(external) as GrowthIntegrationKind[]).map((kind) => {
      const e = external[kind]; const t = e.totals;
      const spend = t.spend_minor ?? 0; const clicks = t.clicks ?? 0; const imp = t.impressions ?? 0;
      return {
        kind, label: INTEGRATION_META[kind].label, connected: e.connected, synthetic: e.connected && e.synthetic, lastRunAt: e.lastRunAt, paid: PAID_KINDS.includes(kind),
        metrics: e.connected ? { spendMinor: PAID_KINDS.includes(kind) ? spend : null, impressions: t.impressions ?? null, clicks: t.clicks ?? null, conversions: t.conversions ?? null, ctrPct: ctrPct(clicks, imp), cpcMinor: cpc(spend, clicks), cpmMinor: cpm(spend, imp) } : null,
      };
    });

    // ── campaigns
    const paidKeys = new Set<string>(); for (const k of PAID_KINDS) for (const key of Object.keys(external[k].byKey)) paidKeys.add(key);
    for (const c of camps) paidKeys.add(c.utmCampaign);
    const campaigns = [...paidKeys].sort().map((key) => {
      const camp = camps.find((c) => c.utmCampaign === key);
      const extSpend = PAID_KINDS.some((k) => external[k].connected && key in external[k].byKey) ? PAID_KINDS.reduce((s, k) => s + (external[k].byKey[key]?.spend_minor ?? 0), 0) : null;
      const sum = (m: string) => PAID_KINDS.reduce((s, k) => s + (external[k].byKey[key]?.[m] ?? 0), 0);
      const anp = fpSum('AttendedNewPatient', (r) => r.campaign === key); const confirmed = fpSum('BookingConfirmed', (r) => r.campaign === key);
      const approved = approvedByKey.get(key) ?? 0; const rec = reconcileSpend(extSpend, approved);
      const revenue = fpSum('RevenueMinor', (r) => r.campaign === key) - fpSum('RevenueReversedMinor', (r) => r.campaign === key);
      const cac = guardRatio(ratio(rec.usedMinor, anp) === null ? null : Math.round(rec.usedMinor / anp), { people: anp, spendMinor: rec.usedMinor });
      const roasG = guardRatio(q.includeRevenue ? (() => { const v = roasOf(revenue, rec.usedMinor); return v === null ? null : round2(v); })() : null, { people: confirmed, spendMinor: rec.usedMinor });
      return {
        key, campaignId: camp?.id ?? null, name: camp?.name ?? null, status: camp?.status ?? null,
        external: extSpend === null ? null : { spendMinor: extSpend, impressions: sum('impressions'), clicks: sum('clicks'), conversions: sum('conversions'), cpcMinor: cpc(extSpend, sum('clicks')), ctrPct: ctrPct(sum('clicks'), sum('impressions')) },
        synthetic: PAID_KINDS.some((k) => external[k].synthetic && key in external[k].byKey),
        firstParty: { attendedNewPatients: maskCount(anp) as Masked, bookingsConfirmed: maskCount(confirmed) as Masked },
        spend: { approvedMinor: approved, externalMinor: extSpend, usedMinor: rec.usedMinor, source: rec.source, deltaBp: rec.deltaBp, conflict: rec.conflict, note: rec.note },
        cacMinor: cac.hidden ? MASK : cac.value, cacHidden: cac.hidden,
        roas: !q.includeRevenue ? null : roasG.hidden ? MASK : roasG.value, roasHidden: q.includeRevenue ? roasG.hidden : 'FINANCE_ONLY',
        revenueToDateMinor: q.includeRevenue ? (confirmed > 0 && confirmed < K_MIN ? MASK : revenue) : null,
      };
    });

    // ── paid versus organic mix, blended CAC, MER
    const anpAll = fpSum('AttendedNewPatient');
    const mixOf = (kinds: string[]) => fpSum('AttendedNewPatient', (r) => kinds.includes(r.sourceKind));
    const paidAnp = mixOf(['CAMPAIGN']); const organicAnp = mixOf(['ORGANIC_SEARCH', 'DIRECT']); const referralAnp = mixOf(['REFERRAL']); const providerAnp = mixOf(['PROVIDER_LINK', 'PROVIDER_QR', 'WIDGET']);
    const otherAnp = Math.max(0, anpAll - paidAnp - organicAnp - referralAnp - providerAnp);
    const mix = [['PAID', paidAnp], ['ORGANIC', organicAnp], ['REFERRAL', referralAnp], ['PROVIDER', providerAnp], ['OTHER', otherAnp]] as const;
    const totalSpend = Math.max(totalApproved, campaigns.reduce((s, c) => s + c.spend.usedMinor, 0));
    const withoutRewards = guardRatio(ratio(totalSpend, anpAll) === null ? null : Math.round(totalSpend / anpAll), { people: anpAll, spendMinor: totalSpend });
    const bl = blendedCacWithRewards(totalSpend, rewardCost, anpAll);
    const withRewards = guardRatio(bl === null ? null : Math.round(bl), { people: anpAll, spendMinor: totalSpend });
    const revenueAll = fpSum('RevenueMinor') - fpSum('RevenueReversedMinor');
    const merG = guardRatio(q.includeRevenue ? (() => { const v = merOf(revenueAll, totalSpend); return v === null ? null : round2(v); })() : null, { people: fpSum('BookingConfirmed'), spendMinor: totalSpend });

    // ── app funnel and organic search
    const installs = (external.playconsole.totals.installs ?? 0) + (external.appstoreconnect.totals.downloads ?? 0); const storeConnected = external.playconsole.connected || external.appstoreconnect.connected;
    const registered = fpSum('PatientRegistered'); const appInstalledFp = fpSum('AppInstalled');
    const firstBookings = anpAll;
    const funnelPeople = Math.min(registered || 0, installs || 0);
    const appFunnel = {
      storeConnected, installsStore: storeConnected ? installs : null, listingViews: storeConnected ? (external.playconsole.totals.store_listing_views ?? 0) + (external.appstoreconnect.totals.product_page_views ?? 0) : null,
      installsFirstParty: maskCount(appInstalledFp) as Masked, registrations: maskCount(registered) as Masked, firstCompletedBookings: maskCount(firstBookings) as Masked,
      installToRegistrationPct: storeConnected && registered >= K_MIN && funnelPeople >= K_MIN ? installToRegistration(registered, installs) : null,
      registrationToFirstBookingPct: registered >= K_MIN && firstBookings >= K_MIN ? registrationToFirstBooking(firstBookings, registered) : null,
    };
    const organic = Object.entries(external.searchconsole.byKey).sort().map(([template, m]) => ({ template, clicks: m.clicks ?? 0, impressions: m.impressions ?? 0, ctrPct: ctrPct(m.clicks ?? 0, m.impressions ?? 0) }));
    const vitals = ['lcp_p75', 'inp_p75', 'cls_p75'].map((metric) => ({ metric, byTemplate: cruxAvg.filter((r) => r.metric === metric).map((r) => ({ template: r.dimensionKey, value: Math.round(Number(r._avg.value ?? 0)) })) }));

    return {
      market, range: { from, to }, currency: 'EGP', kMin: K_MIN, mask: MASK, spendFloorMinor: SPEND_FLOOR_MINOR,
      definitions: { cac: 'spend / attended new patients; adapter spend replaces approved spend when they differ by more than 5 percent', blendedCac: 'spend plus reward cost, divided by attended new patients', roas: 'Kiorex revenue in the window / spend (revenue to date, not LTV)', mer: 'Kiorex revenue / total marketing spend' },
      channels, campaigns, mix: mix.map(([k, n]) => ({ key: k, count: maskCount(n) as Masked })),
      blended: { spendMinor: totalSpend, rewardCostMinor: rewardCost, attendedNewPatients: maskCount(anpAll) as Masked, cacWithoutRewardsMinor: withoutRewards.hidden ? MASK : withoutRewards.value, cacWithRewardsMinor: withRewards.hidden ? MASK : withRewards.value, hidden: withoutRewards.hidden, merHidden: q.includeRevenue ? merG.hidden : 'FINANCE_ONLY', mer: !q.includeRevenue ? null : merG.hidden ? MASK : merG.value },
      appFunnel, organic, vitals,
      notConnected: channels.filter((c) => !c.connected).map((c) => c.kind),
      gaps: [...(channels.every((c) => !c.connected) ? ['NO_INTEGRATION_CONNECTED'] : []), ...(channels.some((c) => c.synthetic) ? ['SYNTHETIC_DATA_PRESENT'] : []), ...campaigns.filter((c) => c.spend.conflict).map((c) => `SPEND_CONFLICT:${c.key}`)],
    };
  }
}
