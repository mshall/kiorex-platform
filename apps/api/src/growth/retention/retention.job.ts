import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { cfg } from '../../common/config';
import { GrowthMaintenanceService, type PurgeResult } from '../maintenance/growth-maintenance.service';
import { AttributionPolicyResolver } from '../attribution/policy';
import { GROWTH_DEFAULT_MARKET } from '../growth-flags';

/**
 * Retention (ARCH 18): blanks ip hashes after 24 h, deletes unlinked touches after `unlinkedTouchRetentionMonths` (13) and decision-cited touches after
 * `touchEvidenceRetentionMonths` (25), plus old events and fraud signals, by calling the SECURITY DEFINER SQL function through GrowthMaintenanceService
 * (the only legal way to remove touches; it writes the AuditLog row). The months come from the ACTIVE ATTRIBUTION_POLICY (else the defaults). Idempotent;
 * runs every 6 hours when jobs are enabled and can be run by hand (`runOnce`).
 */
@Injectable()
export class RetentionJob implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('growth-retention');
  private timer?: NodeJS.Timeout;
  constructor(private readonly maintenance: GrowthMaintenanceService, private readonly policies: AttributionPolicyResolver) {}
  onModuleInit() {
    if (!cfg().jobsEnabled) return;
    this.timer = setInterval(() => void this.runOnce().catch((e) => this.log.warn(`retention failed: ${e.message}`)), 6 * 3600_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async runOnce(now = new Date(), market = GROWTH_DEFAULT_MARKET): Promise<PurgeResult> {
    const p = await this.policies.get(market, now);
    return this.maintenance.purgeExpired({ now, linkedMonths: p.touchEvidenceRetentionMonths, unlinkedMonths: p.unlinkedTouchRetentionMonths });
  }
}
