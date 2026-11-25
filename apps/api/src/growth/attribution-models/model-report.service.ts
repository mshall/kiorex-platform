import { DEFAULT_MARKET } from '../../market/market-core-public';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { applyKAnonymity, K_MIN, MASK, type Masked } from '../analytics/kanon';
import { addDays, localDay, marketTimezone, startOfLocalDay } from '../campaigns/market-day';
import { notFound } from '../../common/errors';
import { growthError } from '../growth-errors';
import { aggregateModel, type ModelRow, totalsOf } from './aggregate';
import { dataDriven, type DataDrivenResult } from './data-driven';
import { liftOf } from './lift';
import { modelsConfigNow, type AttributionModelsConfig } from './model-config';
import { ModelDataService } from './model-data.service';
import { ATTRIBUTION_MODELS, DEFAULT_MODEL, ONE_MILLION, PATH_MODELS, type AttributionModel } from './models';
import { buildPaths, pathHashOf, type ConvertingPath, type NonConvertingPath } from './path-builder';
import { maxWindowDays } from './windows';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;
export interface RollupResult { market: string; from: string; to: string; conversions: number; rows: Record<string, number>; pathSnapshots: number; dataDriven: { status: 'OK' | 'INSUFFICIENT_VOLUME'; conversions90d: number; needed: number; foldedNodes?: string[] } }

/**
 * Computes and reports the reporting attribution models (GRW-P3-B). Reporting only (AD-9): this service reads touches, events, bookings and revenue facts and writes ONLY
 * `GrowthAttributionModelResult` and `GrowthPathSnapshot`. It never reads or writes `GrowthAttributionDecision`, `ATTRIBUTION_POLICY` or any commission table, and a test asserts the
 * decision rows are unchanged after a run. Nothing here stores a person key: rows are (day, model, source) aggregates and hashed orderings of source KINDS.
 */
@Injectable()
export class ModelReportService {
  private readonly log = new Logger('attribution-models');
  constructor(private readonly prisma: PrismaService, private readonly data: ModelDataService) {}

  /** Recomputes the last `days` market days (default 3; late events and corrections land inside it). Idempotent: the range is replaced in one transaction per table. */
  async rollup(i: { market?: string; days?: number; from?: string; to?: string; now?: Date; config?: AttributionModelsConfig } = {}): Promise<RollupResult> {
    const market = i.market ?? DEFAULT_MARKET; const zone = marketTimezone(market); const cfg = i.config ?? modelsConfigNow(); const now = i.now ?? new Date();
    const to = i.to && ISO.test(i.to) ? i.to : localDay(now, zone); const from = i.from && ISO.test(i.from) ? i.from : addDays(to, -(Math.min(Math.max(i.days ?? 3, 1), 120) - 1));
    if (from > to) throw growthError('GROWTH_INVALID_REQUEST', 'from must not be after to');
    const convs = await this.data.conversions(market, from, to);
    const subs = [...new Set(convs.map((c) => c.sub).filter((s): s is string => !!s))];
    const since = new Date(startOfLocalDay(from, zone).getTime() - (maxWindowDays(cfg.windows) + 2) * DAY); const until = new Date(startOfLocalDay(addDays(to, 1), zone).getTime());
    const touches = await this.data.touchesOf(market, subs, since, until);
    const { converting } = buildPaths(touches, convs, zone, cfg.windows);

    const rows: ModelRow[] = [];
    for (const m of PATH_MODELS) rows.push(...aggregateModel(m, converting, zone, cfg.options, cfg.windows));
    const dd = await this.dataDrivenFor(market, now, cfg);
    if (dd.result?.ok) rows.push(...aggregateModel('DATA_DRIVEN', converting, zone, cfg.options, cfg.windows, dd.result));

    // path snapshots: hashed ordered source kinds only, and only paths shared by at least k = 10 conversions (the table CHECK refuses fewer)
    const groups = new Map<string, { day: string; kinds: string[]; n: number }>();
    for (const p of converting) { if (!p.touches.length) continue; const kinds = p.touches.map((t) => t.kind); const day = localDay(p.at, zone); const key = `${day}|${pathHashOf(kinds)}`; const g = groups.get(key); if (g) g.n++; else groups.set(key, { day, kinds, n: 1 }); }
    const snaps = [...groups.entries()].filter(([, g]) => g.n >= K_MIN);
    const range = { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) };
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`attribution-models-rollup:${market}`}))`; // two concurrent recomputes of one market take turns (delete then insert would otherwise collide)
      await tx.growthAttributionModelResult.deleteMany({ where: { market, day: range, model: { in: dd.result?.ok ? [...ATTRIBUTION_MODELS] : [...PATH_MODELS] } } });
      if (rows.length) await tx.growthAttributionModelResult.createMany({ data: rows.map((r) => ({ market, day: new Date(`${r.day}T00:00:00Z`), model: r.model, sourceKind: r.sourceKind, sourceRef: r.sourceRef, campaignId: r.campaignId, conversionsFrac: (r.conversionsPpm / ONE_MILLION).toFixed(6), revenueMinor: BigInt(r.revenueMinor), paths: r.paths, windowDays: r.windowDays })) });
      await tx.growthPathSnapshot.deleteMany({ where: { market, day: range, windowDays: maxWindowDays(cfg.windows) } });
      if (snaps.length) await tx.growthPathSnapshot.createMany({ data: snaps.map(([key, g]) => ({ market, day: new Date(`${g.day}T00:00:00Z`), pathHash: key.split('|')[1]!, pathKinds: g.kinds, length: g.kinds.length, conversions: g.n, k: K_MIN, windowDays: maxWindowDays(cfg.windows) })) });
    }, { timeout: 60_000 });
    const by: Record<string, number> = {}; for (const r of rows) by[r.model] = (by[r.model] ?? 0) + 1;
    return { market, from, to, conversions: converting.length, rows: by, pathSnapshots: snaps.length, dataDriven: dd.status };
  }

  /** 90-day data-driven input. Below the volume gate no touch is read at all. */
  private async dataDrivenFor(market: string, now: Date, cfg: AttributionModelsConfig): Promise<{ result?: DataDrivenResult; status: RollupResult['dataDriven'] }> {
    const zone = marketTimezone(market); const to = localDay(now, zone); const from = addDays(to, -89);
    const convs = await this.data.conversions(market, from, to);
    const needed = cfg.dataDriven.minConversions;
    if (convs.length < needed) return { status: { status: 'INSUFFICIENT_VOLUME', conversions90d: convs.length, needed } };
    const since = new Date(startOfLocalDay(from, zone).getTime() - (maxWindowDays(cfg.windows) + 2) * DAY); const until = new Date(startOfLocalDay(addDays(to, 1), zone).getTime());
    const all: Parameters<typeof buildPaths>[0][number][] = []; await this.data.allTouches(market, since, until, (p) => { for (const t of p) all.push(t); });
    const { converting, nonConverting } = buildPaths(all, convs, zone, cfg.windows);
    const result = dataDriven(converting, nonConverting as NonConvertingPath[], cfg.dataDriven);
    return result.ok ? { result, status: { status: 'OK', conversions90d: convs.length, needed, foldedNodes: result.folded } } : { status: { status: 'INSUFFICIENT_VOLUME', conversions90d: convs.length, needed } };
  }

  /** Model comparison for a range: per model and source kind, with k >= 10 masking, and a per-model total that must equal every other model's total. */
  async compare(q: { market?: string; from?: string; to?: string; now?: Date }) {
    const market = q.market ?? DEFAULT_MARKET; const zone = marketTimezone(market); const to = q.to && ISO.test(q.to) ? q.to : localDay(q.now ?? new Date(), zone); const from = q.from && ISO.test(q.from) ? q.from : addDays(to, -29);
    if (from > to) throw growthError('GROWTH_INVALID_REQUEST', 'from must not be after to');
    if (Date.parse(to) - Date.parse(from) > 366 * DAY) throw growthError('GROWTH_INVALID_REQUEST', 'a report covers at most 366 days');
    const where = { market, day: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } };
    const grouped = await this.prisma.growthAttributionModelResult.groupBy({ by: ['model', 'sourceKind'], where, _sum: { conversionsFrac: true, revenueMinor: true, paths: true } });
    const models = ATTRIBUTION_MODELS.map((model) => {
      const cells = grouped.filter((g) => g.model === model).map((g) => ({ key: g.sourceKind, count: g._sum.paths ?? 0, values: { conversions: Number(g._sum.conversionsFrac ?? 0), revenueMinor: Number(g._sum.revenueMinor ?? 0) } }));
      const total = { conversions: round6(cells.reduce((s, c) => s + c.values.conversions, 0)), revenueMinor: cells.reduce((s, c) => s + c.values.revenueMinor, 0) };
      const masked = applyKAnonymity(cells);
      return { model, available: cells.length > 0, isDefault: model === DEFAULT_MODEL, total, rows: masked.map((m) => ({ sourceKind: m.key, paths: m.count, masked: m.masked, conversions: m.masked ? MASK : (m.values.conversions as Masked), revenueMinor: m.masked ? MASK : (m.values.revenueMinor as Masked) })).sort((a, b) => (typeof b.conversions === 'number' ? b.conversions : -1) - (typeof a.conversions === 'number' ? a.conversions : -1)) };
    });
    const avail = models.filter((m) => m.available && m.model !== 'DATA_DRIVEN');
    const t0 = avail[0]?.total; const reconciled = !!t0 && avail.every((m) => Math.abs(m.total.conversions - t0.conversions) < 1e-4 && m.total.revenueMinor === t0.revenueMinor);
    const dd = await this.dataDrivenStatus(market, q.now ?? new Date());
    return { market, from, to, defaultModel: DEFAULT_MODEL, models, reconciled, dataDriven: dd, note: 'Reporting only: models never change a commission decision (ATTRIBUTION_POLICY stays the money rule). Cells under 10 paths are masked.' };
  }

  async dataDrivenStatus(market: string, now: Date, cfg = modelsConfigNow()) {
    const zone = marketTimezone(market); const to = localDay(now, zone); const from = addDays(to, -89);
    const n = await this.prisma.growthEvent.count({ where: { market, name: 'BookingAttended', props: { path: ['bucket'], equals: 'new' }, occurredAt: { gte: startOfLocalDay(from, zone), lt: startOfLocalDay(addDays(to, 1), zone) } } });
    return n >= cfg.dataDriven.minConversions ? { status: 'OK' as const, conversions90d: n, needed: cfg.dataDriven.minConversions } : { status: 'INSUFFICIENT_VOLUME' as const, message: 'insufficient volume', conversions90d: n, needed: cfg.dataDriven.minConversions };
  }

  /** Most common ordered source-kind paths (hashes of kinds only; rows under k = 10 are never stored). */
  async paths(q: { market?: string; from?: string; to?: string; now?: Date; take?: number }) {
    const market = q.market ?? DEFAULT_MARKET; const zone = marketTimezone(market); const to = q.to && ISO.test(q.to) ? q.to : localDay(q.now ?? new Date(), zone); const from = q.from && ISO.test(q.from) ? q.from : addDays(to, -29);
    const g = await this.prisma.growthPathSnapshot.groupBy({ by: ['pathHash', 'length'], where: { market, day: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } }, _sum: { conversions: true } });
    const kinds = new Map<string, string[]>(); for (const r of await this.prisma.growthPathSnapshot.findMany({ where: { market, pathHash: { in: g.map((x) => x.pathHash) } }, select: { pathHash: true, pathKinds: true }, distinct: ['pathHash'] })) kinds.set(r.pathHash, r.pathKinds);
    const rows = g.map((x) => ({ pathHash: x.pathHash, length: x.length, kinds: kinds.get(x.pathHash) ?? [], conversions: x._sum.conversions ?? 0 })).filter((r) => r.conversions >= K_MIN).sort((a, b) => b.conversions - a.conversions || (a.pathHash < b.pathHash ? -1 : 1)).slice(0, Math.min(q.take ?? 50, 200));
    const lengths = new Map<number, number>(); for (const r of rows) lengths.set(r.length, (lengths.get(r.length) ?? 0) + r.conversions);
    return { market, from, to, k: K_MIN, paths: rows, lengthDistribution: [...lengths].sort((a, b) => a[0] - b[0]).map(([length, conversions]) => ({ length, conversions })) };
  }

  /** "Experiment-based lift": holdout units against exposed units of a P3-A experiment that has a variant keyed `holdout`. */
  async lift(q: { experimentKey: string; market?: string; alpha?: number }) {
    const market = q.market ?? DEFAULT_MARKET;
    const exp = await this.prisma.growthExperiment.findUnique({ where: { market_key: { market, key: q.experimentKey } } });
    if (!exp) throw notFound('EXPERIMENT_NOT_FOUND', 'experiment not found');
    const variants = ((exp.variants as Array<{ key: string }> | null) ?? []).map((v) => v.key);
    if (!variants.includes('holdout')) return { experimentKey: exp.key, available: false as const, reason: 'NO_HOLDOUT_VARIANT', message: 'The experiment has no variant keyed "holdout"; incrementality needs a holdout.' };
    const daily = await this.prisma.growthExperimentDaily.groupBy({ by: ['variant'], where: { experimentId: exp.id }, _sum: { exposures: true, conversions: true } });
    const arm = (keys: (v: string) => boolean) => daily.filter((d) => keys(d.variant)).reduce((a, d) => ({ exposures: a.exposures + (d._sum.exposures ?? 0), conversions: a.conversions + (d._sum.conversions ?? 0) }), { exposures: 0, conversions: 0 });
    const r = liftOf(arm((v) => v === 'holdout'), arm((v) => v !== 'holdout'), q.alpha ?? 0.05);
    return 'suppressed' in r ? { experimentKey: exp.key, available: false as const, reason: r.reason, message: r.reason === 'K_FLOOR' ? 'Fewer than 10 units in an arm: not reported.' : 'No exposures yet.' } : { experimentKey: exp.key, available: true as const, status: exp.status, lift: r };
  }
}
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
export type { ConvertingPath };
