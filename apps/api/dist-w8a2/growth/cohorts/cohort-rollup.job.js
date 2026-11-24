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
exports.CohortRollupJob = exports.COHORTS_FLAG_KEY = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const config_1 = require("../../common/config");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const market_core_public_1 = require("../../market/market-core-public");
const prisma_service_1 = require("../../prisma/prisma.service");
const cohort_service_1 = require("./cohort.service");
const INSTANCE = `${process.pid}-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`;
const JOB = 'cohorts-rollup';
exports.COHORTS_FLAG_KEY = 'growth.cohorts_ltv';
let CohortRollupJob = class CohortRollupJob {
    cohorts;
    prisma;
    flags;
    log = new common_1.Logger(JOB);
    timer;
    constructor(cohorts, prisma, flags) {
        this.cohorts = cohorts;
        this.prisma = prisma;
        this.flags = flags;
    }
    onModuleInit() {
        if (!(0, config_1.cfg)().jobsEnabled)
            return;
        this.timer = setInterval(() => void this.runOnce().catch((e) => this.log.warn(`rollup failed: ${e.message}`)), 24 * 3_600_000);
        this.timer.unref();
    }
    onModuleDestroy() { if (this.timer)
        clearInterval(this.timer); }
    async runOnce(market = market_core_public_1.DEFAULT_MARKET, months = 24) {
        if (!(await this.flags.isEnabled(exports.COHORTS_FLAG_KEY, { market }).catch(() => false)))
            return { skipped: true };
        const run = await this.prisma.growthJobRun.create({ data: { job: JOB, instanceId: INSTANCE } });
        try {
            const r = await this.cohorts.rollup({ market, months });
            await this.prisma.growthJobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), rows: Number(r.estimates ?? 0) } });
            return r;
        }
        catch (e) {
            await this.prisma.growthJobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), error: e.message.slice(0, 300) } });
            throw e;
        }
    }
};
exports.CohortRollupJob = CohortRollupJob;
exports.CohortRollupJob = CohortRollupJob = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [cohort_service_1.CohortService, prisma_service_1.PrismaService, control_plane_public_1.FlagsService])
], CohortRollupJob);
//# sourceMappingURL=cohort-rollup.job.js.map