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
exports.ModelRollupJob = void 0;
const market_core_public_1 = require("../../market/market-core-public");
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const config_1 = require("../../common/config");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const prisma_service_1 = require("../../prisma/prisma.service");
const growth_flags_1 = require("../growth-flags");
const model_report_service_1 = require("./model-report.service");
const INSTANCE = `${process.pid}-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`;
const JOB = 'attribution-models-rollup';
let ModelRollupJob = class ModelRollupJob {
    reports;
    prisma;
    flags;
    log = new common_1.Logger(JOB);
    timer;
    constructor(reports, prisma, flags) {
        this.reports = reports;
        this.prisma = prisma;
        this.flags = flags;
    }
    onModuleInit() {
        if (!(0, config_1.cfg)().jobsEnabled)
            return;
        this.timer = setInterval(() => void this.runOnce().catch((e) => this.log.warn(`rollup failed: ${e.message}`)), 3_600_000);
        this.timer.unref();
    }
    onModuleDestroy() { if (this.timer)
        clearInterval(this.timer); }
    async runOnce(market = market_core_public_1.DEFAULT_MARKET, days = 3) {
        if (!(await this.flags.isEnabled(growth_flags_1.GROWTH_FLAG.ATTRIBUTION, { market }).catch(() => false)))
            return { skipped: true };
        const run = await this.prisma.growthJobRun.create({ data: { job: JOB, instanceId: INSTANCE } });
        try {
            const r = await this.reports.rollup({ market, days });
            await this.prisma.growthJobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), rows: r.conversions } });
            return r;
        }
        catch (e) {
            await this.prisma.growthJobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), error: e.message.slice(0, 300) } });
            throw e;
        }
    }
};
exports.ModelRollupJob = ModelRollupJob;
exports.ModelRollupJob = ModelRollupJob = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [model_report_service_1.ModelReportService, prisma_service_1.PrismaService, control_plane_public_1.FlagsService])
], ModelRollupJob);
//# sourceMappingURL=model-rollup.job.js.map