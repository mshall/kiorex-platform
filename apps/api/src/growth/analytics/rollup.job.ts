import { GrowthRevenueService } from './revenue.service';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { cfg } from '../../common/config';
import { GrowthRollupService } from './rollup.service';

/** Hourly rollup of the last 3 days (late events and corrections land in the window). Idempotent; runs only when jobs are enabled; `runOnce` is also the manual trigger. */
@Injectable()
export class GrowthRollupJob implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('growth-rollup-job');
  private timer?: NodeJS.Timeout;
  constructor(private readonly rollup: GrowthRollupService, private readonly revenue: GrowthRevenueService) {}
  onModuleInit() {
    if (!cfg().jobsEnabled) return;
    this.timer = setInterval(() => void this.runOnce().catch((e) => this.log.warn(`rollup failed: ${e.message}`)), 3600_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  /** G-19: reconcile the revenue basis first (inferred confirmations that a BILLED fact has settled), then roll up. */
  async runOnce(days = 3) { await this.revenue.reconcileBasis().catch((e) => this.log.warn(`revenue basis reconcile failed: ${e.message}`)); return this.rollup.rollup({ days }); }
}
