import { Injectable } from '@nestjs/common';
import { PgRateLimiter, SlidingWindowLimiter, type RateLimiter } from '../../common/rate-limit';
import { PrismaService } from '../../prisma/prisma.service';

/** Per-number message rate (default 30 per hour) on the shared Postgres limiter (the same `RateLimitBucket` store the growth limiter uses), plus a once-per-window notice so a flood gets one polite answer and then silence. */
@Injectable()
export class AssistantRateLimit {
  readonly limiter: RateLimiter;
  constructor(prisma: PrismaService) { this.limiter = process.env.RATE_LIMIT_STORE === 'memory' ? new SlidingWindowLimiter() : new PgRateLimiter(prisma as never); }

  /** `ok:false` when the number has used its hour; `notify` is true for the FIRST refusal of the window only. */
  async perNumber(phoneHash: string, limitPerHour: number): Promise<{ ok: boolean; notify: boolean; retryAfterSec: number }> {
    const r = await this.limiter.hit(`assistant:num:${phoneHash}`, limitPerHour, 3_600_000);
    if (r.ok) return { ok: true, notify: false, retryAfterSec: 0 };
    const n = await this.limiter.hit(`assistant:notice:${phoneHash}`, 1, 3_600_000);
    return { ok: false, notify: n.ok, retryAfterSec: r.retryAfterSec };
  }
}

/** Instance-wide concurrency gate (policy `globalConcurrency`): over the limit the router answers `DETERMINISTIC`, never queues. */
export class ConcurrencyGate {
  private inFlight = 0;
  tryEnter(max: number): boolean { if (this.inFlight >= max) return false; this.inFlight++; return true; }
  leave() { this.inFlight = Math.max(0, this.inFlight - 1); }
  get current() { return this.inFlight; }
}
