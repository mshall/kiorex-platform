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
exports.GrowthSpendService = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const errors_1 = require("../../common/errors");
const prisma_service_1 = require("../../prisma/prisma.service");
const growth_flags_1 = require("../growth-flags");
const campaign_guardrails_1 = require("../campaigns/campaign-guardrails");
const campaign_budget_service_1 = require("../campaigns/campaign-budget.service");
const market_day_1 = require("../campaigns/market-day");
const growth_errors_1 = require("../growth-errors");
const TOKEN = /^[A-Za-z0-9_.:-]{0,64}$/;
const SOURCE_KINDS = ['', 'ORGANIC_SEARCH', 'CAMPAIGN', 'REFERRAL', 'WHATSAPP', 'DIRECT', 'PROVIDER_LINK', 'PROVIDER_QR', 'WIDGET', 'OFFLINE'];
const MAX_MINOR = 1_000_000_000;
let GrowthSpendService = class GrowthSpendService {
    prisma;
    moduleRef;
    constructor(prisma, moduleRef) {
        this.prisma = prisma;
        this.moduleRef = moduleRef;
    }
    budget() { return this.moduleRef.get(campaign_budget_service_1.CampaignBudgetService, { strict: false }); }
    async create(actor, i) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(i.day) || Number.isNaN(Date.parse(i.day)))
            throw (0, errors_1.badRequest)('INVALID_DAY', 'day must be YYYY-MM-DD');
        if (!Number.isInteger(i.amountMinor) || i.amountMinor <= 0 || i.amountMinor > MAX_MINOR)
            throw (0, errors_1.badRequest)('INVALID_AMOUNT', 'amountMinor must be a positive whole number of piastres');
        for (const [k, v] of [['campaign', i.campaign ?? ''], ['channel', i.channel ?? '']])
            if (!TOKEN.test(v))
                throw (0, errors_1.badRequest)('INVALID_FIELD', `${k} must be a short token`);
        if (!SOURCE_KINDS.includes(i.sourceKind ?? ''))
            throw (0, errors_1.badRequest)('INVALID_SOURCE_KIND', 'sourceKind is not a known source kind');
        const note = (i.note ?? '').slice(0, 300);
        if (/[\w.+-]+@[\w-]+\.[\w.]+|\+?\d[\d\s-]{8,}/.test(note))
            throw (0, errors_1.badRequest)('INVALID_NOTE', 'the note must not contain contact details');
        let campaign = i.campaign ?? '';
        let market = i.market ?? growth_flags_1.GROWTH_DEFAULT_MARKET;
        let sourceKind = i.sourceKind ?? '';
        if (i.campaignId) {
            const c = await this.prisma.growthCampaign.findUnique({ where: { id: i.campaignId } });
            if (!c)
                throw (0, growth_errors_1.growthError)('CAMPAIGN_NOT_FOUND', 'Campaign not found');
            const problems = (0, campaign_guardrails_1.validateSpendLine)({ day: i.day, amountMinor: i.amountMinor }, { startsAt: c.startsAt, status: c.status }, new Date(), (0, market_day_1.marketTimezone)(c.market));
            if (problems.length)
                throw (0, growth_errors_1.growthError)('CAMPAIGN_INVALID', 'The spend line is not valid for this campaign', { errors: problems.map((m) => ({ path: '/', message: m })) });
            campaign = c.utmCampaign;
            market = c.market;
            sourceKind = 'CAMPAIGN';
        }
        if (i.source === 'ADAPTER' && (!i.adapterRef || !i.campaignId))
            throw (0, errors_1.badRequest)('INVALID_FIELD', 'An adapter spend line needs a campaign and an adapterRef');
        let row;
        try {
            row = await this.prisma.growthSpendEntry.create({ data: { market, day: new Date(`${i.day}T00:00:00Z`), amountMinor: i.amountMinor, campaign, channel: i.channel ?? '', sourceKind, note, createdBy: actor, campaignId: i.campaignId ?? null, source: i.source ?? 'MANUAL', adapterRef: i.adapterRef ?? null } });
        }
        catch (e) {
            if (e.code === 'P2002' && i.source === 'ADAPTER')
                return this.present(await this.prisma.growthSpendEntry.findFirstOrThrow({ where: { campaignId: i.campaignId, day: new Date(`${i.day}T00:00:00Z`), source: 'ADAPTER', adapterRef: i.adapterRef } }));
            throw e;
        }
        await this.prisma.auditLog.create({ data: { actor, action: 'growth.spend.create', resource: 'GrowthSpendEntry', resourceId: row.id, metadata: { day: i.day, amountMinor: i.amountMinor, campaign, channel: i.channel ?? '', campaignId: i.campaignId ?? null } } });
        if (row.campaignId)
            await this.budget().recompute(row.campaignId);
        return this.present(row);
    }
    async decide(actor, id, decision) {
        const row = await this.prisma.growthSpendEntry.findUnique({ where: { id } });
        if (!row)
            throw (0, errors_1.notFound)('SPEND_NOT_FOUND', 'Spend entry not found');
        if (row.createdBy === actor)
            throw (0, errors_1.forbidden)('MAKER_CHECKER', 'The person who entered a spend line cannot approve it');
        if (row.status !== 'PENDING')
            throw (0, errors_1.badRequest)('ALREADY_DECIDED', `The entry is already ${row.status}`);
        const r = await this.prisma.growthSpendEntry.updateMany({ where: { id, status: 'PENDING' }, data: { status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', decidedBy: actor, decidedAt: new Date() } });
        if (!r.count)
            throw (0, errors_1.badRequest)('ALREADY_DECIDED', 'The entry was decided concurrently');
        await this.prisma.auditLog.create({ data: { actor, action: `growth.spend.${decision.toLowerCase()}`, resource: 'GrowthSpendEntry', resourceId: id, metadata: { amountMinor: row.amountMinor, campaignId: row.campaignId } } });
        if (row.campaignId)
            await this.budget().recompute(row.campaignId);
        return this.present(await this.prisma.growthSpendEntry.findUniqueOrThrow({ where: { id } }));
    }
    async list(f = {}) {
        const rows = await this.prisma.growthSpendEntry.findMany({ where: { ...(f.status ? { status: f.status } : {}), ...(f.campaignId ? { campaignId: f.campaignId } : {}), ...(f.from || f.to ? { day: { ...(f.from ? { gte: new Date(`${f.from}T00:00:00Z`) } : {}), ...(f.to ? { lte: new Date(`${f.to}T00:00:00Z`) } : {}) } } : {}) }, orderBy: [{ day: 'desc' }, { createdAt: 'desc' }], take: 200 });
        return rows.map((r) => this.present(r));
    }
    present(r) {
        return { campaignId: r.campaignId ?? null, source: r.source ?? 'MANUAL', adapterRef: r.adapterRef ?? null, id: r.id, market: r.market, day: r.day.toISOString().slice(0, 10), campaign: r.campaign, channel: r.channel, sourceKind: r.sourceKind, amountMinor: r.amountMinor, currency: r.currency, note: r.note, status: r.status, createdBy: r.createdBy, createdAt: r.createdAt.toISOString(), decidedBy: r.decidedBy, decidedAt: r.decidedAt?.toISOString() ?? null };
    }
};
exports.GrowthSpendService = GrowthSpendService;
exports.GrowthSpendService = GrowthSpendService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, core_1.ModuleRef])
], GrowthSpendService);
//# sourceMappingURL=spend.service.js.map