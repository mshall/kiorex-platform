"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExperimentEvaluatorJob = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const config_1 = require("../../common/config");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const outbox_public_1 = require("../../outbox/outbox-public");
const prisma_service_1 = require("../../prisma/prisma.service");
const growth_flags_1 = require("../growth-flags");
const experiment_rollup_service_1 = require("./experiment-rollup.service");
const experiment_service_1 = require("./experiment.service");
const evaluate_1 = require("./stats/evaluate");
const INSTANCE = `${process.pid}-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`;
const SYSTEM = { sub: 'system:experiment-evaluator', kind: 'SYSTEM' };
let ExperimentEvaluatorJob = class ExperimentEvaluatorJob {
    prisma;
    svc;
    rollup;
    flags;
    outbox;
    log = new common_1.Logger('experiment-evaluator');
    timer;
    constructor(prisma, svc, rollup, flags, outbox) {
        this.prisma = prisma;
        this.svc = svc;
        this.rollup = rollup;
        this.flags = flags;
        this.outbox = outbox;
    }
    onModuleInit() { if (!(0, config_1.cfg)().jobsEnabled)
        return; this.timer = setInterval(() => void this.runOnce().catch((e) => this.log.warn(`evaluator failed: ${e.message}`)), 3600_000); this.timer.unref(); }
    onModuleDestroy() { if (this.timer)
        clearInterval(this.timer); }
    async runOnce(now = new Date()) {
        const run = await this.prisma.growthJobRun.create({ data: { job: 'experiment-evaluator', instanceId: INSTANCE, startedAt: now } });
        const out = { evaluated: 0, stopped: 0, concluded: 0, killed: 0, snapshots: 0, errors: 0 };
        try {
            for (const e of await this.prisma.growthExperiment.findMany({ where: { status: 'RUNNING' }, orderBy: { startedAt: 'asc' }, take: 200 })) {
                try {
                    if (!(await this.flags.isEnabled(growth_flags_1.GROWTH_FLAG.EXPERIMENTS, { market: e.market }).catch(() => false))) {
                        await this.svc.stop(SYSTEM, e.id, 'KILL_SWITCH: growth.experiments is OFF', now, 'SYSTEM');
                        out.killed++;
                        continue;
                    }
                    await this.rollup.rollup(e.id, now);
                    const r = (0, evaluate_1.evaluateExperiment)({ variants: e.variants, allocationBp: e.allocationBp, mode: e.mode, alphaBp: e.alphaBp, minSample: e.minSample, plannedDays: e.plannedDays, guardrails: e.guardrails, startedAt: e.startedAt, now, rows: await this.rollup.rows(e.id) });
                    out.evaluated++;
                    const last = await this.prisma.growthExperimentResult.findFirst({ where: { experimentId: e.id }, orderBy: { computedAt: 'desc' } });
                    if (!last || last.verdict !== r.verdict || last.dayNumber !== r.dayNumber) {
                        await this.prisma.growthExperimentResult.create({ data: { experimentId: e.id, computedAt: now, dayNumber: r.dayNumber, verdict: r.verdict, srmP: r.srm.pValue, payload: JSON.parse(JSON.stringify({ ...r, hidden: r.hidden })) } });
                        out.snapshots++;
                    }
                    if (r.stopReason === 'SRM') {
                        await this.prisma.$transaction(async (tx) => {
                            await tx.growthExperimentEvent.create({ data: { experimentId: e.id, kind: 'SRM', actor: SYSTEM.sub, reason: `p=${r.srm.pValue.toExponential(2)}`, diff: { chi2: r.srm.chi2, observed: r.arms.map((a) => a.n) } } });
                            await this.outbox.enqueue(tx, { type: 'ExperimentSrmDetected', aggregateType: 'GrowthExperiment', aggregateId: e.id, payload: { experimentId: e.id, market: e.market, key: e.key, pValue: r.srm.pValue, at: now.toISOString() }, dedupeKey: `ExperimentSrmDetected:${e.id}` });
                        });
                        await this.svc.stop(SYSTEM, e.id, `SRM_DETECTED: p=${r.srm.pValue.toExponential(2)}`, now, 'SYSTEM');
                        out.stopped++;
                    }
                    else if (r.stopReason === 'GUARDRAIL') {
                        await this.prisma.growthExperimentEvent.create({ data: { experimentId: e.id, kind: 'GUARDRAIL', actor: SYSTEM.sub, reason: r.blockers.join(','), diff: r.guardrails } });
                        await this.svc.stop(SYSTEM, e.id, `GUARDRAIL_BREACH: ${r.blockers.join(',')}`, now, 'SYSTEM');
                        out.stopped++;
                    }
                    else if (r.stopReason === 'END_DATE_INSUFFICIENT_SAMPLE') {
                        await this.svc.stop(SYSTEM, e.id, 'END_DATE_INSUFFICIENT_SAMPLE', now, 'SYSTEM');
                        out.stopped++;
                    }
                    else if (r.verdict === 'WINNER' || r.verdict === 'NO_WINNER') {
                        await this.svc.conclude(SYSTEM, e.id, r.verdict, now);
                        out.concluded++;
                    }
                }
                catch (err) {
                    const code = err.response?.code;
                    if (code === 'EXPERIMENT_INVALID_TRANSITION')
                        continue;
                    out.errors++;
                    this.log.warn(`experiment ${e.id}: ${err.message}`);
                }
            }
            await this.prisma.growthJobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), rows: out.evaluated } });
            return out;
        }
        catch (err) {
            await this.prisma.growthJobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), error: String(err.message).slice(0, 300) } }).catch(() => undefined);
            throw err;
        }
    }
};
exports.ExperimentEvaluatorJob = ExperimentEvaluatorJob;
exports.ExperimentEvaluatorJob = ExperimentEvaluatorJob = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, experiment_service_1.ExperimentService, experiment_rollup_service_1.ExperimentRollupService, control_plane_public_1.FlagsService, outbox_public_1.OutboxService])
], ExperimentEvaluatorJob);
//# sourceMappingURL=experiment-evaluator.job.js.map