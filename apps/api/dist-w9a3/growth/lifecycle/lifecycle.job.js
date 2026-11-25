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
exports.LifecycleJob = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const config_1 = require("../../common/config");
const prisma_service_1 = require("../../prisma/prisma.service");
const journey_runner_service_1 = require("./journey-runner.service");
const lifecycle_state_service_1 = require("./lifecycle-state.service");
const lifecycle_triggers_service_1 = require("./lifecycle-triggers.service");
const INSTANCE = `${process.pid}-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`;
let LifecycleJob = class LifecycleJob {
    prisma;
    triggers;
    runner;
    state;
    log = new common_1.Logger('lifecycle-job');
    timer;
    cursor = null;
    lastReconcileDay = '';
    constructor(prisma, triggers, runner, state) {
        this.prisma = prisma;
        this.triggers = triggers;
        this.runner = runner;
        this.state = state;
    }
    onModuleInit() {
        if (!(0, config_1.cfg)().jobsEnabled)
            return;
        this.timer = setInterval(() => void this.runOnce().catch((e) => this.log.warn(`lifecycle tick failed: ${e.message}`)), 60_000);
        this.timer.unref();
    }
    onModuleDestroy() { if (this.timer)
        clearInterval(this.timer); }
    async runOnce(now = new Date()) {
        const run = await this.prisma.growthJobRun.create({ data: { job: 'lifecycle', instanceId: INSTANCE, startedAt: now } });
        try {
            const triggers = await this.triggers.scan(now);
            const runs = await this.runner.runDue(now);
            const day = now.toISOString().slice(0, 10);
            let reconciled = 0;
            if (this.lastReconcileDay !== day || this.cursor !== null) {
                const r = await this.state.reconcileBatch(this.cursor, 200, now);
                this.cursor = r.next;
                reconciled = r.processed;
                if (r.next === null)
                    this.lastReconcileDay = day;
            }
            await this.prisma.growthJobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), rows: runs.picked + reconciled } });
            return { triggers, runs, reconciled };
        }
        catch (e) {
            await this.prisma.growthJobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), error: e.message.slice(0, 300) } });
            throw e;
        }
    }
};
exports.LifecycleJob = LifecycleJob;
exports.LifecycleJob = LifecycleJob = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, lifecycle_triggers_service_1.LifecycleTriggersService, journey_runner_service_1.JourneyRunnerService, lifecycle_state_service_1.LifecycleStateService])
], LifecycleJob);
//# sourceMappingURL=lifecycle.job.js.map