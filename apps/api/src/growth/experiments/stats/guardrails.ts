import { msprtSeries } from './msprt';

/**
 * Guardrail non-inferiority (PURE). A guardrail is a rate that must not rise by more than `marginAbs` (absolute) because of the treatment. A breach is declared when the always-valid
 * p-value for H0 "treatment - control <= margin" falls below `alpha` AND the observed rise exceeds the margin AND the treatment arm has at least `minEvents` events (no breach on noise).
 */
export interface GuardrailInput { metric: string; marginAbs: number; history: readonly { t: { n: number; x: number }; c: { n: number; x: number } }[] }
export interface GuardrailVerdict { metric: string; breach: boolean; pAlwaysValid: number; observedDiff: number; treatmentEvents: number }

export function evaluateGuardrail(g: GuardrailInput, alpha: number, minEvents: number): GuardrailVerdict {
  const last = g.history[g.history.length - 1];
  if (!last || last.t.n <= 0 || last.c.n <= 0) return { metric: g.metric, breach: false, pAlwaysValid: 1, observedDiff: 0, treatmentEvents: last?.t.x ?? 0 };
  const series = msprtSeries(g.history, undefined, g.marginAbs);
  const p = series[series.length - 1]!; const diff = last.t.x / last.t.n - last.c.x / last.c.n;
  return { metric: g.metric, breach: p < alpha && diff > g.marginAbs && last.t.x >= minEvents, pAlwaysValid: p, observedDiff: diff, treatmentEvents: last.t.x };
}
