import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { cfg } from '../../common/config';
import { LoyaltyService } from './loyalty.service';

/** Loyalty housekeeping (every 6 hours, idempotent, callable on demand): lapsed points expire (FIFO) and tiers follow the moving window. Runs only while the launch-locked flag is effective; with it OFF nothing expires (OFF means off). */
@Injectable()
export class LoyaltyJob implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('loyalty-job');
  private timer?: NodeJS.Timeout;
  constructor(private readonly loyalty: LoyaltyService) {}
  onModuleInit() {
    if (!cfg().jobsEnabled) return;
    this.timer = setInterval(() => void this.runOnce().catch((e) => this.log.warn(`loyalty housekeeping failed: ${(e as Error).message}`)), 6 * 3600_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  async runOnce(now = new Date()) { return (await this.loyalty.isOn()) ? this.loyalty.housekeeping(now) : { accountsExpired: 0, pointsExpired: 0, tiersChanged: 0, skipped: 'FLAG_OFF' as const }; }
}
