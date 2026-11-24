/**
 * Rate limiting. Production uses `PgRateLimiter` (below): counters live in Postgres so the limit is shared by every API instance.
 * `SlidingWindowLimiter` is the in-memory implementation: it is used ONLY by unit tests (and when RATE_LIMIT_STORE=memory is set explicitly, e.g. a throw-away local run).
 */
export interface LimitResult { ok: boolean; retryAfterSec: number }
export interface RateLimiter {
  /** Records a hit and answers whether it is within `limit` per `windowMs`. A refused hit is not counted. */
  hit(key: string, limit: number, windowMs: number): LimitResult | Promise<LimitResult>;
  /** Peek: would one more hit be refused? */
  blocked(key: string, limit: number, windowMs: number): LimitResult | Promise<LimitResult>;
  /** Tests only: forget every counter. */
  reset(): void | Promise<void>;
}

/** The slice of PrismaService the shared limiter needs (kept structural so `common/` does not import a feature module). */
export interface RawSql { $queryRawUnsafe<T = unknown>(q: string, ...v: any[]): Promise<T>; $executeRawUnsafe(q: string, ...v: any[]): Promise<number> }

/**
 * Cross-instance limiter on the existing Postgres: one row per (key, window). Fixed windows aligned to `windowMs`; a hit is ONE atomic
 * `INSERT .. ON CONFLICT DO UPDATE .. WHERE count < limit RETURNING` so concurrent instances can never over-admit and a refused hit is not counted.
 * Retry-After = time to the end of the window. (A fixed window can admit up to 2x the limit across a window edge: acceptable for abuse control.)
 * Rows expire with their window; `sweep()` deletes them (called by a job and opportunistically).
 */
export class PgRateLimiter implements RateLimiter {
  constructor(private readonly db: RawSql, private readonly now: () => number = Date.now) {}
  private win(key: string, windowMs: number) { const t = this.now(); const start = Math.floor(t / windowMs) * windowMs; return { k: `${key}|${windowMs}`, start: new Date(start), end: start + windowMs, t }; }
  async hit(key: string, limit: number, windowMs: number): Promise<LimitResult> {
    const w = this.win(key, windowMs);
    const rows = await this.db.$queryRawUnsafe<{ count: number }[]>(
      `INSERT INTO "RateLimitBucket" ("key","windowStart","count","expiresAt") VALUES ($1,$2,1,$3)
       ON CONFLICT ("key","windowStart") DO UPDATE SET "count" = "RateLimitBucket"."count" + 1 WHERE "RateLimitBucket"."count" < $4 RETURNING "count"`,
      w.k, w.start, new Date(w.end + 60_000), limit);
    if (Math.random() < 0.01) void this.sweep().catch(() => undefined);
    return rows.length ? { ok: true, retryAfterSec: 0 } : { ok: false, retryAfterSec: Math.max(1, Math.ceil((w.end - w.t) / 1000)) };
  }
  async blocked(key: string, limit: number, windowMs: number): Promise<LimitResult> {
    const w = this.win(key, windowMs);
    const rows = await this.db.$queryRawUnsafe<{ count: number }[]>(`SELECT "count" FROM "RateLimitBucket" WHERE "key" = $1 AND "windowStart" = $2`, w.k, w.start);
    return (rows[0]?.count ?? 0) >= limit ? { ok: false, retryAfterSec: Math.max(1, Math.ceil((w.end - w.t) / 1000)) } : { ok: true, retryAfterSec: 0 };
  }
  /** Deletes expired windows; returns how many. */
  async sweep(): Promise<number> { return this.db.$executeRawUnsafe(`DELETE FROM "RateLimitBucket" WHERE "expiresAt" < $1`, new Date(this.now())); }
  async reset(): Promise<void> { await this.db.$executeRawUnsafe(`DELETE FROM "RateLimitBucket"`); }
}

export class SlidingWindowLimiter implements RateLimiter {
  reset() { this.hits.clear(); }
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
