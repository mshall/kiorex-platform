import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { cfg } from '../../common/config';
import { PrismaService } from '../../prisma/prisma.service';
import { JourneyRunnerService } from './journey-runner.service';
import { LifecycleStateService } from './lifecycle-state.service';
import { LifecycleTriggersService } from './lifecycle-triggers.service';

const INSTANCE = `${process.pid}-${randomUUID().slice(0, 8)}`;

/** One-minute tick: trigger scan, then due enrolments; a nightly stage reconcile in keyset batches (cursor kept in memory, a restart simply starts a new pass). Every run leaves a GrowthJobRun heartbeat. */
@Injectable()
export class LifecycleJob implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('lifecycle-job');
  private timer?: NodeJS.Timeout;
  private cursor: string | null = null;
  private lastReconcileDay = '';
  constructor(private readonly prisma: PrismaService, private readonly triggers: LifecycleTriggersService, private readonly runner: JourneyRunnerService, private readonly state: LifecycleStateService) {}
  onModuleInit() {
    if (!cfg().jobsEnabled) return;
    this.timer = setInterval(() => void this.runOnce().catch((e) => this.log.warn(`lifecycle tick failed: ${(e as Error).message}`)), 60_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async runOnce(now = new Date()) {
    const run = await this.prisma.growthJobRun.create({ data: { job: 'lifecycle', instanceId: INSTANCE, startedAt: now } });
    try {
      const triggers = await this.triggers.scan(now);
      const runs = await this.runner.runDue(now);
      const day = now.toISOString().slice(0, 10);
      let reconciled = 0;
      if (this.lastReconcileDay !== day || this.cursor !== null) { // one pass a day, a batch per tick until the keyset is exhausted
        const r = await this.state.reconcileBatch(this.cursor, 200, now); this.cursor = r.next; reconciled = r.processed;
        if (r.next === null) this.lastReconcileDay = day;
      }
      await this.prisma.growthJobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), rows: runs.picked + reconciled } });
      return { triggers, runs, reconciled };
    } catch (e) {
      await this.prisma.growthJobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), error: (e as Error).message.slice(0, 300) } });
      throw e;
    }
  }
}
