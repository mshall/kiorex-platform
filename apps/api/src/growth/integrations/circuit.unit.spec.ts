import { afterRun, allowRun, backoffMs, BREAKER_COOLDOWN_MS, BREAKER_THRESHOLD, type BreakerState } from './circuit';

const t0 = new Date('2026-12-01T10:00:00Z');
describe('integration circuit breaker', () => {
  it('opens after five consecutive failures and not before', () => {
    let s: BreakerState = { circuit: 'CLOSED', consecutiveFailures: 0, lastErrorAt: null };
    for (let i = 1; i < BREAKER_THRESHOLD; i++) { s = afterRun(s, false, t0); expect(s.circuit).toBe('CLOSED'); }
    s = afterRun(s, false, t0); expect(s).toMatchObject({ circuit: 'OPEN', consecutiveFailures: 5 });
  });
  it('a success resets the count', () => { expect(afterRun({ circuit: 'CLOSED', consecutiveFailures: 4, lastErrorAt: t0 }, true, t0)).toMatchObject({ circuit: 'CLOSED', consecutiveFailures: 0 }); });
  it('an open breaker refuses until the cool-down, then lets one probe through; a failed probe re-opens, a success closes', () => {
    const open: BreakerState = { circuit: 'OPEN', consecutiveFailures: 5, lastErrorAt: t0 };
    expect(allowRun(open, new Date(t0.getTime() + 1000)).allowed).toBe(false);
    const g = allowRun(open, new Date(t0.getTime() + BREAKER_COOLDOWN_MS)); expect(g).toEqual({ allowed: true, next: 'HALF_OPEN' });
    const half: BreakerState = { ...open, circuit: 'HALF_OPEN' };
    expect(afterRun(half, false, t0).circuit).toBe('OPEN'); expect(afterRun(half, true, t0).circuit).toBe('CLOSED');
  });
  it('jittered backoff stays within the exponential cap', () => { for (let a = 0; a < 10; a++) for (const r of [0, 0.5, 0.999]) expect(backoffMs(a, () => r)).toBeLessThanOrEqual(30_000); expect(backoffMs(2, () => 0.5)).toBe(1000); });
});
