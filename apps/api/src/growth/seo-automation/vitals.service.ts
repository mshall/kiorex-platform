import { Injectable } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { OutboxService } from '../../outbox/outbox-public';
import { PrismaService } from '../../prisma/prisma.service';
import { SeoAutomationService } from './seo-automation.service';
import { breaches, parseCruxRows, parseLighthouseSummary, type VitalPoint } from './vitals';

const DAY = 86_400_000;
const dayOf = (d: Date) => new Date(`${d.toISOString().slice(0, 10)}T00:00:00Z`);

/**
 * Core Web Vitals monitoring (GRW-P3-F). LAB: the summary the Lighthouse audit script writes (`apps/web/scripts/lighthouse-audit.mjs`, needs Chrome and the `lighthouse` package: a human installs them, G-11);
 * FIELD: the CrUX adapter rows of P2-F (mock until the real key is set). No number is ever invented: without the audit output the lab side says "not measured".
 * A budget breach raises `SeoVitalBudgetBreached` and shows as a row of the production-indexing readiness checklist (the ops SEO page); it blocks nothing in code.
 */
@Injectable()
export class SeoVitalsService {
  constructor(private readonly prisma: PrismaService, private readonly seo: SeoAutomationService, private readonly outbox: OutboxService) {}

  /** The audit output location: SEO_LIGHTHOUSE_SUMMARY, else the web app's default output folder. */
  summaryPath(): string { return process.env.SEO_LIGHTHOUSE_SUMMARY ?? resolve(join(__dirname, '..', '..', '..', '..', 'web', '.lighthouseci', 'summary.json')); }

  async store(points: VitalPoint[], day: Date, market = 'EG'): Promise<number> {
    for (const p of points) {
      const data = { p75: p.p75, sampleSize: p.sampleSize };
      await this.prisma.seoVitalSnapshot.upsert({ where: { market_templateKind_metric_source_day: { market, templateKind: p.templateKind, metric: p.metric, source: p.source, day } }, create: { market, templateKind: p.templateKind, metric: p.metric, source: p.source, day, ...data }, update: data });
    }
    return points.length;
  }

  /** Lab: ingest the audit summary (a JSON value, or the file on disk). Returns `measured: false` when there is nothing to read. */
  async ingestLab(summary?: unknown, now = new Date(), market = 'EG'): Promise<{ measured: boolean; points: number; reason?: string }> {
    let json = summary;
    if (json === undefined) {
      const f = this.summaryPath();
      if (!existsSync(f)) return { measured: false, points: 0, reason: 'LIGHTHOUSE_OUTPUT_MISSING' };
      try { json = JSON.parse(readFileSync(f, 'utf8')); } catch { return { measured: false, points: 0, reason: 'LIGHTHOUSE_OUTPUT_UNREADABLE' }; }
    }
    const points = parseLighthouseSummary(json);
    if (!points.length) return { measured: false, points: 0, reason: 'NO_MOBILE_ROWS' };
    return { measured: true, points: await this.store(points, dayOf(now), market) };
  }

  /** Field: the CrUX adapter's recent rows (mock mode today). */
  async ingestField(now = new Date(), market = 'EG'): Promise<{ measured: boolean; points: number; reason?: string }> {
    const rows = await this.prisma.growthExternalMetricDaily.findMany({ where: { market, kind: 'crux', day: { gte: new Date(now.getTime() - 7 * DAY) }, dimensionKey: { startsWith: 'template:' } }, select: { dimensionKey: true, metric: true, value: true } });
    if (!rows.length) return { measured: false, points: 0, reason: 'CRUX_NOT_CONNECTED' };
    const by = new Map<string, { dimensionKey: string; metric: string; values: number[] }>();
    for (const r of rows) { const k = `${r.dimensionKey}|${r.metric}`; const c = by.get(k) ?? { dimensionKey: r.dimensionKey, metric: r.metric, values: [] }; c.values.push(Number(r.value)); by.set(k, c); }
    const points = parseCruxRows([...by.values()].map((c) => ({ dimensionKey: c.dimensionKey, metric: c.metric, value: Math.round(c.values.reduce((a, b) => a + b, 0) / c.values.length) })), rows.length);
    return { measured: true, points: await this.store(points, dayOf(now), market) };
  }

  /** Compare the newest snapshot of every template and metric with the budgets; raise one event per breach and day. */
  async check(now = new Date(), market = 'EG') {
    const cfg = await this.seo.config(market);
    const rows = await this.prisma.$queryRaw<{ templateKind: string; metric: string; source: string; p75: number; sampleSize: number; day: Date }[]>`
      SELECT DISTINCT ON ("templateKind", "metric", "source") "templateKind", "metric", "source", "p75", "sampleSize", "day" FROM "SeoVitalSnapshot" WHERE "market" = ${market} ORDER BY "templateKind", "metric", "source", "day" DESC`;
    const points: VitalPoint[] = rows.map((r) => ({ templateKind: r.templateKind, metric: r.metric as VitalPoint['metric'], p75: Number(r.p75), source: r.source as 'LAB' | 'FIELD', sampleSize: r.sampleSize }));
    const found = breaches(points, cfg.vitals);
    for (const b of found) await this.outbox.enqueue(this.prisma, { type: 'SeoVitalBudgetBreached', aggregateType: 'SeoVital', aggregateId: `${b.templateKind}|${b.metric}|${b.source}`, target: 'INTERNAL', payload: { market, ...b, day: now.toISOString().slice(0, 10), targets: cfg.alertTargets }, dedupeKey: `seo-vital|${market}|${b.templateKind}|${b.metric}|${b.source}|${now.toISOString().slice(0, 10)}` }).catch(() => undefined);
    return { breaches: found, measuredLab: points.some((p) => p.source === 'LAB'), measuredField: points.some((p) => p.source === 'FIELD') };
  }

  async overview(now = new Date(), market = 'EG') {
    const cfg = await this.seo.config(market); const since = new Date(now.getTime() - 30 * DAY);
    const rows = await this.prisma.seoVitalSnapshot.findMany({ where: { market, day: { gte: since } }, orderBy: [{ templateKind: 'asc' }, { metric: 'asc' }, { day: 'asc' }] });
    const trend = rows.map((r) => ({ templateKind: r.templateKind, metric: r.metric, source: r.source, day: r.day.toISOString().slice(0, 10), p75: Number(r.p75), sampleSize: r.sampleSize }));
    const latest = new Map<string, (typeof trend)[number]>(); for (const t of trend) latest.set(`${t.templateKind}|${t.metric}|${t.source}`, t);
    const chk = await this.check(now, market);
    return {
      budgets: cfg.vitals, trend, latest: [...latest.values()], breaches: chk.breaches,
      lab: chk.measuredLab ? { measured: true } : { measured: false, note: 'Not measured: the Lighthouse audit has not produced output. A human installs Chrome and the lighthouse package (G-11) and runs the audit script; nothing is estimated.' },
      field: chk.measuredField ? { measured: true, source: 'crux (mock until the real key is set)' } : { measured: false, note: 'Not measured: the CrUX adapter has not pulled rows.' },
      readiness: { productionIndexing: [{ key: 'vitals_measured', ok: chk.measuredLab || chk.measuredField }, { key: 'vitals_within_budget', ok: chk.breaches.length === 0 && (chk.measuredLab || chk.measuredField) }] },
    };
  }
}
