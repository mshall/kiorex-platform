import { ApiError } from '../../common/errors';
import { validateVariants } from './assignment';
import { validateEligibility } from './eligibility';
import { EXPERIMENT_POLICY, metricByKey, type Eligibility, type ExperimentMode, type GuardrailSpec, type VariantSpec } from './experiment.types';
import { sampleSizePerArm } from './stats/power';

export interface ExperimentDraft {
  key: string; name: string; surface: string; hypothesis: string; market: string; variants: VariantSpec[]; allocationBp: number; eligibility: Eligibility; primaryMetric: string;
  guardrails: GuardrailSpec[]; mode: ExperimentMode; alphaBp: number; minSample: number; plannedDays: number; flagKey: string | null; baselineRate: number | null; mdeAbs: number | null;
}
const bad = (m: string) => new ApiError(400, 'EXPERIMENT_INVALID', m);
const str = (v: unknown, max: number, what: string, min = 1): string => { if (typeof v !== 'string' || v.trim().length < min || v.length > max) throw bad(`${what} must be a string of ${min} to ${max} characters`); return v.trim(); };
const int = (v: unknown, lo: number, hi: number, what: string): number => { if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) throw bad(`${what} must be an integer from ${lo} to ${hi}`); return v; };

/** Parses and validates a create or edit body (PURE; surface and flag rules are checked by the service through surfaces.ts). `partial` skips required fields for an edit. */
export function parseDraft(body: unknown, partial = false): Partial<ExperimentDraft> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('Body must be a JSON object');
  const b = body as Record<string, unknown>; const out: Partial<ExperimentDraft> = {};
  const need = (k: string) => { if (!partial && b[k] === undefined) throw bad(`${k} is required`); return b[k] !== undefined; };
  if (need('key')) { const k = str(b.key, 63, 'key', 2); if (!/^[a-z0-9][a-z0-9_-]{1,62}$/.test(k)) throw bad('key must match [a-z0-9][a-z0-9_-]{1,62}'); out.key = k; }
  if (need('name')) out.name = str(b.name, 120, 'name');
  if (need('surface')) out.surface = str(b.surface, 63, 'surface');
  if (need('hypothesis')) out.hypothesis = str(b.hypothesis, 600, 'hypothesis', 10);
  if (b.market !== undefined) { if (typeof b.market !== 'string' || !/^[A-Z]{2}$/.test(b.market)) throw bad('market must be an ISO country code'); out.market = b.market; }
  if (need('variants')) { const e = validateVariants(b.variants, EXPERIMENT_POLICY.maxVariants); if (e) throw bad(e); out.variants = (b.variants as VariantSpec[]).map((v) => ({ key: v.key, weightBp: v.weightBp })); }
  if (b.allocationBp !== undefined) out.allocationBp = int(b.allocationBp, 1, 10000, 'allocationBp');
  if (b.eligibility !== undefined) { const e = validateEligibility(b.eligibility); if (e) throw bad(e); out.eligibility = b.eligibility as Eligibility; }
  if (need('primaryMetric')) { const m = metricByKey(String(b.primaryMetric)); if (!m || m.kind === 'GUARDRAIL') throw bad(`primaryMetric must be one of the first-party funnel metrics`); out.primaryMetric = m.key; }
  if (b.guardrails !== undefined) {
    if (!Array.isArray(b.guardrails) || b.guardrails.length > 6) throw bad('guardrails must be a list of up to 6');
    out.guardrails = b.guardrails.map((g) => {
      const o = g as Record<string, unknown>; const m = metricByKey(String(o?.metric));
      if (!m || m.kind === 'PRIMARY') throw bad('each guardrail needs a guardrail metric');
      if (typeof o.marginAbs !== 'number' || !(o.marginAbs > 0 && o.marginAbs <= 0.2)) throw bad('guardrail marginAbs must be a rate between 0 and 0.2 (absolute, e.g. 0.005)');
      return { metric: m.key, marginAbs: o.marginAbs };
    });
  }
  if (b.mode !== undefined) { if (b.mode !== 'FIXED' && b.mode !== 'SEQUENTIAL') throw bad('mode must be FIXED or SEQUENTIAL'); out.mode = b.mode; }
  if (b.alphaBp !== undefined) out.alphaBp = int(b.alphaBp, 1, 2000, 'alphaBp');
  if (b.minSample !== undefined) out.minSample = int(b.minSample, 1, 100_000_000, 'minSample');
  if (b.plannedDays !== undefined) out.plannedDays = int(b.plannedDays, EXPERIMENT_POLICY.minRunDays, 90, `plannedDays (at least ${EXPERIMENT_POLICY.minRunDays})`);
  if (b.flagKey !== undefined && b.flagKey !== null) out.flagKey = str(b.flagKey, 80, 'flagKey');
  if (b.baselineRate !== undefined) { if (typeof b.baselineRate !== 'number' || !(b.baselineRate > 0 && b.baselineRate < 1)) throw bad('baselineRate must be in (0,1)'); out.baselineRate = b.baselineRate; }
  if (b.mdeAbs !== undefined) { if (typeof b.mdeAbs !== 'number' || !(b.mdeAbs > 0 && b.mdeAbs < 1)) throw bad('mdeAbs must be in (0,1)'); out.mdeAbs = b.mdeAbs; }
  return out;
}

/** Pre-registered sample: from the baseline and the minimum detectable effect when both are given (power.ts), else the supplied or default minSample. */
export function plannedSample(d: Partial<ExperimentDraft>): number {
  if (d.baselineRate && d.mdeAbs) return sampleSizePerArm({ baseline: d.baselineRate, mde: d.mdeAbs, alpha: (d.alphaBp ?? 500) / 10_000 });
  return d.minSample ?? 1000;
}
