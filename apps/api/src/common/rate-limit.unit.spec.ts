import { SlidingWindowLimiter } from './rate-limit';

describe('SlidingWindowLimiter', () => {
  it('allows up to the limit, then refuses with a Retry-After that shrinks as the window slides', () => {
    let now = 1_000_000; const l = new SlidingWindowLimiter(() => now);
    for (let i = 0; i < 3; i++) expect(l.hit('ip', 3, 60_000).ok).toBe(true);
    const r = l.hit('ip', 3, 60_000); expect(r.ok).toBe(false); expect(r.retryAfterSec).toBe(60);
    now += 30_000; expect(l.hit('ip', 3, 60_000).retryAfterSec).toBe(30);
    now += 31_000; expect(l.hit('ip', 3, 60_000).ok).toBe(true);
  });
  it('keys are independent and a refused hit is not counted', () => {
    const l = new SlidingWindowLimiter(() => 5); l.hit('a', 1, 1000);
    expect(l.hit('a', 1, 1000).ok).toBe(false); expect(l.count('a', 1000)).toBe(1); expect(l.hit('b', 1, 1000).ok).toBe(true);
  });
});
