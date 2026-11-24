import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { cfg } from '../../common/config';
import { FlagsService } from '../../control-plane/control-plane-public';
import { OutboxService } from '../../outbox/outbox-public';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '../../prisma/generated/client';
import { GROWTH_FLAG } from '../growth-flags';
import { ExperimentRollupService } from './experiment-rollup.service';
import { ExperimentService, type Actor } from './experiment.service';
import type { GuardrailSpec, VariantSpec } from './experiment.types';
import { evaluateExperiment } from './stats/evaluate';

const INSTANCE = `${process.pid}-${randomUUID().slice(0, 8)}`;
const SYSTEM: Actor = { sub: 'system:experiment-evaluator', kind: 'SYSTEM' };

/**
 * Hourly evaluation (GRW-P3-A). For every RUNNING experiment: rebuild the daily rollup, evaluate, append a result snapshot when the verdict or the day changed, and apply the stop rules
 * (SRM, guardrail breach, end date with too little sample, flag OFF = kill switch) or conclude. Writes a GrowthJobRun heartbeat. `now` is injectable so tests time-travel.
 * Safe on several instances: a stop or conclusion re-checks the state in one transaction (a second runner gets EXPERIMENT_INVALID_TRANSITION and skips).
 */
@Injectable()
export class ExperimentEvaluatorJob implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('experiment-evaluator');
  private timer?: NodeJS.Timeout;
  constructor(private readonly prisma: PrismaService, private readonly svc: ExperimentService, private readonly rollup: ExperimentRollupService, private readonly flags: FlagsService, private readonly outbox: OutboxService) {}
  onModuleInit() { if (!cfg().jobsEnabled) return; this.timer = setInterval(() => void this.runOnce().catch((e) => this.log.warn(`evaluator failed: ${e.message}`)), 3600_000); this.timer.unref(); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async runOnce(now = new Date()) {
    const run = await this.prisma.growthJobRun.create({ data: { job: 'experiment-evaluator', instanceId: INSTANCE, startedAt: now } });
    const out = { evaluated: 0, stopped: 0, concluded: 0, killed: 0, snapshots: 0, errors: 0 };
    try {
      for (const e of await this.prisma.growthExperiment.findMany({ where: { status: 'RUNNING' }, orderBy: { startedAt: 'asc' }, take: 200 })) {
        try {
          if (!(await this.flags.isEnabled(GROWTH_FLAG.EXPERIMENTS, { market: e.market }).catch(() => false))) { await this.svc.stop(SYSTEM, e.id, 'KILL_SWITCH: growth.experiments is OFF', now, 'SYSTEM'); out.killed++; continue; }
          await this.rollup.rollup(e.id, now);
          const r = evaluateExperiment({ variants: e.variants as unknown as VariantSpec[], allocationBp: e.allocationBp, mode: e.mode as 'FIXED' | 'SEQUENTIAL', alphaBp: e.alphaBp, minSample: e.minSample, plannedDays: e.plannedDays, guardrails: e.guardrails as unknown as GuardrailSpec[], startedAt: e.startedAt!, now, rows: await this.rollup.rows(e.id) });
          out.evaluated++;
          const last = await this.prisma.growthExperimentResult.findFirst({ where: { experimentId: e.id }, orderBy: { computedAt: 'desc' } });
          if (!last || last.verdict !== r.verdict || last.dayNumber !== r.dayNumber) {
            await this.prisma.growthExperimentResult.create({ data: { experimentId: e.id, computedAt: now, dayNumber: r.dayNumber, verdict: r.verdict, srmP: r.srm.pValue, payload: JSON.parse(JSON.stringify({ ...r, hidden: r.hidden })) as Prisma.InputJsonValue } });
            out.snapshots++;
          }
          if (r.stopReason === 'SRM') {
            await this.prisma.$transaction(async (tx) => {
              await tx.growthExperimentEvent.create({ data: { experimentId: e.id, kind: 'SRM', actor: SYSTEM.sub, reason: `p=${r.srm.pValue.toExponential(2)}`, diff: { chi2: r.srm.chi2, observed: r.arms.map((a) => a.n) } as Prisma.InputJsonValue } });
              await this.outbox.enqueue(tx, { type: 'ExperimentSrmDetected', aggregateType: 'GrowthExperiment', aggregateId: e.id, payload: { experimentId: e.id, market: e.market, key: e.key, pValue: r.srm.pValue, at: now.toISOString() }, dedupeKey: `ExperimentSrmDetected:${e.id}` });
            });
            await this.svc.stop(SYSTEM, e.id, `SRM_DETECTED: p=${r.srm.pValue.toExponential(2)}`, now, 'SYSTEM'); out.stopped++;
          } else if (r.stopReason === 'GUARDRAIL') {
            await this.prisma.growthExperimentEvent.create({ data: { experimentId: e.id, kind: 'GUARDRAIL', actor: SYSTEM.sub, reason: r.blockers.join(','), diff: r.guardrails as unknown as Prisma.InputJsonValue } });
            await this.svc.stop(SYSTEM, e.id, `GUARDRAIL_BREACH: ${r.blockers.join(',')}`, now, 'SYSTEM'); out.stopped++;
          } else if (r.stopReason === 'END_DATE_INSUFFICIENT_SAMPLE') { await this.svc.stop(SYSTEM, e.id, 'END_DATE_INSUFFICIENT_SAMPLE', now, 'SYSTEM'); out.stopped++; }
          else if (r.verdict === 'WINNER' || r.verdict === 'NO_WINNER') { await this.svc.conclude(SYSTEM, e.id, r.verdict, now); out.concluded++; }
        } catch (err) {
          const code = (err as { response?: { code?: string } }).response?.code;
          if (code === 'EXPERIMENT_INVALID_TRANSITION') continue; // another runner got there first
          out.errors++; this.log.warn(`experiment ${e.id}: ${(err as Error).message}`);
        }
      }
      await this.prisma.growthJobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), rows: out.evaluated } });
      return out;
    } catch (err) { await this.prisma.growthJobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), error: String((err as Error).message).slice(0, 300) } }).catch(() => undefined); throw err; }
  }
}
