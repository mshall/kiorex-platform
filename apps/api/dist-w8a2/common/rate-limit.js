"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SlidingWindowLimiter = exports.PgRateLimiter = void 0;
class PgRateLimiter {
    db;
    now;
    constructor(db, now = Date.now) {
        this.db = db;
        this.now = now;
    }
    win(key, windowMs) { const t = this.now(); const start = Math.floor(t / windowMs) * windowMs; return { k: `${key}|${windowMs}`, start: new Date(start), end: start + windowMs, t }; }
    async hit(key, limit, windowMs) {
        const w = this.win(key, windowMs);
        const rows = await this.db.$queryRawUnsafe(`INSERT INTO "RateLimitBucket" ("key","windowStart","count","expiresAt") VALUES ($1,$2,1,$3)
       ON CONFLICT ("key","windowStart") DO UPDATE SET "count" = "RateLimitBucket"."count" + 1 WHERE "RateLimitBucket"."count" < $4 RETURNING "count"`, w.k, w.start, new Date(w.end + 60_000), limit);
        if (Math.random() < 0.01)
            void this.sweep().catch(() => undefined);
        return rows.length ? { ok: true, retryAfterSec: 0 } : { ok: false, retryAfterSec: Math.max(1, Math.ceil((w.end - w.t) / 1000)) };
    }
    async blocked(key, limit, windowMs) {
        const w = this.win(key, windowMs);
        const rows = await this.db.$queryRawUnsafe(`SELECT "count" FROM "RateLimitBucket" WHERE "key" = $1 AND "windowStart" = $2`, w.k, w.start);
        return (rows[0]?.count ?? 0) >= limit ? { ok: false, retryAfterSec: Math.max(1, Math.ceil((w.end - w.t) / 1000)) } : { ok: true, retryAfterSec: 0 };
    }
    async sweep() { return this.db.$executeRawUnsafe(`DELETE FROM "RateLimitBucket" WHERE "expiresAt" < $1`, new Date(this.now())); }
    async reset() { await this.db.$executeRawUnsafe(`DELETE FROM "RateLimitBucket"`); }
}
exports.PgRateLimiter = PgRateLimiter;
class SlidingWindowLimiter {
    now;
    reset() { this.hits.clear(); }
    hits = new Map();
    lastSweep = 0;
    constructor(now = Date.now) {
        this.now = now;
    }
    hit(key, limit, windowMs) {
        const t = this.now();
        this.sweep(t, windowMs);
        const arr = (this.hits.get(key) ?? []).filter((x) => t - x < windowMs);
        if (arr.length >= limit) {
            this.hits.set(key, arr);
            return { ok: false, retryAfterSec: Math.max(1, Math.ceil((arr[0] + windowMs - t) / 1000)) };
        }
        arr.push(t);
        this.hits.set(key, arr);
        return { ok: true, retryAfterSec: 0 };
    }
    count(key, windowMs) { const t = this.now(); return (this.hits.get(key) ?? []).filter((x) => t - x < windowMs).length; }
    blocked(key, limit, windowMs) {
        const t = this.now();
        const arr = (this.hits.get(key) ?? []).filter((x) => t - x < windowMs);
        return arr.length >= limit ? { ok: false, retryAfterSec: Math.max(1, Math.ceil((arr[0] + windowMs - t) / 1000)) } : { ok: true, retryAfterSec: 0 };
    }
    sweep(t, windowMs) {
        if (t - this.lastSweep < 60_000)
            return;
        this.lastSweep = t;
        for (const [k, arr] of this.hits) {
            const keep = arr.filter((x) => t - x < Math.max(windowMs, 3_600_000));
            if (keep.length)
                this.hits.set(k, keep);
            else
                this.hits.delete(k);
        }
    }
}
exports.SlidingWindowLimiter = SlidingWindowLimiter;
//# sourceMappingURL=rate-limit.js.map