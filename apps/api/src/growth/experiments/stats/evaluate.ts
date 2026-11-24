import type { GuardrailSpec, Verdict, VariantSpec } from '../experiment.types';
import { EXPERIMENT_POLICY } from '../experiment.types';
import { holm, twoProportion } from './fixed-horizon';
import { evaluateGuardrail, type GuardrailVerdict } from './guardrails';
import { msprtSeries } from './msprt';
import { srm, type SrmResult } from './srm';

/** One day of cumulative-able counts per variant. `conversions` is the primary metric; `guardrails[metric]` the guardrail events of the same exposed units. */
export interface DayRow { day: string; variant: string; exposures: number; conversions: number; guardrails: Record<string, number> }
export interface EvalInput {
  variants: readonly VariantSpec[]; allocationBp: number; mode: 'FIXED' | 'SEQUENTIAL'; alphaBp: number; minSample: number; plannedDays: number;
  guardrails: readonly GuardrailSpec[]; startedAt: Date; now: Date; rows: readonly DayRow[];
  minRunDays?: number; srmAlpha?: number; guardrailMinEvents?: number;
}
export interface ArmResult { variant: string; n: number; x: number; rate: number }
export interface TreatmentResult { variant: string; diff: number; relativeLift: number | null; ci: { low: number; high: number }; pValue: number; pAdjusted: number; pAlwaysValid: number | null; significant: boolean; direction: 'UP' | 'DOWN' | 'FLAT' }
export interface EvalResult {
  verdict: Verdict; dayNumber: number; srm: SrmResult; arms: ArmResult[]; treatments: TreatmentResult[]; guardrails: GuardrailVerdict[];
  winner: string | null; hidden: boolean; blockers: string[]; stopReason?: 'SRM' | 'GUARDRAIL' | 'END_DATE_INSUFFICIENT_SAMPLE';
}

const daysBetween = (a: Date, b: Date) => Math.floor((b.getTime() - a.getTime()) / 86_400_000);

/**
 * PURE evaluation of one experiment at `now`. Order of precedence: SRM (results hidden), guardrail breach (stop), blockers (minimum days, minimum sample), then the primary metric.
 * No winner is ever named while SRM, the minimum days or the minimum sample is unmet. A winner needs a significant POSITIVE effect on the primary metric after Holm (FIXED) or
 * alpha/k always-valid (SEQUENTIAL) correction.
 */
export function evaluateExperiment(i: EvalInput): EvalResult {
  const minDays = i.minRunDays ?? EXPERIMENT_POLICY.minRunDays; const alpha = i.alphaBp / 10_000;
  const dayNumber = Math.max(0, daysBetween(i.startedAt, i.now) + 1);
  const control = i.variants[0]!.key;
  const total = (v: string, f: (r: DayRow) => number) => i.rows.filter((r) => r.variant === v).reduce((a, r) => a + f(r), 0);
  const arms: ArmResult[] = i.variants.map((v) => { const n = total(v.key, (r) => r.exposures), x = total(v.key, (r) => r.conversions); return { variant: v.key, n, x, rate: n ? x / n : 0 }; });
  const weights = i.variants.map((v) => v.weightBp);
  const s = srm(arms.map((a) => a.n), weights, i.srmAlpha ?? EXPERIMENT_POLICY.srmAlpha);
  const base = { dayNumber, srm: s, arms, treatments: [] as TreatmentResult[], guardrails: [] as GuardrailVerdict[], winner: null as string | null, blockers: [] as string[] };
  if (s.detected) return { ...base, verdict: 'SRM_DETECTED', hidden: true, stopReason: 'SRM', blockers: ['SRM'] };

  // guardrails: cumulative history by day, treatment vs control, one pair per treatment arm (a breach in any arm stops the experiment)
  const days = [...new Set(i.rows.map((r) => r.day))].sort();
  const cum = (variant: string, upTo: string, f: (r: DayRow) => number) => i.rows.filter((r) => r.variant === variant && r.day <= upTo).reduce((a, r) => a + f(r), 0);
  const gv: GuardrailVerdict[] = [];
  for (const g of i.guardrails) for (const t of i.variants.slice(1)) {
    const history = days.map((d) => ({ t: { n: cum(t.key, d, (r) => r.exposures), x: cum(t.key, d, (r) => r.guardrails[g.metric] ?? 0) }, c: { n: cum(control, d, (r) => r.exposures), x: cum(control, d, (r) => r.guardrails[g.metric] ?? 0) } }));
    gv.push({ ...evaluateGuardrail({ metric: `${g.metric}:${t.key}`, marginAbs: g.marginAbs, history }, alpha, i.guardrailMinEvents ?? EXPERIMENT_POLICY.guardrailMinEvents) });
  }
  base.guardrails = gv;
  const breach = gv.find((g) => g.breach);
  if (breach) return { ...base, verdict: 'GUARDRAIL_BREACH', hidden: false, stopReason: 'GUARDRAIL', blockers: [`GUARDRAIL:${breach.metric}`] };

  const c = arms[0]!; const k = Math.max(1, i.variants.length - 1);
  const raw = arms.slice(1).map((a) => (a.n > 0 && c.n > 0 ? twoProportion({ n: a.n, x: a.x }, { n: c.n, x: c.x }) : null));
  const adj = holm(raw.map((r) => r?.pValue ?? 1));
  const treatments: TreatmentResult[] = arms.slice(1).map((a, idx) => {
    const r = raw[idx]; const pav = a.n > 0 && c.n > 0 ? (msprtSeries(days.map((d) => ({ t: { n: cum(a.variant, d, (x) => x.exposures), x: cum(a.variant, d, (x) => x.conversions) }, c: { n: cum(control, d, (x) => x.exposures), x: cum(control, d, (x) => x.conversions) } }))).at(-1) ?? 1) : 1;
    const significant = i.mode === 'FIXED' ? adj[idx]! < alpha : pav < alpha / k;
    const diff = r?.diff ?? 0;
    return { variant: a.variant, diff, relativeLift: r?.relativeLift ?? null, ci: r?.ci ?? { low: 0, high: 0 }, pValue: r?.pValue ?? 1, pAdjusted: adj[idx]!, pAlwaysValid: i.mode === 'SEQUENTIAL' ? pav : null, significant, direction: diff > 0 ? 'UP' : diff < 0 ? 'DOWN' : 'FLAT' };
  });
  base.treatments = treatments;

  const blockers: string[] = [];
  if (dayNumber < minDays) blockers.push('MIN_DAYS');
  if (arms.some((a) => a.n < i.minSample)) blockers.push('MIN_SAMPLE');
  if (i.mode === 'FIXED' && dayNumber < i.plannedDays) blockers.push('FIXED_HORIZON_NOT_REACHED');
  base.blockers = blockers;
  const endLate = dayNumber > i.plannedDays * EXPERIMENT_POLICY.maxRunFactor && arms.some((a) => a.n < i.minSample);
  if (endLate) return { ...base, verdict: 'INCONCLUSIVE', hidden: false, stopReason: 'END_DATE_INSUFFICIENT_SAMPLE' };
  if (blockers.length) return { ...base, verdict: 'COLLECTING', hidden: true }; // no winner, no interval, no p-value shown while a blocker stands
  const best = treatments.filter((t) => t.significant && t.direction === 'UP').sort((a, b) => b.diff - a.diff)[0];
  if (best) return { ...base, verdict: 'WINNER', hidden: false, winner: best.variant };
  return { ...base, verdict: 'NO_WINNER', hidden: false };
}
