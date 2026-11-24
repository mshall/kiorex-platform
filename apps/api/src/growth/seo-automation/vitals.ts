/**
 * Core Web Vitals parsing and budgets (GRW-P3-F). Lab numbers come from the summary of `apps/web/scripts/lighthouse-audit.mjs` (one row per page, factor and locale); field numbers from
 * the CrUX adapter rows (`lcp_p75`, `inp_p75`, `cls_p75` in hundredths, dimension `template:<name>`). Pure: parsers and a budget comparison, no network, no Lighthouse dependency.
 */
export type VitalMetric = 'lcp_ms' | 'inp_ms' | 'cls' | 'tbt_ms' | 'perf_score';
export const VITAL_METRICS: readonly VitalMetric[] = ['lcp_ms', 'inp_ms', 'cls', 'tbt_ms', 'perf_score'];
export interface VitalPoint { templateKind: string; metric: VitalMetric; p75: number; source: 'LAB' | 'FIELD'; sampleSize: number }
export interface Budgets { lcpMs: number; inpMs: number; cls: number; tbtMs: number; perfScore: number }

/** Lighthouse audit page name to the SEO template kind. */
export const LAB_PAGE_TEMPLATE: Record<string, string> = { home: 'home', 'specialty-hub': 'hub', 'city-hub': 'city-hub', doctor: 'doctor', clinic: 'clinic' };

/** `p75` of a small sample by the nearest-rank method (the lab job runs a few times; with one run the value is that run). */
export function percentile75(values: readonly number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.max(0, Math.ceil(0.75 * v.length) - 1)]!;
}

interface LabRow { factor?: string; locale?: string; page?: string; perf?: number; lcp?: number; cls?: number; tbt?: number; inp?: number }
/** Parse the audit's `summary.json` (an array of rows) into lab points per template. Mobile rows only: the budgets are mobile, and the mobile field is what Egypt uses. Unknown pages and non-finite values are skipped. */
export function parseLighthouseSummary(json: unknown): VitalPoint[] {
  if (!Array.isArray(json)) return [];
  const by = new Map<string, Record<VitalMetric, number[]>>();
  for (const r of json as LabRow[]) {
    if (!r || typeof r !== 'object' || r.factor !== 'mobile') continue;
    const t = LAB_PAGE_TEMPLATE[String(r.page)]; if (!t) continue;
    const cell = by.get(t) ?? { lcp_ms: [], inp_ms: [], cls: [], tbt_ms: [], perf_score: [] };
    for (const [m, v] of [['lcp_ms', r.lcp], ['cls', r.cls], ['tbt_ms', r.tbt], ['inp_ms', r.inp], ['perf_score', r.perf]] as const) if (typeof v === 'number' && Number.isFinite(v)) cell[m].push(v);
    by.set(t, cell);
  }
  const out: VitalPoint[] = [];
  for (const [t, cell] of [...by].sort(([a], [b]) => (a < b ? -1 : 1))) for (const m of VITAL_METRICS) {
    const p = m === 'perf_score' ? (cell[m].length ? Math.min(...cell[m]) : null) : percentile75(cell[m]); // a score is better when high: the WORST sample is reported
    if (p !== null) out.push({ templateKind: t, metric: m, p75: Math.round(p * 1000) / 1000, source: 'LAB', sampleSize: cell[m].length });
  }
  return out;
}

/** CrUX adapter rows (GrowthExternalMetricDaily): `template:<name>`; `cls_p75` is stored in hundredths. The template `all` is kept as kind `all`. */
export function parseCruxRows(rows: { dimensionKey: string; metric: string; value: number }[], sampleSize = 0): VitalPoint[] {
  const out: VitalPoint[] = [];
  for (const r of rows) {
    const t = /^template:([a-z-]+)$/.exec(r.dimensionKey)?.[1]; if (!t || !Number.isFinite(r.value)) continue;
    const m: VitalMetric | null = r.metric === 'lcp_p75' ? 'lcp_ms' : r.metric === 'inp_p75' ? 'inp_ms' : r.metric === 'cls_p75' ? 'cls' : null; if (!m) continue;
    out.push({ templateKind: t, metric: m, p75: m === 'cls' ? Math.round(r.value) / 100 : r.value, source: 'FIELD', sampleSize });
  }
  return out;
}

export interface Breach { templateKind: string; metric: VitalMetric; source: 'LAB' | 'FIELD'; value: number; budget: number }
/** A metric breaches its budget when it is above it (below it for the performance score). */
export function breaches(points: readonly VitalPoint[], b: Budgets): Breach[] {
  const limit: Record<VitalMetric, number> = { lcp_ms: b.lcpMs, inp_ms: b.inpMs, cls: b.cls, tbt_ms: b.tbtMs, perf_score: b.perfScore };
  return points.filter((p) => (p.metric === 'perf_score' ? p.p75 < limit.perf_score : p.p75 > limit[p.metric]) && !(p.source === 'FIELD' && p.metric === 'tbt_ms'))
    .map((p) => ({ templateKind: p.templateKind, metric: p.metric, source: p.source, value: p.p75, budget: limit[p.metric] }));
}
