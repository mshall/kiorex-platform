import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { cfg } from '../../common/config';
import { SeoIndexationService } from './indexation.service';
import { SeoAutomationService } from './seo-automation.service';
import { SeoVitalsService } from './vitals.service';

/** Nightly (idempotent): quality gate and link builder, vitals ingestion and budget check, indexation snapshot. The publish and slug-change triggers call `SeoAutomationService.run` directly. */
@Injectable()
export class SeoAutomationJob implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('seo-automation-job');
  private timer?: NodeJS.Timeout; private last = '';
  constructor(private readonly seo: SeoAutomationService, private readonly vitals: SeoVitalsService, private readonly indexation: SeoIndexationService) {}
  onModuleInit() {
    if (!cfg().jobsEnabled) return;
    this.timer = setInterval(() => void this.tick().catch((e) => this.log.warn(`seo job failed: ${(e as Error).message}`)), 30 * 60_000); this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  /** Runs once per UTC day, after 02:00. */
  async tick(now = new Date()) {
    const day = now.toISOString().slice(0, 10);
    if (now.getUTCHours() < 2 || this.last === day) return null;
    this.last = day; return this.run(now);
  }
  async run(now = new Date()) {
    const gate = await this.seo.run({ actor: 'system:seo-automation-job' });
    const lab = await this.vitals.ingestLab(undefined, now); const field = await this.vitals.ingestField(now); const check = await this.vitals.check(now);
    const idx = await this.indexation.snapshot(now);
    return { gate, lab, field, breaches: check.breaches.length, indexation: idx.length };
  }
}
