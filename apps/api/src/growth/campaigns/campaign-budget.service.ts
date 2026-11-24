import { Injectable } from '@nestjs/common';
import { Prisma } from '../../prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OutboxService } from '../../outbox/outbox-public';
import { budgetExhausted, dailyCapReached, thresholdsToFire, utilisationBp } from './campaign-guardrails';
import { CampaignService, SYSTEM } from './campaign.service';
import { localDay, marketTimezone, nextDayBoundary } from './market-day';

/**
 * Budget utilisation and guardrails (GRW-P2-A). `recompute` is the ONE place spend becomes campaign state: it is idempotent (call it as often as you like) and is called after every
 * spend line is entered or decided and by the scheduler. Utilisation = APPROVED spend / total budget. Alerts at the policy thresholds (50, 80, 100 percent) fire once per campaign
 * (atomic array append), 100 percent pauses the campaign with PAUSED(BUDGET), and reaching the daily cap pauses it until the next market-local day boundary (PAUSED(GUARDRAIL)).
 * It never creates spend and never contacts an ad platform.
 */
@Injectable()
export class CampaignBudgetService {
  constructor(private readonly prisma: PrismaService, private readonly campaigns: CampaignService, private readonly outbox: OutboxService) {}

  async recompute(campaignId: string, now = new Date()) {
    const c = await this.prisma.growthCampaign.findUnique({ where: { id: campaignId } });
    if (!c) return null;
    const zone = marketTimezone(c.market); const today = localDay(now, zone);
    const rows = await this.prisma.growthSpendEntry.groupBy({ by: ['day', 'status'], where: { campaignId, status: { in: ['APPROVED', 'PENDING'] } }, _sum: { amountMinor: true } });
    const byDay = new Map<string, { approved: number; pending: number }>();
    let approved = 0; let pending = 0; let approvedToday = 0;
    for (const r of rows) {
      const d = r.day.toISOString().slice(0, 10); const e = byDay.get(d) ?? { approved: 0, pending: 0 }; const n = r._sum.amountMinor ?? 0;
      if (r.status === 'APPROVED') { e.approved += n; approved += n; if (d === today) approvedToday += n; } else { e.pending += n; pending += n; }
      byDay.set(d, e);
    }
    for (const [d, e] of byDay) {
      const day = new Date(`${d}T00:00:00Z`);
      await this.prisma.growthCampaignBudgetDaily.upsert({ where: { campaignId_day: { campaignId, day } }, create: { campaignId, day, plannedMinor: c.budgetDailyMinor, approvedSpendMinor: e.approved, pendingSpendMinor: e.pending, utilisationBp: utilisationBp(e.approved, c.budgetDailyMinor) }, update: { plannedMinor: c.budgetDailyMinor, approvedSpendMinor: e.approved, pendingSpendMinor: e.pending, utilisationBp: utilisationBp(e.approved, c.budgetDailyMinor) } });
    }
    const bp = utilisationBp(approved, c.budgetTotalMinor);
    const { payload: policy } = await this.campaigns.policy(c.market);
    // alerts: each threshold fires once per campaign. The conditional UPDATE appends the threshold only when it is not there yet, so two racing recomputes announce it once.
    for (const t of thresholdsToFire(bp, policy.budgetAlertThresholdsBp, c.thresholdsFiredBp)) {
      const n = await this.prisma.$executeRaw(Prisma.sql`UPDATE "GrowthCampaign" SET "thresholdsFiredBp" = array_append(COALESCE("thresholdsFiredBp", '{}'::int[]), ${t}::int) WHERE "id" = ${campaignId} AND NOT (${t}::int = ANY(COALESCE("thresholdsFiredBp", '{}'::int[])))`);
      if (n === 1) await this.outbox.enqueue(this.prisma, { type: 'CampaignBudgetThresholdReached', aggregateType: 'GrowthCampaign', aggregateId: campaignId, payload: { campaignId, market: c.market, thresholdBp: t, utilisationBp: bp, spentMinor: approved, budgetTotalMinor: c.budgetTotalMinor, at: now.toISOString() }, dedupeKey: `CampaignBudgetThresholdReached:${campaignId}:${t}` });
    }
    let action: 'NONE' | 'PAUSED_BUDGET' | 'PAUSED_DAILY' = 'NONE';
    if (c.status === 'ACTIVE') {
      if (budgetExhausted(approved, c.budgetTotalMinor)) { await this.campaigns.transition(SYSTEM('budget'), campaignId, 'PAUSED', { pauseReason: 'BUDGET', reasonCode: 'BUDGET', now }).catch(ignoreRace); action = 'PAUSED_BUDGET'; }
      else if (dailyCapReached(approvedToday, c.budgetDailyMinor)) { await this.campaigns.transition(SYSTEM('budget'), campaignId, 'PAUSED', { pauseReason: 'GUARDRAIL', reasonCode: 'DAILY_CAP', pausedUntil: nextDayBoundary(now, zone), now }).catch(ignoreRace); action = 'PAUSED_DAILY'; }
    }
    return { campaignId, approvedSpendMinor: approved, pendingSpendMinor: pending, approvedTodayMinor: approvedToday, utilisationBp: bp, action };
  }

  /** Daily utilisation rows of one campaign, oldest first. */
  async daily(campaignId: string) {
    return (await this.prisma.growthCampaignBudgetDaily.findMany({ where: { campaignId }, orderBy: { day: 'asc' } })).map((r) => ({ day: r.day.toISOString().slice(0, 10), plannedMinor: r.plannedMinor, approvedSpendMinor: r.approvedSpendMinor, pendingSpendMinor: r.pendingSpendMinor, utilisationBp: r.utilisationBp }));
  }
}
/** A concurrent transition (the scheduler, another recompute) already moved the campaign: the guardrail's goal is reached, nothing to do. */
const ignoreRace = (e: unknown) => { const code = (e as { code?: string; response?: { code?: string } })?.response?.code ?? (e as { code?: string }).code; if (code === 'CAMPAIGN_INVALID_TRANSITION' || code === 'CAMPAIGN_NOT_FOUND') return; throw e; };
