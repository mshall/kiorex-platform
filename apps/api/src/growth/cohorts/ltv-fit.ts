import { hashSeed, mulberry32, percentile, subsample } from './bootstrap';
import { monthMeans, projectCurve, type LtvCurve, type LtvPatient } from './ltv.model';
import type { LtvPolicy } from './ltv-policy';

/**
 * GRW-P3-C fit: point estimate plus a bootstrap interval (resamples over patients with replacement, seeded). The result is an aggregate with n; callers store it as an
 * ESTIMATE. The interval reflects sampling variation of the group mean (and the projection built on it); it does not include model risk, which the console says.
 */
export interface LtvFit {
  n: number; horizonMonths: number; estimateMinor: number; lowMinor: number; highMinor: number;
  observedMonths: number; projectedMonths: number; decay: number | null; note: LtvCurve['note']; cumulative: number[];
  resamples: number; subsampled: boolean; seed: number;
}

export function fitLtv(patients: readonly LtvPatient[], policy: LtvPolicy, key: string): LtvFit | null {
  const n = patients.length; if (n < policy.minCohortPatients) return null;
  const seed = hashSeed(policy.seed, key); const rnd = mulberry32(seed);
  const point = projectCurve(monthMeans(patients, policy.minPatientsPerObservedMonth, policy.horizonMonths), policy);
  if (point.note === 'NOT_ENOUGH_DATA') return null;
  const base = patients.length > policy.maxBootstrapPatients ? subsample(patients, policy.maxBootstrapPatients, rnd) : patients; const m = base.length;
  const H = policy.horizonMonths; const estimates: number[] = [];
  const sums = new Float64Array(H); const counts = new Int32Array(H);
  for (let b = 0; b < policy.bootstrapResamples; b++) {
    sums.fill(0); counts.fill(0);
    for (let i = 0; i < m; i++) { const p = base[Math.floor(rnd() * m)]!; const last = Math.min(p.age, H - 1); for (let k = 0; k <= last; k++) { sums[k] += p.contrib[k] ?? 0; counts[k]++; } }
    let last = -1; const means: number[] = [];
    for (let k = 0; k < H; k++) { if (counts[k]! < policy.minPatientsPerObservedMonth) break; means.push(sums[k]! / counts[k]!); last = k; }
    const c = projectCurve({ means, counts: [], lastObserved: last }, policy); estimates.push(c.cumulative[H - 1] ?? 0);
  }
  estimates.sort((a, b) => a - b);
  const tail = (1 - policy.intervalPercent / 100) / 2;
  const est = point.cumulative[H - 1] ?? 0;
  const low = Math.min(percentile(estimates, tail), est); const high = Math.max(percentile(estimates, 1 - tail), est);
  return { n, horizonMonths: H, estimateMinor: Math.round(est), lowMinor: Math.round(Math.max(0, low)), highMinor: Math.round(high), observedMonths: point.observedMonths, projectedMonths: point.projectedMonths, decay: point.decay, note: point.note, cumulative: point.cumulative.map(Math.round), resamples: policy.bootstrapResamples, subsampled: patients.length > policy.maxBootstrapPatients, seed };
}
