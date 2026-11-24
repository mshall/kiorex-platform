import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { cfg } from '../../common/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AutomationTriggersService } from './automation-triggers.service';

const INSTANCE = `${process.pid}-${randomUUID().slice(0, 8)}`;

/** One-minute trigger scan for published journeys. The due enrolments themselves are run by the P2-E lifecycle job (one executor). Leaves a GrowthJobRun heartbeat per run. */
@Injectable()
export class AutomationJob implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('automation-job');
  private timer?: NodeJS.Timeout;
  constructor(private readonly prisma: PrismaService, private readonly triggers: AutomationTriggersService) {}
  onModuleInit() {
    if (!cfg().jobsEnabled) return;
    this.timer = setInterval(() => void this.runOnce().catch((e) => this.log.warn(`automation tick failed: ${(e as Error).message}`)), 60_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async runOnce(now = new Date()) {
    const run = await this.prisma.growthJobRun.create({ data: { job: 'automation', instanceId: INSTANCE, startedAt: now } });
    try {
      const r = await this.triggers.scan(now);
      await this.prisma.growthJobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), rows: r.enrolled ?? 0 } });
      return r;
    } catch (e) {
      await this.prisma.growthJobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), error: (e as Error).message.slice(0, 300) } });
      throw e;
    }
  }
}
