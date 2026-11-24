import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Inject } from '@nestjs/common';
import { SEO_SITE, type SeoSitePort } from './seo-automation-public';
import { DECISION_PREFIX, NOINDEX_MARK, SeoAutomationService } from './seo-automation.service';

/** Search Console groups pages by template group (the adapter never sends a path): our template kinds fold into those groups. */
export const SC_GROUP: Record<string, string> = { doctor: 'doctor', nurse: 'doctor', clinic: 'clinic', pharmacy: 'partner', lab: 'partner', home: 'other' };
export const groupOf = (kind: string): string => SC_GROUP[kind] ?? 'listing';
const dayOf = (d: Date) => new Date(`${d.toISOString().slice(0, 10)}T00:00:00Z`);

/**
 * Indexation per template group (GRW-P3-F). `submitted` is real: the URLs the sitemaps list. `excluded` is real too: the pages our own gate removed from indexing, with the reasons. `indexed` needs the Search
 * Console index-coverage data, which the P2-F adapter does not pull (it pulls clicks and impressions only): until it does, the snapshot says `indexedKnown: false` and the page shows "not measured".
 */
@Injectable()
export class SeoIndexationService {
  constructor(private readonly prisma: PrismaService, @Inject(SEO_SITE) private readonly site: SeoSitePort, private readonly seo: SeoAutomationService) {}

  async snapshot(now = new Date(), market = 'EG') {
    const entries = await this.site.entries(market); const day = dayOf(now);
    const submitted = new Map<string, number>(); for (const e of entries) submitted.set(groupOf(e.type), (submitted.get(groupOf(e.type)) ?? 0) + 2); // both locales
    const rows = await this.seo.latestReports(market);
    const excluded = new Map<string, { n: number; reasons: Record<string, number> }>();
    for (const r of rows) if (r.failedChecks.includes(NOINDEX_MARK)) {
      const g = groupOf(r.templateKind); const x = excluded.get(g) ?? { n: 0, reasons: {} }; x.n++;
      for (const c of r.failedChecks.filter((f) => !f.startsWith(DECISION_PREFIX))) x.reasons[c] = (x.reasons[c] ?? 0) + 1;
      excluded.set(g, x);
    }
    const sc = await this.prisma.growthExternalMetricDaily.findMany({ where: { market, kind: 'searchconsole', metric: 'indexed_pages', day: { gte: new Date(now.getTime() - 7 * 86_400_000) } }, orderBy: { day: 'desc' } });
    const scBy = new Map<string, number>(); for (const r of sc) { const g = r.dimensionKey.replace(/^template:/, ''); if (!scBy.has(g)) scBy.set(g, Math.round(Number(r.value))); }
    const out: { templateKind: string; submitted: number; indexed: number; excluded: number; reasonBuckets: Record<string, unknown> }[] = [];
    for (const [g, n] of [...submitted].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const known = scBy.has(g); const ex = excluded.get(g);
      const row = { templateKind: g, submitted: n, indexed: known ? Math.min(n, scBy.get(g)!) : 0, excluded: Math.min(n, ex?.n ?? 0), reasonBuckets: { ...(ex?.reasons ?? {}), indexedKnown: known } };
      await this.prisma.seoIndexationSnapshot.upsert({ where: { market_day_templateKind: { market, day, templateKind: g } }, create: { market, day, ...row }, update: row });
      out.push(row);
    }
    return out;
  }

  async overview(market = 'EG') {
    const latest = await this.prisma.$queryRaw<{ templateKind: string; submitted: number; indexed: number; excluded: number; reasonBuckets: Record<string, unknown>; day: Date }[]>`
      SELECT DISTINCT ON ("templateKind") "templateKind", "submitted", "indexed", "excluded", "reasonBuckets", "day" FROM "SeoIndexationSnapshot" WHERE "market" = ${market} ORDER BY "templateKind", "day" DESC`;
    return { rows: latest.map((r) => { const known = (r.reasonBuckets as { indexedKnown?: boolean }).indexedKnown === true; const { indexedKnown: _k, ...reasons } = r.reasonBuckets as Record<string, unknown>; return { templateKind: r.templateKind, day: r.day.toISOString().slice(0, 10), submitted: r.submitted, indexed: known ? r.indexed : null, excluded: r.excluded, reasons, indexedKnown: known }; }), note: 'Indexed counts need Search Console index-coverage data; until it is connected they are shown as not measured.' };
  }
}
