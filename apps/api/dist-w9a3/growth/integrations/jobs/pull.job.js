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
exports.IntegrationPullJob = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("../../../common/config");
const prisma_service_1 = require("../../../prisma/prisma.service");
const growth_flags_1 = require("../../growth-flags");
const integration_service_1 = require("../integration.service");
const port_1 = require("../port");
let IntegrationPullJob = class IntegrationPullJob {
    svc;
    prisma;
    log = new common_1.Logger('growth-integration-pull');
    timer;
    constructor(svc, prisma) {
        this.svc = svc;
        this.prisma = prisma;
    }
    onModuleInit() {
        if (!(0, config_1.cfg)().jobsEnabled)
            return;
        this.timer = setInterval(() => void this.runOnce().catch((e) => this.log.warn(`pull job failed: ${e.message}`)), 3_600_000);
        this.timer.unref();
    }
    onModuleDestroy() { if (this.timer)
        clearInterval(this.timer); }
    async runOnce(now = new Date(), market = growth_flags_1.GROWTH_DEFAULT_MARKET) {
        const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
        const out = [];
        for (const kind of port_1.GROWTH_INTEGRATION_KINDS) {
            const s = await this.svc.setting(kind, market);
            if (s.mode === 'mock' && (0, config_1.cfg)().isProd) {
                out.push({ kind, status: 'SKIPPED', reason: 'MOCK_IN_PRODUCTION' });
                continue;
            }
            if (s.pullSchedule !== 'daily') {
                out.push({ kind, status: 'SKIPPED', reason: 'NOT_SCHEDULED' });
                continue;
            }
            const done = await this.prisma.growthIntegrationRun.count({ where: { market, kind, status: { in: ['OK', 'PARTIAL'] }, startedAt: { gte: today } } });
            if (done) {
                out.push({ kind, status: 'SKIPPED', reason: 'DONE_TODAY' });
                continue;
            }
            try {
                const r = await this.svc.run(kind, { market, trigger: 'SCHEDULE', actor: 'system:integration-pull', now });
                out.push({ kind, status: r.status, reason: r.reason });
            }
            catch (e) {
                out.push({ kind, status: 'FAILED', reason: e.code ?? 'ERROR' });
            }
        }
        await this.svc.purgeExpired(now);
        return out;
    }
};
exports.IntegrationPullJob = IntegrationPullJob;
exports.IntegrationPullJob = IntegrationPullJob = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [integration_service_1.IntegrationService, prisma_service_1.PrismaService])
], IntegrationPullJob);
//# sourceMappingURL=pull.job.js.map