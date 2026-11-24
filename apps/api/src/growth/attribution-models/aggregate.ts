import { localDay } from '../campaigns/market-day';
import { type DataDrivenResult, dataDrivenPpm } from './data-driven';
import { apportion, type AttributionModel, creditPath, DEFAULT_MODEL_OPTIONS, type ModelOptions, ONE_MILLION, type PathTouch, UNATTRIBUTED_TOUCH } from './models';
import type { ConvertingPath } from './path-builder';
import { DEFAULT_WINDOWS, type ModelWindows, windowDaysFor } from './windows';

export interface ModelRow { day: string; model: AttributionModel; sourceKind: string; sourceRef: string; campaignId: string; conversionsPpm: number; revenueMinor: number; paths: number; windowDays: number }

/** Weights for one converting path under one model. An empty path is credited to UNATTRIBUTED (so totals reconcile). */
export function weightsOf(model: AttributionModel, path: ConvertingPath, opts: ModelOptions, dd?: DataDrivenResult): { touches: PathTouch[]; ppm: number[] } {
  const touches = path.touches.length ? path.touches : [UNATTRIBUTED_TOUCH(path.at)];
  if (model === 'DATA_DRIVEN') {
    if (!dd || !dd.ok) throw new Error('DATA_DRIVEN needs an ok data-driven result');
    return path.touches.length ? { touches, ppm: dataDrivenPpm(dd, touches.map((t) => t.kind), apportion) } : { touches, ppm: [ONE_MILLION] };
  }
  return { touches, ppm: creditPath(model, touches, path.at, opts) };
}

/**
 * Rolls converting paths up to rows by (conversion day in the market zone, source). `conversionsPpm` and `revenueMinor` of all rows sum to exactly
 * paths.length * ONE_MILLION and to the sum of the facts' revenue: the reconciliation the model comparison page proves.
 */
export function aggregateModel(model: AttributionModel, paths: readonly ConvertingPath[], zone: string, opts: ModelOptions = DEFAULT_MODEL_OPTIONS, windows: ModelWindows = DEFAULT_WINDOWS, dd?: DataDrivenResult): ModelRow[] {
  const out = new Map<string, ModelRow>();
  for (const p of paths) {
    const { touches, ppm } = weightsOf(model, p, opts, dd);
    const rev = apportion(Math.max(0, p.revenueMinor), ppm);
    const day = localDay(p.at, zone); const seen = new Set<string>();
    touches.forEach((t, i) => {
      if (ppm[i]! <= 0) return; // a source a model gives nothing to has no row
      const key = `${day}|${t.kind}|${t.ref}|${t.campaignId}`;
      let r = out.get(key); if (!r) out.set(key, (r = { day, model, sourceKind: t.kind, sourceRef: t.ref, campaignId: t.campaignId, conversionsPpm: 0, revenueMinor: 0, paths: 0, windowDays: windowDaysFor(t.kind, windows) }));
      r.conversionsPpm += ppm[i]!; r.revenueMinor += rev[i]!;
      if (!seen.has(key)) { seen.add(key); r.paths += 1; }
    });
  }
  return [...out.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.sourceKind < b.sourceKind ? -1 : a.sourceKind > b.sourceKind ? 1 : a.sourceRef < b.sourceRef ? -1 : a.sourceRef > b.sourceRef ? 1 : a.campaignId < b.campaignId ? -1 : 1));
}

export const totalsOf = (rows: readonly ModelRow[]) => ({ conversionsPpm: rows.reduce((s, r) => s + r.conversionsPpm, 0), revenueMinor: rows.reduce((s, r) => s + r.revenueMinor, 0) });
