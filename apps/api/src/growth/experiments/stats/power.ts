import { normInv } from './normal';

/**
 * Pre-registered sample size per arm for a two-sided two-proportion test (PURE):
 *   n = ( z_{1-a/2} sqrt(2 pbar qbar) + z_{power} sqrt(p1 q1 + p2 q2) )^2 / (p2 - p1)^2, pbar = (p1 + p2) / 2.
 * `mde` is the ABSOLUTE minimum detectable effect in rate points. The result is the number of units per arm, rounded up.
 */
export function sampleSizePerArm(o: { baseline: number; mde: number; alpha?: number; power?: number }): number {
  const alpha = o.alpha ?? 0.05, power = o.power ?? 0.8;
  const p1 = o.baseline, p2 = o.baseline + o.mde;
  if (!(p1 > 0 && p1 < 1) || !(p2 > 0 && p2 < 1) || o.mde === 0) throw new RangeError('baseline and baseline + mde must be in (0,1) and mde must not be 0');
  const pbar = (p1 + p2) / 2;
  const a = normInv(1 - alpha / 2) * Math.sqrt(2 * pbar * (1 - pbar));
  const b = normInv(power) * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2));
  return Math.ceil((a + b) ** 2 / (p2 - p1) ** 2);
}

/** Days needed at a daily exposure rate for `variants` arms (the allocation is already inside `dailyExposures`). */
export const daysNeeded = (perArm: number, variants: number, dailyExposures: number): number => (dailyExposures <= 0 ? Infinity : Math.ceil((perArm * variants) / dailyExposures));
