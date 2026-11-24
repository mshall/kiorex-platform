import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { cfg } from '../../common/config';
import { FlagsService } from '../../control-plane/control-plane-public';
import { PrismaService } from '../../prisma/prisma.service';
import { GROWTH_FLAG } from '../growth-flags';
import { CampaignBudgetService } from './campaign-budget.service';
import { CampaignService, SYSTEM } from './campaign.service';

const INSTANCE = `${process.pid}-${randomUUID().slice(0, 8)}`;

/**
 * Auto expiry and scheduling (GRW-P2-A), 1-minute resolution. Idempotent and safe on several instances at once: every move is a campaign transition that serialises on the row
 * lock and re-checks the state machine, so a second runner finds nothing left to do.
 *  - SCHEDULED reaches `startsAt`  -> ACTIVE (a window already over -> ARCHIVED WINDOW_MISSED)
 *  - PAUSED(GUARDRAIL) past `pausedUntil` (the daily cap day rolled) -> ACTIVE
 *  - ACTIVE or PAUSED past `autoExpiresAt` (endsAt + grace from policy) -> COMPLETED
 *  - every ACTIVE campaign gets its budget recomputed (safety net for a missed spend hook)
 * It honours the flag `growth.campaigns`: OFF for a market pauses all of it (nothing is deleted). Every run writes a GrowthJobRun heartbeat.
 */
@Injectable()
export class CampaignSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('campaign-scheduler');
  private timer?: NodeJS.Timeout;
  constructor(private readonly prisma: PrismaService, private readonly campaigns: CampaignService, private readonly budget: CampaignBudgetService, private readonly flags: FlagsService) {}
  onModuleInit() {
    if (!cfg().jobsEnabled) return;
    this.timer = setInterval(() => void this.runOnce().catch((e) => this.log.warn(`campaign scheduler failed: ${e.message}`)), 60_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async runOnce(now = new Date()) {
    const run = await this.prisma.growthJobRun.create({ data: { job: 'campaign-scheduler', instanceId: INSTANCE, startedAt: now } });
    const out = { activated: 0, resumed: 0, completed: 0, archived: 0, recomputed: 0, skipped: 0, errors: 0 };
    try {
      const open = await this.prisma.growthCampaign.findMany({ where: { status: { in: ['SCHEDULED', 'ACTIVE', 'PAUSED'] } }, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], take: 500 });
      const on = new Map<string, boolean>();
      for (const c of open) {
        if (!on.has(c.market)) on.set(c.market, await this.flags.isEnabled(GROWTH_FLAG.CAMPAIGNS, { market: c.market }).catch(() => false));
        if (!on.get(c.market)) { out.skipped++; continue; }
        const sys = SYSTEM('scheduler');
        try {
          if (c.status === 'SCHEDULED' && c.startsAt && c.startsAt <= now) {
            if (c.endsAt && c.endsAt <= now) { await this.campaigns.transition(sys, c.id, 'ARCHIVED', { reasonCode: 'WINDOW_MISSED', now }); out.archived++; }
            else { await this.campaigns.transition(sys, c.id, 'ACTIVE', { reasonCode: 'SCHEDULED_START', now }); out.activated++; }
          } else if (c.status === 'PAUSED' && c.pauseReason === 'GUARDRAIL' && c.pausedUntil && c.pausedUntil <= now && !(c.autoExpiresAt && c.autoExpiresAt <= now)) {
            await this.campaigns.transition(sys, c.id, 'ACTIVE', { reasonCode: 'DAILY_RESUME', now }); out.resumed++;
          } else if ((c.status === 'ACTIVE' || c.status === 'PAUSED') && c.autoExpiresAt && c.autoExpiresAt <= now) {
            await this.campaigns.transition(sys, c.id, 'COMPLETED', { reasonCode: 'EXPIRED', now }); out.completed++;
          }
        } catch (e) {
          const code = (e as { response?: { code?: string } }).response?.code;
          if (code === 'CAMPAIGN_INVALID_TRANSITION' || code === 'CAMPAIGN_NOT_FOUND') { out.skipped++; continue; } // another runner got there first
          out.errors++; this.log.warn(`campaign ${c.id}: ${(e as Error).message}`);
        }
      }
      for (const c of await this.prisma.growthCampaign.findMany({ where: { status: 'ACTIVE' }, select: { id: true, market: true }, take: 500 })) if (on.get(c.market) !== false) { await this.budget.recompute(c.id, now); out.recomputed++; }
      await this.prisma.growthJobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), rows: out.activated + out.resumed + out.completed + out.archived } });
      return out;
    } catch (e) {
      await this.prisma.growthJobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), error: String((e as Error).message).slice(0, 300) } });
      throw e;
    }
  }
}
