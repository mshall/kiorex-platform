/**
 * Incrementality view (GRW-P3-B): holdout units against exposed units of a P3-A experiment, labelled "experiment-based lift". PURE. A two-proportion z test on aggregate
 * counts (exposures and conversions per variant from `GrowthExperimentDaily`); no person-level data. Cells under k = 10 exposed units on either side are not reported.
 * (When P3-A's `stats/fixed-horizon.ts` is merged this should call it instead of the local normal CDF; the numbers agree to the displayed precision.)
 */
export interface ArmCounts { exposures: number; conversions: number }
export interface Lift { label: 'experiment-based lift'; holdout: ArmCounts & { rate: number }; exposed: ArmCounts & { rate: number }; absoluteLiftPp: number; relativeLiftPct: number | null; ciLowPp: number; ciHighPp: number; z: number; pValue: number; significant: boolean; alpha: number }
export const K_MIN_LIFT = 10;

/** Standard normal CDF (Abramowitz-Stegun 7.1.26 via erf). */
export const normalCdf = (z: number) => { const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2); return 0.5 * (1 + (z < 0 ? -y : y)); };

export function liftOf(holdout: ArmCounts, exposed: ArmCounts, alpha = 0.05): Lift | { suppressed: true; reason: 'K_FLOOR' | 'NO_DATA' } {
  if (holdout.exposures <= 0 || exposed.exposures <= 0) return { suppressed: true, reason: 'NO_DATA' };
  if (holdout.exposures < K_MIN_LIFT || exposed.exposures < K_MIN_LIFT) return { suppressed: true, reason: 'K_FLOOR' };
  const p1 = holdout.conversions / holdout.exposures; const p2 = exposed.conversions / exposed.exposures;
  const pooled = (holdout.conversions + exposed.conversions) / (holdout.exposures + exposed.exposures);
  const se0 = Math.sqrt(pooled * (1 - pooled) * (1 / holdout.exposures + 1 / exposed.exposures));
  const z = se0 === 0 ? 0 : (p2 - p1) / se0; const pValue = 2 * (1 - normalCdf(Math.abs(z)));
  const se1 = Math.sqrt((p1 * (1 - p1)) / holdout.exposures + (p2 * (1 - p2)) / exposed.exposures); const zc = 1.959964;
  const d = p2 - p1; const r = (x: number) => Math.round(x * 1e4) / 1e4;
  return { label: 'experiment-based lift', holdout: { ...holdout, rate: r(p1) }, exposed: { ...exposed, rate: r(p2) }, absoluteLiftPp: r(d * 100), relativeLiftPct: p1 > 0 ? r((d / p1) * 100) : null, ciLowPp: r((d - zc * se1) * 100), ciHighPp: r((d + zc * se1) * 100), z: r(z), pValue: r(pValue), significant: pValue < alpha, alpha };
}
