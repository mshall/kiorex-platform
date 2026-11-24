/**
 * Mixture SPRT always-valid p-values for a difference of proportions (PURE; normal approximation, Johari et al. 2017 / Optimizely "stats engine" family).
 * With theta_hat the observed difference, V its estimated variance and a N(0, tau^2) mixing distribution over the true effect:
 *   Lambda = sqrt(V / (V + tau^2)) * exp( tau^2 theta^2 / (2 V (V + tau^2)) )     p_n = min(p_{n-1}, 1 / Lambda)
 * `theta0` shifts the null (used for non-inferiority guardrails: H0 is "the harm is at least theta0").
 */
export interface MsprtState { pAlwaysValid: number; lambda: number }
export const MSPRT_TAU2_DEFAULT = 0.0004; // prior sd of 2 percentage points on the effect (rate scale)

export function msprtStep(prevP: number, o: { theta: number; variance: number; tau2?: number; theta0?: number }): MsprtState {
  const tau2 = o.tau2 ?? MSPRT_TAU2_DEFAULT; const V = o.variance; const th = o.theta - (o.theta0 ?? 0);
  if (!(V > 0)) return { pAlwaysValid: prevP, lambda: 1 };
  const lambda = Math.sqrt(V / (V + tau2)) * Math.exp((tau2 * th * th) / (2 * V * (V + tau2)));
  return { pAlwaysValid: Math.min(prevP, Math.min(1, 1 / lambda)), lambda };
}

export const diffVariance = (t: { n: number; x: number }, c: { n: number; x: number }): number => {
  const pt = t.x / t.n, pc = c.x / c.n; return (pt * (1 - pt)) / t.n + (pc * (1 - pc)) / c.n;
};

/** Always-valid p-value over a daily history of cumulative (t, c) counts (the running minimum makes it valid at every look). */
export function msprtSeries(history: readonly { t: { n: number; x: number }; c: { n: number; x: number } }[], tau2?: number, theta0?: number): number[] {
  let p = 1; const out: number[] = [];
  for (const h of history) {
    if (h.t.n <= 0 || h.c.n <= 0) { out.push(p); continue; }
    // continuity floor: a variance of exactly 0 (all zeros) would make the test blind, use the +0.5 / +1 shrunk rates
    const t = { n: h.t.n, x: h.t.x }, c = { n: h.c.n, x: h.c.x };
    const V = diffVariance({ n: t.n + 2, x: t.x + 1 }, { n: c.n + 2, x: c.x + 1 });
    p = msprtStep(p, { theta: t.x / t.n - c.x / c.n, variance: V, tau2, theta0 }).pAlwaysValid; out.push(p);
  }
  return out;
}
