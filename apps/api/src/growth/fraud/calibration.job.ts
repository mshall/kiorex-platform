import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { cfg as appCfg } from '../../common/config';
import { PrismaService } from '../../prisma/prisma.service';
import { GROWTH_CONFIG_KINDS } from '@kiorex/contracts';
import { GrowthConfigService } from '../config/growth-config.service';
import { FraudCaseService } from './case.service';
import { fairnessRows, proposeWeights, shadowReport, type RuleStats } from './calibration';
import { FraudConfigService } from './fraud-config.service';
import { FraudReviewQueueService } from './review-queue.service';
import type { FraudRuleId } from './signals';

const DAY = 86_400_000;

/** Daily: SLA sweep, case housekeeping, calibration counts, a DRAFT weight proposal (never applied); weekly: the fairness report. */
@Injectable()
export class FraudCalibrationService {
  constructor(private readonly prisma: PrismaService, private readonly cfg: FraudConfigService, private readonly configs: GrowthConfigService) {}

  /** Recompute the per-day, per-rule counts of the last `days` days (idempotent upsert). */
  async refresh(days = 30, now = new Date(), market = 'EG'): Promise<number> {
    const since = new Date(now.getTime() - days * DAY);
    const rows = await this.prisma.$queryRaw<{ day: Date; ruleId: string; flagged: bigint; confirmed: bigint; dismissed: bigint }[]>`
      SELECT date_trunc('day', s."at")::date AS day, s."ruleId",
             count(DISTINCT s."caseId") AS flagged,
             count(DISTINCT s."caseId") FILTER (WHERE c."decision" LIKE 'CONFIRM%') AS confirmed,
             count(DISTINCT s."caseId") FILTER (WHERE c."decision" = 'DISMISS') AS dismissed
      FROM "FraudCaseSignal" s JOIN "FraudCase" c ON c."id" = s."caseId"
      WHERE c."market" = ${market} AND s."at" >= ${since} GROUP BY 1, 2`;
    for (const r of rows) {
      const data = { flagged: Number(r.flagged), confirmed: Number(r.confirmed), dismissed: Number(r.dismissed) };
      await this.prisma.fraudCalibration.upsert({ where: { market_day_ruleId: { market, day: r.day, ruleId: r.ruleId } }, create: { market, day: r.day, ruleId: r.ruleId, ...data }, update: data });
    }
    return rows.length;
  }

  async stats(days = 90, now = new Date(), market = 'EG'): Promise<Partial<Record<FraudRuleId, RuleStats>>> {
    const rows = await this.prisma.fraudCalibration.findMany({ where: { market, day: { gte: new Date(now.getTime() - days * DAY) } } });
    const out: Partial<Record<FraudRuleId, RuleStats>> = {};
    for (const r of rows) { const s = (out[r.ruleId as FraudRuleId] ??= { flagged: 0, confirmed: 0, dismissed: 0 }); s.flagged += r.flagged; s.confirmed += r.confirmed; s.dismissed += r.dismissed; }
    return out;
  }

  async report(days = 90, now = new Date(), market = 'EG') {
    const cfg = await this.cfg.get(market);
    const rules = shadowReport(cfg, await this.stats(days, now, market));
    const wouldHold = await this.prisma.fraudCase.count({ where: { market, mode: 'SHADOW', band: 'HIGH', createdAt: { gte: new Date(now.getTime() - days * DAY) } } });
    return { days, enforce: cfg.enforce, configVersion: cfg.version, wouldHaveBeenHeld: wouldHold, rules };
  }

  /** A DRAFT FRAUD_RULES version with proposed weights, created by the system actor so a super admin (not the creator) must approve it. Never applied. */
  async propose(now = new Date(), market = 'EG') {
    const cfg = await this.cfg.get(market);
    const p = proposeWeights(cfg, await this.stats(90, now, market));
    if (!p.changes.length) return { proposed: false as const, changes: [] };
    // the newest version of a scope is the one in force, so a draft carries the WHOLE current configuration with only the weights changed (enforce flags, bands and actions are kept as they are)
    const { version: _v, ...current } = cfg;
    const full = { ...current, rules: Object.fromEntries(Object.entries(cfg.rules).map(([id, r]) => [id, { ...r, ...(p.payload.rules[id] ?? {}) }])) };
    let draftId: string | null = null;
    if ((GROWTH_CONFIG_KINDS as readonly string[]).includes('FRAUD_RULES')) {
      try { draftId = (await this.configs.createSystemDraft({ kind: 'FRAUD_RULES', scope: 'GLOBAL', payload: full as unknown as Record<string, unknown>, reason: 'calibration proposal from labelled outcomes' })).id; } catch { /* kept as an audit proposal below */ }
    }
    await this.prisma.auditLog.create({ data: { actor: 'system:fraud-calibration', action: 'growth.fraud.calibration_proposal', resource: 'FraudRules', resourceId: draftId ?? undefined, metadata: { changes: JSON.parse(JSON.stringify(p.changes)), draftId, persistedAsDraft: !!draftId } } });
    return { proposed: true as const, changes: p.changes, draftId };
  }

  /** Weekly aggregate HOLD rate by language and by governorate (k >= 10 masked). Never a person, never a health attribute. */
  async fairness(weekStart: Date, market = 'EG') {
    const end = new Date(weekStart.getTime() + 7 * DAY);
    const byLang = await this.prisma.$queryRaw<{ g: string; total: bigint; held: bigint }[]>`
      SELECT coalesce(p."preferredLocale", 'unknown') AS g, count(*) AS total,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "FraudCaseSignal" s JOIN "FraudCase" c ON c."id" = s."caseId" WHERE s."evidenceRef" = 'rel:' || r."id" AND c."band" = 'HIGH')) AS held
      FROM "ReferralRelationship" r LEFT JOIN "PatientProfile" p ON p."sub" = r."refereeSub"
      WHERE r."market" = ${market} AND r."createdAt" >= ${weekStart} AND r."createdAt" < ${end} GROUP BY 1`;
    const byCity = await this.prisma.$queryRaw<{ g: string; total: bigint; held: bigint }[]>`
      SELECT coalesce(pr."governorate", 'unknown') AS g, count(*) AS total,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "FraudCaseSignal" s JOIN "FraudCase" c ON c."id" = s."caseId" WHERE s."evidenceRef" = 'rel:' || r."id" AND c."band" = 'HIGH')) AS held
      FROM "ReferralRelationship" r JOIN "BookingIntent" b ON b."id" = r."firstBookingId" JOIN "Provider" pr ON pr."id" = b."providerId"
      WHERE r."market" = ${market} AND r."createdAt" >= ${weekStart} AND r."createdAt" < ${end} GROUP BY 1`;
    const conv = (r: { g: string; total: bigint; held: bigint }[]) => r.map((x) => ({ group: x.g, total: Number(x.total), held: Number(x.held) }));
    return { weekStart: weekStart.toISOString().slice(0, 10), language: fairnessRows(conv(byLang)), city: fairnessRows(conv(byCity)), note: 'Aggregates only; groups under 10 are masked. A flagged group is a prompt for a human review of the rules, never an automatic change.' };
  }
}

@Injectable()
export class FraudJob implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('fraud-job');
  private timer?: NodeJS.Timeout;
  constructor(private readonly queue: FraudReviewQueueService, private readonly cases: FraudCaseService, private readonly cal: FraudCalibrationService, private readonly cfg: FraudConfigService) {}
  onModuleInit() {
    if (!appCfg().jobsEnabled) return;
    this.timer = setInterval(() => void this.run().catch((e) => this.log.warn(`fraud job failed: ${(e as Error).message}`)), 60 * 60_000); this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  /** Hourly (idempotent): SLA breaches, housekeeping, calibration counts; the proposal runs once a day. */
  async run(now = new Date()) {
    const cfg = await this.cfg.get();
    const sla = await this.queue.slaSweep(now); const house = await this.cases.housekeeping(cfg, now); const rows = await this.cal.refresh(30, now);
    const proposal = now.getUTCHours() === 3 ? await this.cal.propose(now) : null;
    return { sla, house, calibrationRows: rows, proposal };
  }
}
