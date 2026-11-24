import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { cfg } from '../common/config';
import { PgRateLimiter, SlidingWindowLimiter, type RateLimiter } from '../common/rate-limit';
import { PrismaService } from '../prisma/prisma.service';
import { growthError } from './growth-errors';

const lim = (name: string, def: number) => { const n = Number(process.env[name]); return Number.isFinite(n) && n > 0 ? n : def; };

/** Per-bucket ceilings (requests per minute per rotating ipHash). Env overrides exist so tests and ops can tune without a deploy. */
export const growthLimits = () => ({
  touchPerMin: lim('GROWTH_RATE_TOUCH_PER_MIN', 60),
  eventsPerMin: lim('GROWTH_RATE_EVENTS_PER_MIN', 120),
  consentPerMin: lim('GROWTH_RATE_CONSENT_PER_MIN', 30),
  evidencePerMin: lim('GROWTH_RATE_EVIDENCE_PER_MIN', 120),
  burstPerMin: lim('GROWTH_FRAUD_BURST_PER_MIN', 20),
});

/** The shared Postgres limiter (RateLimitBucket), the same one every API instance uses; the in-memory limiter only when RATE_LIMIT_STORE=memory. */
@Injectable()
export class GrowthLimiter implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('growth-limiter');
  private timer?: NodeJS.Timeout;
  readonly limiter: RateLimiter;
  constructor(prisma: PrismaService) { this.limiter = process.env.RATE_LIMIT_STORE === 'memory' ? new SlidingWindowLimiter() : new PgRateLimiter(prisma as never); }
  onModuleInit() {
    if (!cfg().jobsEnabled || !(this.limiter instanceof PgRateLimiter)) return;
    const pg = this.limiter; this.timer = setInterval(() => void pg.sweep().catch((e) => this.log.warn(`sweep failed: ${e.message}`)), 10 * 60_000); this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  /** Counts one hit; refuses with 429 GROWTH_RATE_LIMITED (+ Retry-After) when the bucket is full. A refused hit is not counted. */
  async take(bucket: string, ipHash: string, limit: number, windowMs = 60_000) {
    const r = await this.limiter.hit(`growth:${bucket}:${ipHash}`, limit, windowMs);
    if (!r.ok) throw growthError('GROWTH_RATE_LIMITED', 'Too many requests, try again later', { retryAfterSec: r.retryAfterSec });
  }
}
