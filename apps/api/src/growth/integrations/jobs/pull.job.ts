import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { cfg } from '../../../common/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { GROWTH_DEFAULT_MARKET } from '../../growth-flags';
import { IntegrationService } from '../integration.service';
import { GROWTH_INTEGRATION_KINDS } from '../port';

/**
 * Hourly tick; each integration runs at most once a day (an OK or PARTIAL run today ends the day's work). Mock pulls do not run on a production API: synthetic numbers must never sit next
 * to real campaign figures (a mock pull stays available on demand from the ops page, labelled synthetic).
 */
@Injectable()
export class IntegrationPullJob implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('growth-integration-pull');
  private timer?: NodeJS.Timeout;
  constructor(private readonly svc: IntegrationService, private readonly prisma: PrismaService) {}
  onModuleInit() {
    if (!cfg().jobsEnabled) return;
    this.timer = setInterval(() => void this.runOnce().catch((e) => this.log.warn(`pull job failed: ${(e as Error).message}`)), 3_600_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async runOnce(now = new Date(), market = GROWTH_DEFAULT_MARKET) {
    const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`); const out: Array<{ kind: string; status: string; reason?: string }> = [];
    for (const kind of GROWTH_INTEGRATION_KINDS) {
      const s = await this.svc.setting(kind, market);
      if (s.mode === 'mock' && cfg().isProd) { out.push({ kind, status: 'SKIPPED', reason: 'MOCK_IN_PRODUCTION' }); continue; }
      if (s.pullSchedule !== 'daily') { out.push({ kind, status: 'SKIPPED', reason: 'NOT_SCHEDULED' }); continue; }
      const done = await this.prisma.growthIntegrationRun.count({ where: { market, kind, status: { in: ['OK', 'PARTIAL'] }, startedAt: { gte: today } } });
      if (done) { out.push({ kind, status: 'SKIPPED', reason: 'DONE_TODAY' }); continue; }
      try { const r = await this.svc.run(kind, { market, trigger: 'SCHEDULE', actor: 'system:integration-pull', now }); out.push({ kind, status: r.status, reason: r.reason }); }
      catch (e) { out.push({ kind, status: 'FAILED', reason: (e as { code?: string }).code ?? 'ERROR' }); }
    }
    await this.svc.purgeExpired(now);
    return out;
  }
}
