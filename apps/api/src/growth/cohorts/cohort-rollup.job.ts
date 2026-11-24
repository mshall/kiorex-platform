import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { cfg } from '../../common/config';
import { FlagsService } from '../../control-plane/control-plane-public';
import { DEFAULT_MARKET } from '../../market/market-core-public';
import { PrismaService } from '../../prisma/prisma.service';
import { CohortService } from './cohort.service';

const INSTANCE = `${process.pid}-${randomUUID().slice(0, 8)}`;
const JOB = 'cohorts-rollup';
export const COHORTS_FLAG_KEY = 'growth.cohorts_ltv';

/** Daily recompute of the last 24 months (idempotent: the window is replaced). Skipped when `growth.cohorts_ltv` is OFF for the market. Runs only when jobs are enabled; writes a GrowthJobRun heartbeat. */
@Injectable()
export class CohortRollupJob implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(JOB);
  private timer?: NodeJS.Timeout;
  constructor(private readonly cohorts: CohortService, private readonly prisma: PrismaService, private readonly flags: FlagsService) {}
  onModuleInit() {
    if (!cfg().jobsEnabled) return;
    this.timer = setInterval(() => void this.runOnce().catch((e) => this.log.warn(`rollup failed: ${e.message}`)), 24 * 3_600_000); this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  async runOnce(market = DEFAULT_MARKET, months = 24) {
    if (!(await this.flags.isEnabled(COHORTS_FLAG_KEY, { market }).catch(() => false))) return { skipped: true as const };
    const run = await this.prisma.growthJobRun.create({ data: { job: JOB, instanceId: INSTANCE } });
    try { const r = await this.cohorts.rollup({ market, months }); await this.prisma.growthJobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), rows: Number(r.estimates ?? 0) } }); return r; }
    catch (e) { await this.prisma.growthJobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), error: (e as Error).message.slice(0, 300) } }); throw e; }
  }
}
