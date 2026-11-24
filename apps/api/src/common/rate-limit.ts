/**
 * Small in-memory sliding-window limiter (per process). The platform had no throttling before the partner intake needed it; this is the
 * shared helper. Behind several instances each keeps its own window (limits are then per instance): put the edge (WAF / API gateway) in front for a global cap.
 */
export interface LimitResult { ok: boolean; retryAfterSec: number }

export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();
  private lastSweep = 0;
  constructor(private readonly now: () => number = Date.now) {}

  /** Records a hit and answers whether it is within `limit` per `windowMs`. A refused hit is not counted. */
  hit(key: string, limit: number, windowMs: number): LimitResult {
    const t = this.now();
    this.sweep(t, windowMs);
    const arr = (this.hits.get(key) ?? []).filter((x) => t - x < windowMs);
    if (arr.length >= limit) { this.hits.set(key, arr); return { ok: false, retryAfterSec: Math.max(1, Math.ceil((arr[0]! + windowMs - t) / 1000)) }; }
    arr.push(t); this.hits.set(key, arr);
    return { ok: true, retryAfterSec: 0 };
  }
  /** Current count without recording. */
  count(key: string, windowMs: number): number { const t = this.now(); return (this.hits.get(key) ?? []).filter((x) => t - x < windowMs).length; }
  /** Peek: would one more hit be refused? */
  blocked(key: string, limit: number, windowMs: number): LimitResult {
    const t = this.now(); const arr = (this.hits.get(key) ?? []).filter((x) => t - x < windowMs);
    return arr.length >= limit ? { ok: false, retryAfterSec: Math.max(1, Math.ceil((arr[0]! + windowMs - t) / 1000)) } : { ok: true, retryAfterSec: 0 };
  }
  private sweep(t: number, windowMs: number) {
    if (t - this.lastSweep < 60_000) return; this.lastSweep = t;
    for (const [k, arr] of this.hits) { const keep = arr.filter((x) => t - x < Math.max(windowMs, 3_600_000)); if (keep.length) this.hits.set(k, keep); else this.hits.delete(k); }
  }
}
