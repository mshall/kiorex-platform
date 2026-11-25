/**
 * Send-side protection shared by every real channel. Pure, in-process, injectable clock (tests never sleep).
 *  - RateBudget: sliding windows (second / minute / day) so a burst can never exceed the provider contract (Meta throughput, SES send rate, an aggregator's TPS).
 *  - BackoffGate: after a vendor throttle (Meta 131056 / 130429 / 131048 / 80007, HTTP 429) the channel is closed until `until`; consecutive throttles walk up the
 *    configured ladder (30 s, 2 min, 10 min, 30 min) and one success resets it. While closed, sends fail fast with `THROTTLED` and are retried by the caller's queue.
 * One process only: a multi-instance deployment shares the persistent copy in MessagingChannelState (the hub writes `throttleUntil` there too).
 */
export type Clock = () => number;

export class RateBudget {
  private readonly stamps: number[] = [];
  constructor(private readonly limits: { perSecond?: number; perMinute?: number; perDay?: number }, private readonly now: Clock = Date.now) {}
  private prune(t: number) { const cutoff = t - 86_400_000; while (this.stamps.length && this.stamps[0] <= cutoff) this.stamps.shift(); }
  private count(t: number, windowMs: number) { let n = 0; for (let i = this.stamps.length - 1; i >= 0 && this.stamps[i] > t - windowMs; i--) n++; return n; }
  /** Milliseconds to wait before one more send is allowed (0 = allowed now). Does not consume. */
  waitMs(): number {
    const t = this.now(); this.prune(t);
    let wait = 0;
    for (const [limit, win] of [[this.limits.perSecond, 1000], [this.limits.perMinute, 60_000], [this.limits.perDay, 86_400_000]] as const) {
      if (!limit) continue;
      if (this.count(t, win) >= limit) {
        const inWin = this.stamps.filter((s) => s > t - win);
        wait = Math.max(wait, inWin[inWin.length - limit] + win - t);
      }
    }
    return Math.max(0, Math.ceil(wait));
  }
  /** Consume one slot. Returns false (and consumes nothing) when over budget. */
  tryTake(): boolean { if (this.waitMs() > 0) return false; this.stamps.push(this.now()); return true; }
  used(windowMs: number): number { const t = this.now(); this.prune(t); return this.count(t, windowMs); }
}

export class BackoffGate {
  private until = 0;
  private level = 0;
  constructor(private readonly ladderSeconds: number[] = [30, 120, 600, 1800], private readonly now: Clock = Date.now) {}
  /** Close the channel after a throttle. `retryAfterSeconds` from the vendor wins when longer than the ladder step. Returns the instant it reopens. */
  trip(retryAfterSeconds = 0): number {
    const step = this.ladderSeconds[Math.min(this.level, this.ladderSeconds.length - 1)];
    this.level++;
    this.until = Math.max(this.until, this.now() + Math.max(step, retryAfterSeconds) * 1000);
    return this.until;
  }
  success(): void { this.level = 0; }
  /** Restore a persisted close (another instance tripped the gate). */
  restore(untilMs: number): void { if (untilMs > this.until) this.until = untilMs; }
  remainingMs(): number { return Math.max(0, this.until - this.now()); }
  get open(): boolean { return this.remainingMs() === 0; }
  get untilMs(): number { return this.until; }
}

/** Exponential backoff with full jitter for the in-request retry loop (the http client already has its own; this one is for queue re-delivery). */
export function backoffDelayMs(attempt: number, o: { baseDelayMs: number; maxDelayMs: number }, rnd: () => number = Math.random): number {
  const cap = Math.min(o.maxDelayMs, o.baseDelayMs * 2 ** Math.max(0, attempt - 1));
  return Math.floor(cap / 2 + rnd() * (cap / 2));
}
