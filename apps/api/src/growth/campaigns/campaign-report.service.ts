import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { growthError } from '../growth-errors';
import { applyKAnonymity, K_MIN, MASK, maskCount, maskTotal, type Masked } from '../analytics/kanon';
import { paidCac, pct, ratio, roas } from '../analytics/formulas';
import { CampaignService } from './campaign.service';
import { addDays, localDay, marketTimezone } from './market-day';

export const FUNNEL = ['PageViewed', 'SearchStarted', 'ResultsViewed', 'ProviderViewed', 'SlotSelected', 'BookingInitiated', 'BookingConfirmed', 'BookingAttended', 'AttendedNewPatient'] as const;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Per-campaign performance (GRW-P2-A). Spend is the APPROVED `GrowthSpendEntry` rows of the campaign; the funnel is `GrowthMetricDaily` rows with the campaign dimension (package J
 * rollup). Every patient-derived count goes through k-anonymity (k >= 10): below it the cell, and every ratio resting on it, is "<10". External platform numbers come only from the
 * read-only adapters (P2-F): with none present the answer is "not connected", never zero.
 */
@Injectable()
export class CampaignReportService {
  constructor(private readonly prisma: PrismaService, private readonly campaigns: CampaignService) {}

  async report(id: string, q: { from?: string; to?: string } = {}, now = new Date()) {
    const c = await this.campaigns.must(id); const zone = marketTimezone(c.market);
    const to = q.to && ISO.test(q.to) ? q.to : localDay(c.endsAt && c.endsAt < now ? c.endsAt : now, zone);
    const from = q.from && ISO.test(q.from) ? q.from : (() => { const start = c.startsAt ? localDay(c.startsAt, zone) : addDays(to, -29); return start < addDays(to, -365) ? addDays(to, -365) : start; })();
    if (from > to) throw growthError('GROWTH_INVALID_REQUEST', 'from must not be after to');
    if (Date.parse(to) - Date.parse(from) > 366 * 86_400_000) throw growthError('GROWTH_INVALID_REQUEST', 'a report covers at most 366 days');
    const range = { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) };

    const spendRows = await this.prisma.growthSpendEntry.findMany({ where: { campaignId: id, status: 'APPROVED', day: range }, select: { day: true, amountMinor: true, source: true }, orderBy: { day: 'asc' } });
    const pending = await this.prisma.growthSpendEntry.aggregate({ where: { campaignId: id, status: 'PENDING', day: range }, _sum: { amountMinor: true } });
    const spendByDay = new Map<string, number>();
    for (const r of spendRows) { const d = r.day.toISOString().slice(0, 10); spendByDay.set(d, (spendByDay.get(d) ?? 0) + r.amountMinor); }
    const spendMinor = spendRows.reduce((s, r) => s + r.amountMinor, 0);

    const where = { market: c.market, campaignId: id, day: range };
    const totals = await this.prisma.growthMetricDaily.groupBy({ by: ['metric'], where, _sum: { value: true } });
    const sum = new Map(totals.map((t) => [t.metric, t._sum.value ?? 0]));
    const n = (m: string) => sum.get(m) ?? 0;
    // funnel stages are different measures, not parts of one total: each is masked on its own (no secondary suppression across stages)
    const funnel = FUNNEL.map((m) => { const count = maskCount(n(m)); return { stage: m as string, count, masked: count === MASK }; });
    const confirmed = n('BookingConfirmed'); const anp = n('AttendedNewPatient'); const views = n('PageViewed');
    const revenueNet = n('RevenueMinor') - n('RevenueReversedMinor');
    const cpa = maskTotal(confirmed, { cpaMinor: spendMinor > 0 && confirmed > 0 ? Math.round(spendMinor / confirmed) : null, conversionPct: pct(confirmed, views) });
    const cacCell = maskTotal(anp, { cacMinor: (() => { const v = paidCac(spendMinor, anp); return v === null ? null : Math.round(v); })() });
    const roasCell = maskTotal(confirmed, { roas: (() => { const v = roas(revenueNet, spendMinor); return v === null ? null : Math.round(v * 100) / 100; })() });

    const byDayRows = await this.prisma.growthMetricDaily.groupBy({ by: ['day', 'metric'], where: { ...where, metric: { in: ['PageViewed', 'BookingConfirmed', 'BookingAttended'] } }, _sum: { value: true } });
    const days = new Map<string, Record<string, number>>();
    for (const r of byDayRows) { const d = r.day.toISOString().slice(0, 10); const e = days.get(d) ?? {}; e[r.metric] = r._sum.value ?? 0; days.set(d, e); }
    const dayKeys = [...new Set([...spendByDay.keys(), ...days.keys()])].sort();
    const maskedViews = applyKAnonymity(dayKeys.map((d) => ({ key: d, count: days.get(d)?.PageViewed ?? 0 })), { totalShown: true });
    const maskedConfirmed = applyKAnonymity(dayKeys.map((d) => ({ key: d, count: days.get(d)?.BookingConfirmed ?? 0 })), { totalShown: true });
    const daily = dayKeys.map((d, i) => ({ day: d, spendMinor: spendByDay.get(d) ?? 0, pageViews: maskedViews[i]!.count as Masked, bookingsConfirmed: maskedConfirmed[i]!.count as Masked }));

    const bySrcRows = await this.prisma.growthMetricDaily.groupBy({ by: ['sourceKind', 'metric'], where: { ...where, metric: { in: ['PageViewed', 'BookingConfirmed'] } }, _sum: { value: true } });
    const srcKeys = [...new Set(bySrcRows.map((r) => r.sourceKind || 'UNKNOWN'))].sort();
    const srcMap = (m: string) => applyKAnonymity(srcKeys.map((k) => ({ key: k, count: bySrcRows.filter((r) => (r.sourceKind || 'UNKNOWN') === k && r.metric === m).reduce((s, r) => s + (r._sum.value ?? 0), 0) })), { totalShown: true });
    const sv = srcMap('PageViewed'); const sb = srcMap('BookingConfirmed');
    const bySource = srcKeys.map((k, i) => ({ sourceKind: k, pageViews: sv[i]!.count as Masked, bookingsConfirmed: sb[i]!.count as Masked }));

    const ext = await this.prisma.growthExternalMetricDaily.groupBy({ by: ['kind', 'metric'], where: { market: c.market, dimensionKey: { in: [c.id, c.utmCampaign] }, day: range }, _sum: { value: true } });
    const external = ext.length
      ? { connected: true as const, kinds: [...new Set(ext.map((e) => e.kind))], metrics: Object.fromEntries(ext.map((e) => [`${e.kind}.${e.metric}`, Number(e._sum.value ?? 0)])) }
      : { connected: false as const, kinds: [] as string[], metrics: {} as Record<string, number> };

    const used = Math.min(spendMinor, c.budgetTotalMinor);
    return {
      campaign: this.campaigns.brief(c), range: { from, to },
      budget: { totalMinor: c.budgetTotalMinor, dailyMinor: c.budgetDailyMinor, approvedSpendMinor: spendMinor, pendingSpendMinor: pending._sum.amountMinor ?? 0, utilisationBp: c.budgetTotalMinor ? Math.floor((used * 10_000) / c.budgetTotalMinor) : 0, currency: c.currency },
      funnel, kpis: { cpa, cac: cacCell, roas: roasCell, kMin: K_MIN, mask: MASK },
      revenue: { netMinor: revenueNet, masked: confirmed > 0 && confirmed < K_MIN, note: 'Kiorex commission revenue net of reversals; rewards, deposits and GBV are not revenue' },
      daily, bySource, external,
      ratios: { spendPerView: ratio(spendMinor, views) === null ? null : Math.round((spendMinor / views) * 100) / 100 },
    };
  }
}
