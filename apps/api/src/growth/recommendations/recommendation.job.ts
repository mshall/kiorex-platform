import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { cfg } from '../../common/config';
import { PrismaService } from '../../prisma/prisma.service';
import { FlagsService } from '../../control-plane/control-plane-public';
import { AI_RECOMMENDATIONS_FLAG } from '../automation/automation-flags';
import { RecommendationService } from './recommendation.service';

const INSTANCE = `${process.pid}-${randomUUID().slice(0, 8)}`;

/** Hourly: expire what is past its 14 days; once a day per market, build proposals (only while `growth.ai_recommendations` is effective). Heartbeat in GrowthJobRun. */
@Injectable()
export class RecommendationJob implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('recommendation-job');
  private timer?: NodeJS.Timeout;
  private lastDay = '';
  constructor(private readonly prisma: PrismaService, private readonly svc: RecommendationService, private readonly flags: FlagsService) {}
  onModuleInit() {
    if (!cfg().jobsEnabled) return;
    this.timer = setInterval(() => void this.runOnce().catch((e) => this.log.warn(`recommendation tick failed: ${(e as Error).message}`)), 3_600_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async runOnce(now = new Date(), market = 'EG') {
    const run = await this.prisma.growthJobRun.create({ data: { job: 'recommendations', instanceId: INSTANCE, startedAt: now } });
    try {
      const expired = await this.svc.expireDue(now);
      let created = 0; const day = now.toISOString().slice(0, 10);
      if (this.lastDay !== day && (await this.flags.isEnabled(AI_RECOMMENDATIONS_FLAG, { market }).catch(() => false))) { created = (await this.svc.generate({ sub: 'system:recommendations', kind: 'SYSTEM' }, market, now)).created; this.lastDay = day; }
      await this.prisma.growthJobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), rows: expired + created } });
      return { expired, created };
    } catch (e) {
      await this.prisma.growthJobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), error: (e as Error).message.slice(0, 300) } });
      throw e;
    }
  }
}
