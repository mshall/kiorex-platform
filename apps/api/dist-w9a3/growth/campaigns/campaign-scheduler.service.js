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
exports.CampaignSchedulerService = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const config_1 = require("../../common/config");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const prisma_service_1 = require("../../prisma/prisma.service");
const growth_flags_1 = require("../growth-flags");
const campaign_budget_service_1 = require("./campaign-budget.service");
const campaign_service_1 = require("./campaign.service");
const INSTANCE = `${process.pid}-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`;
let CampaignSchedulerService = class CampaignSchedulerService {
    prisma;
    campaigns;
    budget;
    flags;
    log = new common_1.Logger('campaign-scheduler');
    timer;
    constructor(prisma, campaigns, budget, flags) {
        this.prisma = prisma;
        this.campaigns = campaigns;
        this.budget = budget;
        this.flags = flags;
    }
    onModuleInit() {
        if (!(0, config_1.cfg)().jobsEnabled)
            return;
        this.timer = setInterval(() => void this.runOnce().catch((e) => this.log.warn(`campaign scheduler failed: ${e.message}`)), 60_000);
        this.timer.unref();
    }
    onModuleDestroy() { if (this.timer)
        clearInterval(this.timer); }
    async runOnce(now = new Date()) {
        const run = await this.prisma.growthJobRun.create({ data: { job: 'campaign-scheduler', instanceId: INSTANCE, startedAt: now } });
        const out = { activated: 0, resumed: 0, completed: 0, archived: 0, recomputed: 0, skipped: 0, errors: 0 };
        try {
            const open = await this.prisma.growthCampaign.findMany({ where: { status: { in: ['SCHEDULED', 'ACTIVE', 'PAUSED'] } }, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], take: 500 });
            const on = new Map();
            for (const c of open) {
                if (!on.has(c.market))
                    on.set(c.market, await this.flags.isEnabled(growth_flags_1.GROWTH_FLAG.CAMPAIGNS, { market: c.market }).catch(() => false));
                if (!on.get(c.market)) {
                    out.skipped++;
                    continue;
                }
                const sys = (0, campaign_service_1.SYSTEM)('scheduler');
                try {
                    if (c.status === 'SCHEDULED' && c.startsAt && c.startsAt <= now) {
                        if (c.endsAt && c.endsAt <= now) {
                            await this.campaigns.transition(sys, c.id, 'ARCHIVED', { reasonCode: 'WINDOW_MISSED', now });
                            out.archived++;
                        }
                        else {
                            await this.campaigns.transition(sys, c.id, 'ACTIVE', { reasonCode: 'SCHEDULED_START', now });
                            out.activated++;
                        }
                    }
                    else if (c.status === 'PAUSED' && c.pauseReason === 'GUARDRAIL' && c.pausedUntil && c.pausedUntil <= now && !(c.autoExpiresAt && c.autoExpiresAt <= now)) {
                        await this.campaigns.transition(sys, c.id, 'ACTIVE', { reasonCode: 'DAILY_RESUME', now });
                        out.resumed++;
                    }
                    else if ((c.status === 'ACTIVE' || c.status === 'PAUSED') && c.autoExpiresAt && c.autoExpiresAt <= now) {
                        await this.campaigns.transition(sys, c.id, 'COMPLETED', { reasonCode: 'EXPIRED', now });
                        out.completed++;
                    }
                }
                catch (e) {
                    const code = e.response?.code;
                    if (code === 'CAMPAIGN_INVALID_TRANSITION' || code === 'CAMPAIGN_NOT_FOUND') {
                        out.skipped++;
                        continue;
                    }
                    out.errors++;
                    this.log.warn(`campaign ${c.id}: ${e.message}`);
                }
            }
            for (const c of await this.prisma.growthCampaign.findMany({ where: { status: 'ACTIVE' }, select: { id: true, market: true }, take: 500 }))
                if (on.get(c.market) !== false) {
                    await this.budget.recompute(c.id, now);
                    out.recomputed++;
                }
            await this.prisma.growthJobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), rows: out.activated + out.resumed + out.completed + out.archived } });
            return out;
        }
        catch (e) {
            await this.prisma.growthJobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), error: String(e.message).slice(0, 300) } });
            throw e;
        }
    }
};
exports.CampaignSchedulerService = CampaignSchedulerService;
exports.CampaignSchedulerService = CampaignSchedulerService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, campaign_service_1.CampaignService, campaign_budget_service_1.CampaignBudgetService, control_plane_public_1.FlagsService])
], CampaignSchedulerService);
//# sourceMappingURL=campaign-scheduler.service.js.map