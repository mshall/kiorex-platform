/**
 * In-process failure counters for growth paths that must never fail silently (no metrics backend exists yet; the counters are read by tests and can be exposed by whichever health or
 * metrics surface is added later). A failure counted here was also logged at ERROR level with the same key, so an alert can match either.
 */
const counters = new Map<string, number>();
export const GROWTH_FAILURE = { ATTRIBUTION_FLAG_CHECK: 'growth.attribution.flag_check_failed', ATTRIBUTION_DECISION: 'growth.attribution.decision_failed' } as const;
export const recordGrowthFailure = (key: string): number => { const n = (counters.get(key) ?? 0) + 1; counters.set(key, n); return n; };
export const growthFailureCount = (key: string): number => counters.get(key) ?? 0;
export const resetGrowthFailures = (): void => counters.clear();
