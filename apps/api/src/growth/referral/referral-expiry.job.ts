import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { cfg } from '../../common/config';
import { ReferralQualificationService } from './referral-qualification.service';

/** Every 30 minutes: evaluates relationships whose hold window ended and expires the ones past the claim window (idempotent; also callable on demand by the tests and the ops console). */
@Injectable()
export class ReferralExpiryJob implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('referral-expiry');
  private timer?: NodeJS.Timeout;
  constructor(private readonly qual: ReferralQualificationService) {}
  onModuleInit() {
    if (!cfg().jobsEnabled) return;
    this.timer = setInterval(() => void this.run().catch((e) => this.log.warn(`referral job failed: ${(e as Error).message}`)), 30 * 60_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  run(now = new Date()) { return this.qual.runDue(now); }
}
