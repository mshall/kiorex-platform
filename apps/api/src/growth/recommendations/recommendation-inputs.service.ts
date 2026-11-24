import { Injectable } from '@nestjs/common';
import { Prisma } from '../../prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RECOMMENDATION_POLICY as P, type CampaignAggregate, type ChannelAggregate, type HoldoutAggregate, type LandingAggregate, type RecommendationInputs, type SeoAggregate } from './recommendation.types';

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
/** SEO page groups. Entity pages (provider, pharmacy, lab and similar profile pages) are ONE neutral group: a recommendation never names a kind of provider. */
export const seoGroupOf = (templateKind: string): string => (['doctor', 'nurse', 'clinic', 'pharmacy', 'lab'].includes(templateKind) ? 'profile' : templateKind);

/**
 * Reads the AGGREGATES the rules need (GRW-P3-E). It touches only rollup, spend, campaign, SEO and lifecycle-decision tables, and the one query that looks at people (the holdout
 * comparison) is a single SQL aggregate that returns counts per journey and group: no person leaves the database. Any cell of 1 to 9 is dropped here (k-anonymity) before the rules see it.
 */
@Injectable()
export class RecommendationInputsService {
  constructor(private readonly prisma: PrismaService) {}

  async collect(market: string, now: Date): Promise<RecommendationInputs> {
    const to = new Date(now.getTime()); const from = new Date(now.getTime() - 28 * DAY);
    const [campaigns, landings, seo, holdouts, ltv] = await Promise.all([this.campaigns(market, from, to, now), this.landings(market, from, to), this.seo(market, now), this.holdouts(market, now), this.ltv(market)]);
    const byChannel = new Map<string, { spend: number; attended: number; n: number }>();
    for (const c of campaigns) { if (c.channel === 'MIXED') continue; const x = byChannel.get(c.channel) ?? { spend: 0, attended: 0, n: 0 }; x.spend += c.spendMinor; x.attended += c.attendedNew; x.n++; byChannel.set(c.channel, x); }
    const small = (n: number) => n > 0 && n < P.k;
    // a channel whose total is a small cell keeps its spend but loses the count and every ratio (the rules need k to use it); a campaign that is a small cell is left out entirely:
    // "no attended patients" must never be confused with "fewer than ten, not shown"
    const channels: ChannelAggregate[] = [...byChannel.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([channel, x]) => ({ channel, campaigns: x.n, spendMinor: x.spend, attendedNew: small(x.attended) ? 0 : x.attended, cacMinor: x.attended >= P.k ? Math.round(x.spend / x.attended) : null, ltvMinor: ltv.get(channel) ?? null }));
    return { market, window: { from: iso(from), to: iso(to) }, channels, campaigns: campaigns.filter((c) => !small(c.attendedNew)), landings, seo, holdouts };
  }

  private async campaigns(market: string, from: Date, to: Date, now: Date): Promise<CampaignAggregate[]> {
    const [spend, att] = await Promise.all([
      this.prisma.growthSpendEntry.groupBy({ by: ['campaignId'], where: { market, status: 'APPROVED', campaignId: { not: null }, day: { gte: from, lte: to } }, _sum: { amountMinor: true } }),
      this.prisma.growthMetricDaily.groupBy({ by: ['campaignId'], where: { market, metric: 'AttendedNewPatient', campaignId: { not: '' }, day: { gte: from, lte: to } }, _sum: { value: true } }),
    ]);
    const ids = [...new Set([...spend.map((s) => s.campaignId!), ...att.map((a) => a.campaignId)])];
    if (!ids.length) return [];
    const rows = await this.prisma.growthCampaign.findMany({ where: { id: { in: ids }, market }, select: { id: true, utmCampaign: true, status: true, channels: true, activatedAt: true } });
    return rows.map((c) => {
      const spendMinor = spend.find((s) => s.campaignId === c.id)?._sum.amountMinor ?? 0; const attendedNew = att.find((a) => a.campaignId === c.id)?._sum.value ?? 0;
      return { campaignId: c.id, label: c.utmCampaign, status: c.status, channel: c.channels.length === 1 ? c.channels[0]! : 'MIXED', activeDays: c.activatedAt ? Math.max(0, Math.floor((now.getTime() - c.activatedAt.getTime()) / DAY)) : 0, spendMinor, attendedNew, cacMinor: attendedNew > 0 ? Math.round(spendMinor / attendedNew) : null };
    });
  }

  private async landings(market: string, from: Date, to: Date): Promise<LandingAggregate[]> {
    const rows = await this.prisma.growthMetricDaily.groupBy({ by: ['landingKind', 'metric'], where: { market, metric: { in: ['PageViewed', 'PatientRegistered'] }, landingKind: { not: '' }, day: { gte: from, lte: to } }, _sum: { value: true } });
    const kinds = [...new Set(rows.map((r) => r.landingKind))].sort();
    return kinds.map((k) => ({ landingKind: k, views: rows.find((r) => r.landingKind === k && r.metric === 'PageViewed')?._sum.value ?? 0, registrations: rows.find((r) => r.landingKind === k && r.metric === 'PatientRegistered')?._sum.value ?? 0 }));
  }

  private async seo(market: string, now: Date): Promise<SeoAggregate[]> {
    const since = new Date(now.getTime() - 30 * DAY);
    const reports = await this.prisma.$queryRaw<Array<{ templateKind: string; locale: string; pages: number; failing: number }>>(Prisma.sql`
      SELECT t."templateKind", t."locale", count(*)::int AS pages, count(*) FILTER (WHERE cardinality(t."failedChecks") > 0)::int AS failing
      FROM (SELECT DISTINCT ON ("pageKey","locale") "pageKey","locale","templateKind","failedChecks" FROM "SeoQualityReport" WHERE "market" = ${market} AND "checkedAt" >= ${since} ORDER BY "pageKey","locale","checkedAt" DESC) t
      GROUP BY 1, 2`);
    const checks = await this.prisma.$queryRaw<Array<{ templateKind: string; locale: string; check: string; n: number }>>(Prisma.sql`
      SELECT t."templateKind", t."locale", c AS "check", count(*)::int AS n
      FROM (SELECT DISTINCT ON ("pageKey","locale") "pageKey","locale","templateKind","failedChecks" FROM "SeoQualityReport" WHERE "market" = ${market} AND "checkedAt" >= ${since} ORDER BY "pageKey","locale","checkedAt" DESC) t, unnest(t."failedChecks") c
      GROUP BY 1, 2, 3`);
    const snaps = await this.prisma.$queryRaw<Array<{ templateKind: string; submitted: number; indexed: number; known: boolean }>>(Prisma.sql`
      SELECT DISTINCT ON ("templateKind") "templateKind", "submitted", "indexed", COALESCE(("reasonBuckets"->>'indexedKnown')::boolean, false) AS known FROM "SeoIndexationSnapshot" WHERE "market" = ${market} ORDER BY "templateKind", "day" DESC`);
    const merged = new Map<string, { pages: number; failing: number; checks: Map<string, number> }>();
    for (const r of reports) { const key = `${seoGroupOf(r.templateKind)}|${r.locale}`; const x = merged.get(key) ?? { pages: 0, failing: 0, checks: new Map() }; x.pages += r.pages; x.failing += r.failing; merged.set(key, x); }
    for (const c of checks) { const x = merged.get(`${seoGroupOf(c.templateKind)}|${c.locale}`); if (x) x.checks.set(c.check, (x.checks.get(c.check) ?? 0) + c.n); }
    const idx = new Map<string, { submitted: number; indexed: number }>();
    for (const s of snaps) if (s.known) { const g = seoGroupOf(s.templateKind); const x = idx.get(g) ?? { submitted: 0, indexed: 0 }; x.submitted += s.submitted; x.indexed += s.indexed; idx.set(g, x); }
    return [...merged.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, x]) => {
      const [templateKind, locale] = key.split('|') as [string, string]; const i = idx.get(templateKind);
      return { templateKind, locale, pages: x.pages, failingPages: x.failing, topFailedChecks: [...x.checks.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 3).map(([c]) => c), submitted: i?.submitted ?? null, indexed: i?.indexed ?? null };
    });
  }

  /** People who were sent vs held out from a MARKETING journey 30 to 90 days ago, and how many of each booked within 30 days of the decision. Counts per journey only. */
  private async holdouts(market: string, now: Date): Promise<HoldoutAggregate[]> {
    const lo = new Date(now.getTime() - 90 * DAY); const hi = new Date(now.getTime() - 30 * DAY);
    const rows = await this.prisma.$queryRaw<Array<{ journey: string; g: string; n: number; booked: number }>>(Prisma.sql`
      WITH d AS (
        SELECT "journeyKey" AS j, "sub", CASE WHEN "decision" = 'SEND' THEN 'S' ELSE 'H' END AS g, min("at") AS at
        FROM "LifecycleMessageDecision" WHERE "market" = ${market} AND "messageClass" = 'MARKETING' AND "at" >= ${lo} AND "at" < ${hi} AND ("decision" = 'SEND' OR "reason" = 'HOLDOUT') GROUP BY 1, 2, 3)
      SELECT j AS journey, g, count(*)::int AS n,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "BookingIntent" b WHERE b."sub" = d."sub" AND b."createdAt" > d.at AND b."createdAt" <= d.at + interval '30 days' AND b."status" <> 'EXPIRED'))::int AS booked
      FROM d GROUP BY 1, 2`);
    const journeys = [...new Set(rows.map((r) => r.journey))].sort();
    const out: HoldoutAggregate[] = [];
    for (const j of journeys) {
      const s = rows.find((r) => r.journey === j && r.g === 'S'); const h = rows.find((r) => r.journey === j && r.g === 'H');
      if (!s || !h || s.n < P.k || h.n < P.k) continue; // k floor on both groups
      out.push({ journey: j, sent: s.n, holdout: h.n, sentBookedBp: Math.round((s.booked * 10_000) / s.n), holdoutBookedBp: Math.round((h.booked * 10_000) / h.n) });
    }
    return out;
  }

  /** LTV estimates per channel from the cohort package (cohortKey `channel:<CHANNEL>`, n >= k, 12 month horizon). Empty until the cohort code writes them. */
  private async ltv(market: string): Promise<Map<string, number>> {
    const rows = await this.prisma.growthLtvEstimate.findMany({ where: { market, cohortKey: { startsWith: 'channel:' }, n: { gte: P.k }, horizonMonths: 12 }, orderBy: { computedAt: 'desc' }, take: 50 });
    const m = new Map<string, number>();
    for (const r of rows) { const ch = r.cohortKey.slice('channel:'.length); if (!m.has(ch)) m.set(ch, Number(r.estimateMinor)); }
    return m;
  }
}
