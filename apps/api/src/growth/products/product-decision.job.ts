import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { cfg } from '../../common/config';
import { GrowthProductBookingService } from './product-decision.service';

/** Every 15 minutes: partner facts of the last 24 hours without a decision (the call failed or the flag was off) get one. Idempotent, bounded, counters only. Runs only when jobs are enabled. */
@Injectable()
export class ProductDecisionRepairJob implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('product-decision-repair');
  private timer?: NodeJS.Timeout;
  constructor(private readonly decisions: GrowthProductBookingService) {}
  onModuleInit() {
    if (!cfg().jobsEnabled) return;
    this.timer = setInterval(() => void this.runOnce().catch((e) => this.log.warn(`product decision repair failed: ${e.message}`)), 15 * 60_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  runOnce(hours = 24) { return this.decisions.repair(new Date(Date.now() - hours * 3600_000)); }
}
