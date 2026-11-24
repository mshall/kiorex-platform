import { chiSquareSf } from './normal';

export interface SrmResult { chi2: number; df: number; pValue: number; detected: boolean }
/** Sample-ratio mismatch: chi-square goodness of fit of the observed exposures against the weights (basis points). Flagged below `alpha` (default 0.001). PURE. */
export function srm(observed: readonly number[], weightsBp: readonly number[], alpha = 0.001): SrmResult {
  if (observed.length !== weightsBp.length || observed.length < 2) throw new RangeError('observed and weights must have the same length (>= 2)');
  const total = observed.reduce((a, b) => a + b, 0); const wsum = weightsBp.reduce((a, b) => a + b, 0);
  if (total <= 0) return { chi2: 0, df: observed.length - 1, pValue: 1, detected: false };
  let chi2 = 0;
  observed.forEach((o, i) => { const e = (total * weightsBp[i]!) / wsum; chi2 += (o - e) ** 2 / e; });
  const df = observed.length - 1; const pValue = chiSquareSf(chi2, df);
  return { chi2, df, pValue, detected: pValue < alpha };
}
