import type { LtvPolicy } from './ltv-policy';

/**
 * GRW-P3-C LTV model (AD-10). PURE and deterministic. No per-person LTV exists: a patient record only ever enters a group mean, and a group needs the policy floor of
 * patients for every month it uses. The model is the one the architecture decision names: observed cumulative contribution per acquired patient, and for the months
 * the group is not old enough to have observed, a geometric tail from the average monthly decay of the last observed months, clipped so a projected month is never above the
 * last observed level. A BG/NBD style model is deliberately not built (volume too low to fit it honestly), see GROWTH.md.
 */
export interface LtvPatient {
  /** Last observed month index of this patient (0 = the acquisition month). */
  age: number;
  /** Contribution (revenue minus reward cost when the policy says so) per month index, minor units; length age + 1. */
  contrib: readonly number[];
}
export interface MonthMeans { means: number[]; counts: number[]; lastObserved: number }
export interface LtvCurve { perMonth: number[]; cumulative: number[]; observedMonths: number; projectedMonths: number; decay: number | null; note: 'OBSERVED' | 'PROJECTED' | 'NO_DECAY_INFO' | 'NOT_ENOUGH_DATA' }

export function monthMeans(patients: readonly LtvPatient[], minPatients: number, horizon: number): MonthMeans {
  const sums = new Array<number>(horizon).fill(0); const counts = new Array<number>(horizon).fill(0);
  for (const p of patients) { const last = Math.min(p.age, horizon - 1); for (let m = 0; m <= last; m++) { sums[m]! += p.contrib[m] ?? 0; counts[m]!++; } }
  let lastObserved = -1; const means: number[] = [];
  for (let m = 0; m < horizon; m++) { if (counts[m]! < minPatients) break; means.push(sums[m]! / counts[m]!); lastObserved = m; }
  return { means, counts: counts.slice(0, means.length), lastObserved };
}

/** Per-month contribution then the cumulative curve for `horizon` months (discounted by the policy rate, month by month). */
export function projectCurve(mm: MonthMeans, policy: Pick<LtvPolicy, 'horizonMonths' | 'tailFitWindowMonths' | 'discountRateBp'>): LtvCurve {
  const H = policy.horizonMonths; const L = mm.lastObserved;
  if (L < 0) return { perMonth: new Array(H).fill(0), cumulative: new Array(H).fill(0), observedMonths: 0, projectedMonths: H, decay: null, note: 'NOT_ENOUGH_DATA' };
  const perMonth: number[] = []; let decay: number | null = null; let note: LtvCurve['note'] = L >= H - 1 ? 'OBSERVED' : 'PROJECTED';
  if (L < H - 1) {
    const w = Math.min(policy.tailFitWindowMonths, L);
    if (w >= 1 && mm.means[L - w]! > 0) decay = Math.min(1, Math.max(0, (mm.means[L]! / mm.means[L - w]!) ** (1 / w)));
    else { decay = 0; note = 'NO_DECAY_INFO'; }
  }
  const d = policy.discountRateBp / 10_000;
  for (let m = 0; m < H; m++) {
    const raw = m <= L ? mm.means[m]! : Math.min(mm.means[L]!, mm.means[L]! * (decay ?? 0) ** (m - L)); // never above the last observed level
    perMonth.push((d > 0 ? raw / (1 + d) ** (m / 12) : raw));
  }
  let s = 0; const cumulative = perMonth.map((v) => (s += v));
  return { perMonth, cumulative, observedMonths: Math.min(L + 1, H), projectedMonths: Math.max(0, H - (L + 1)), decay, note };
}
export const ltvPoint = (patients: readonly LtvPatient[], policy: LtvPolicy): LtvCurve => projectCurve(monthMeans(patients, policy.minPatientsPerObservedMonth, policy.horizonMonths), policy);

/** First month index (0-based) whose cumulative contribution per patient reaches the acquisition cost; null when it does not within the horizon. */
export function paybackMonth(cumulative: readonly number[], cacMinor: number): number | null {
  if (!(cacMinor > 0)) return null;
  const i = cumulative.findIndex((c) => c >= cacMinor); return i < 0 ? null : i;
}
