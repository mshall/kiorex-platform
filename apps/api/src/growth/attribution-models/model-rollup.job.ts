import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { cfg } from '../../common/config';
import { FlagsService } from '../../control-plane/control-plane-public';
import { PrismaService } from '../../prisma/prisma.service';
import { GROWTH_FLAG } from '../growth-flags';
import { ModelReportService } from './model-report.service';

const INSTANCE = `${process.pid}-${randomUUID().slice(0, 8)}`;
const JOB = 'attribution-models-rollup';

/** Hourly recompute of the last 3 market days. Idempotent (the range is replaced), skipped when `growth.attribution` is OFF for the market, writes a GrowthJobRun heartbeat. Runs only when jobs are enabled. */
@Injectable()
export class ModelRollupJob implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(JOB);
  private timer?: NodeJS.Timeout;
  constructor(private readonly reports: ModelReportService, private readonly prisma: PrismaService, private readonly flags: FlagsService) {}
  onModuleInit() {
    if (!cfg().jobsEnabled) return;
    this.timer = setInterval(() => void this.runOnce().catch((e) => this.log.warn(`rollup failed: ${e.message}`)), 3_600_000); this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  async runOnce(market = 'EG', days = 3) {
    if (!(await this.flags.isEnabled(GROWTH_FLAG.ATTRIBUTION, { market }).catch(() => false))) return { skipped: true as const };
    const run = await this.prisma.growthJobRun.create({ data: { job: JOB, instanceId: INSTANCE } });
    try { const r = await this.reports.rollup({ market, days }); await this.prisma.growthJobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), rows: r.conversions } }); return r; }
    catch (e) { await this.prisma.growthJobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), error: (e as Error).message.slice(0, 300) } }); throw e; }
  }
}
