import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { GROWTH_ERROR_STATUS } from '@kiorex/contracts';
import { cfg } from '../common/config';
import { ApiError } from '../common/errors';
import { PgRateLimiter, SlidingWindowLimiter, type RateLimiter } from '../common/rate-limit';
import { PrismaService } from '../prisma/prisma.service';

/** Per-window ceilings of widget traffic. Env overrides let tests and ops tune them without a deploy. */
const lim = (name: string, def: number) => { const n = Number(process.env[name]); return Number.isFinite(n) && n > 0 ? n : def; };
export const widgetLimits = () => ({
  sessionPerMin: lim('WIDGET_RATE_SESSION_PER_MIN', 30),
  configPerMin: lim('WIDGET_RATE_CONFIG_PER_MIN', 60),
  slotsPerMinIp: lim('WIDGET_RATE_SLOTS_PER_MIN', 60),
  slotsPerMinOrg: lim('WIDGET_RATE_SLOTS_ORG_PER_MIN', 1200),
  bookingPerMinIp: lim('WIDGET_RATE_BOOKING_PER_MIN', 10),
  confirmPerMinIp: lim('WIDGET_RATE_CONFIRM_PER_MIN', 30),
});

/** The shared Postgres limiter (RateLimitBucket), the one every API instance uses; in-memory only when RATE_LIMIT_STORE=memory. */
@Injectable()
export class WidgetLimiter implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  readonly limiter: RateLimiter;
  constructor(prisma: PrismaService) { this.limiter = process.env.RATE_LIMIT_STORE === 'memory' ? new SlidingWindowLimiter() : new PgRateLimiter(prisma as never); }
  onModuleInit() {
    if (!cfg().jobsEnabled || !(this.limiter instanceof PgRateLimiter)) return;
    const pg = this.limiter; this.timer = setInterval(() => void pg.sweep().catch(() => undefined), 10 * 60_000); this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  /** Counts one hit; 429 GROWTH_RATE_LIMITED + Retry-After when the bucket is full (a refused hit is not counted). */
  async take(bucket: string, subject: string, limit: number, windowMs = 60_000) {
    const r = await this.limiter.hit(`widget:${bucket}:${subject}`, limit, windowMs);
    if (!r.ok) throw new ApiError(GROWTH_ERROR_STATUS.GROWTH_RATE_LIMITED, 'GROWTH_RATE_LIMITED', 'Too many requests, try again later', { retryAfterSec: r.retryAfterSec });
  }
}
