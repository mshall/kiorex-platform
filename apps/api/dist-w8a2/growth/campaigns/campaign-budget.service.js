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
exports.CampaignBudgetService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("../../prisma/generated/client");
const prisma_service_1 = require("../../prisma/prisma.service");
const outbox_public_1 = require("../../outbox/outbox-public");
const campaign_guardrails_1 = require("./campaign-guardrails");
const campaign_service_1 = require("./campaign.service");
const market_day_1 = require("./market-day");
let CampaignBudgetService = class CampaignBudgetService {
    prisma;
    campaigns;
    outbox;
    constructor(prisma, campaigns, outbox) {
        this.prisma = prisma;
        this.campaigns = campaigns;
        this.outbox = outbox;
    }
    async recompute(campaignId, now = new Date()) {
        const c = await this.prisma.growthCampaign.findUnique({ where: { id: campaignId } });
        if (!c)
            return null;
        const zone = (0, market_day_1.marketTimezone)(c.market);
        const today = (0, market_day_1.localDay)(now, zone);
        const rows = await this.prisma.growthSpendEntry.groupBy({ by: ['day', 'status'], where: { campaignId, status: { in: ['APPROVED', 'PENDING'] } }, _sum: { amountMinor: true } });
        const byDay = new Map();
        let approved = 0;
        let pending = 0;
        let approvedToday = 0;
        for (const r of rows) {
            const d = r.day.toISOString().slice(0, 10);
            const e = byDay.get(d) ?? { approved: 0, pending: 0 };
            const n = r._sum.amountMinor ?? 0;
            if (r.status === 'APPROVED') {
                e.approved += n;
                approved += n;
                if (d === today)
                    approvedToday += n;
            }
            else {
                e.pending += n;
                pending += n;
            }
            byDay.set(d, e);
        }
        for (const [d, e] of byDay) {
            const day = new Date(`${d}T00:00:00Z`);
            await this.prisma.growthCampaignBudgetDaily.upsert({ where: { campaignId_day: { campaignId, day } }, create: { campaignId, day, plannedMinor: c.budgetDailyMinor, approvedSpendMinor: e.approved, pendingSpendMinor: e.pending, utilisationBp: (0, campaign_guardrails_1.utilisationBp)(e.approved, c.budgetDailyMinor) }, update: { plannedMinor: c.budgetDailyMinor, approvedSpendMinor: e.approved, pendingSpendMinor: e.pending, utilisationBp: (0, campaign_guardrails_1.utilisationBp)(e.approved, c.budgetDailyMinor) } });
        }
        const bp = (0, campaign_guardrails_1.utilisationBp)(approved, c.budgetTotalMinor);
        const { payload: policy } = await this.campaigns.policy(c.market);
        for (const t of (0, campaign_guardrails_1.thresholdsToFire)(bp, policy.budgetAlertThresholdsBp, c.thresholdsFiredBp)) {
            const n = await this.prisma.$executeRaw(client_1.Prisma.sql `UPDATE "GrowthCampaign" SET "thresholdsFiredBp" = array_append(COALESCE("thresholdsFiredBp", '{}'::int[]), ${t}::int) WHERE "id" = ${campaignId} AND NOT (${t}::int = ANY(COALESCE("thresholdsFiredBp", '{}'::int[])))`);
            if (n === 1)
                await this.outbox.enqueue(this.prisma, { type: 'CampaignBudgetThresholdReached', aggregateType: 'GrowthCampaign', aggregateId: campaignId, payload: { campaignId, market: c.market, thresholdBp: t, utilisationBp: bp, spentMinor: approved, budgetTotalMinor: c.budgetTotalMinor, at: now.toISOString() }, dedupeKey: `CampaignBudgetThresholdReached:${campaignId}:${t}` });
        }
        let action = 'NONE';
        if (c.status === 'ACTIVE') {
            if ((0, campaign_guardrails_1.budgetExhausted)(approved, c.budgetTotalMinor)) {
                await this.campaigns.transition((0, campaign_service_1.SYSTEM)('budget'), campaignId, 'PAUSED', { pauseReason: 'BUDGET', reasonCode: 'BUDGET', now }).catch(ignoreRace);
                action = 'PAUSED_BUDGET';
            }
            else if ((0, campaign_guardrails_1.dailyCapReached)(approvedToday, c.budgetDailyMinor)) {
                await this.campaigns.transition((0, campaign_service_1.SYSTEM)('budget'), campaignId, 'PAUSED', { pauseReason: 'GUARDRAIL', reasonCode: 'DAILY_CAP', pausedUntil: (0, market_day_1.nextDayBoundary)(now, zone), now }).catch(ignoreRace);
                action = 'PAUSED_DAILY';
            }
        }
        return { campaignId, approvedSpendMinor: approved, pendingSpendMinor: pending, approvedTodayMinor: approvedToday, utilisationBp: bp, action };
    }
    async daily(campaignId) {
        return (await this.prisma.growthCampaignBudgetDaily.findMany({ where: { campaignId }, orderBy: { day: 'asc' } })).map((r) => ({ day: r.day.toISOString().slice(0, 10), plannedMinor: r.plannedMinor, approvedSpendMinor: r.approvedSpendMinor, pendingSpendMinor: r.pendingSpendMinor, utilisationBp: r.utilisationBp }));
    }
};
exports.CampaignBudgetService = CampaignBudgetService;
exports.CampaignBudgetService = CampaignBudgetService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, campaign_service_1.CampaignService, outbox_public_1.OutboxService])
], CampaignBudgetService);
const ignoreRace = (e) => { const code = e?.response?.code ?? e.code; if (code === 'CAMPAIGN_INVALID_TRANSITION' || code === 'CAMPAIGN_NOT_FOUND')
    return; throw e; };
//# sourceMappingURL=campaign-budget.service.js.map