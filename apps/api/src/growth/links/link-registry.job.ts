import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { cfg } from '../../common/config';
import { LinkRegistryService } from './link-registry.service';

/**
 * Hourly reconciliation of the link registry against the Clinic feed (`GET /marketplace/v1/referral-links?updatedSince=`): a missed `ReferralLinkCreated` or
 * `ReferralLinkRevoked` is repaired within the hour. Looks back 48 hours (overlap is harmless: applying a state is idempotent). Runs only when jobs are enabled.
 */
@Injectable()
export class LinkRegistryJob implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('link-registry-job');
  private timer?: NodeJS.Timeout;
  constructor(private readonly registry: LinkRegistryService) {}
  onModuleInit() {
    if (!cfg().jobsEnabled) return;
    this.timer = setInterval(() => void this.runOnce().catch((e) => this.log.warn(`link registry reconcile failed: ${e.message}`)), 3600_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  runOnce(hours = 48) { return this.registry.reconcile(new Date(Date.now() - hours * 3600_000)); }
}
