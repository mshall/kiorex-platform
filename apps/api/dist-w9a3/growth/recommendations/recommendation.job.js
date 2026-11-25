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
exports.RecommendationJob = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const config_1 = require("../../common/config");
const prisma_service_1 = require("../../prisma/prisma.service");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const automation_flags_1 = require("../automation/automation-flags");
const recommendation_service_1 = require("./recommendation.service");
const market_core_public_1 = require("../../market/market-core-public");
const INSTANCE = `${process.pid}-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`;
let RecommendationJob = class RecommendationJob {
    prisma;
    svc;
    flags;
    log = new common_1.Logger('recommendation-job');
    timer;
    lastDay = '';
    constructor(prisma, svc, flags) {
        this.prisma = prisma;
        this.svc = svc;
        this.flags = flags;
    }
    onModuleInit() {
        if (!(0, config_1.cfg)().jobsEnabled)
            return;
        this.timer = setInterval(() => void this.runOnce().catch((e) => this.log.warn(`recommendation tick failed: ${e.message}`)), 3_600_000);
        this.timer.unref();
    }
    onModuleDestroy() { if (this.timer)
        clearInterval(this.timer); }
    async runOnce(now = new Date(), market = market_core_public_1.DEFAULT_MARKET) {
        const run = await this.prisma.growthJobRun.create({ data: { job: 'recommendations', instanceId: INSTANCE, startedAt: now } });
        try {
            const expired = await this.svc.expireDue(now);
            let created = 0;
            const day = now.toISOString().slice(0, 10);
            if (this.lastDay !== day && (await this.flags.isEnabled(automation_flags_1.AI_RECOMMENDATIONS_FLAG, { market }).catch(() => false))) {
                created = (await this.svc.generate({ sub: 'system:recommendations', kind: 'SYSTEM' }, market, now)).created;
                this.lastDay = day;
            }
            await this.prisma.growthJobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), rows: expired + created } });
            return { expired, created };
        }
        catch (e) {
            await this.prisma.growthJobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), error: e.message.slice(0, 300) } });
            throw e;
        }
    }
};
exports.RecommendationJob = RecommendationJob;
exports.RecommendationJob = RecommendationJob = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, recommendation_service_1.RecommendationService, control_plane_public_1.FlagsService])
], RecommendationJob);
//# sourceMappingURL=recommendation.job.js.map