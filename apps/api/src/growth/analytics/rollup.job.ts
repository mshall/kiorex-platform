import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { cfg } from '../../common/config';
import { GrowthRollupService } from './rollup.service';

/** Hourly rollup of the last 3 days (late events and corrections land in the window). Idempotent; runs only when jobs are enabled; `runOnce` is also the manual trigger. */
@Injectable()
export class GrowthRollupJob implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('growth-rollup-job');
  private timer?: NodeJS.Timeout;
  constructor(private readonly rollup: GrowthRollupService) {}
  onModuleInit() {
    if (!cfg().jobsEnabled) return;
    this.timer = setInterval(() => void this.runOnce().catch((e) => this.log.warn(`rollup failed: ${e.message}`)), 3600_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  runOnce(days = 3) { return this.rollup.rollup({ days }); }
}
