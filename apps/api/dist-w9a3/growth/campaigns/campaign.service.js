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
exports.CampaignService = exports.CAMPAIGN_EVENTS = exports.SYSTEM = void 0;
const common_1 = require("@nestjs/common");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const outbox_public_1 = require("../../outbox/outbox-public");
const client_1 = require("../../prisma/generated/client");
const prisma_service_1 = require("../../prisma/prisma.service");
const market_public_1 = require("../../market/market-public");
const growth_config_service_1 = require("../config/growth-config.service");
const growth_errors_1 = require("../growth-errors");
const growth_flags_1 = require("../growth-flags");
const campaign_eligibility_1 = require("./campaign-eligibility");
const campaign_guardrails_1 = require("./campaign-guardrails");
const campaign_hash_1 = require("./campaign-hash");
const campaign_state_1 = require("./campaign.state");
const campaign_utm_1 = require("./campaign-utm");
const market_day_1 = require("./market-day");
const SYSTEM = (name) => ({ sub: `system:${name}`, kind: 'SYSTEM' });
exports.SYSTEM = SYSTEM;
exports.CAMPAIGN_EVENTS = ['CampaignCreated', 'CampaignStatusChanged', 'CampaignBudgetThresholdReached', 'CampaignApprovalDecided'];
const site = () => process.env.SITE_CANONICAL_HOST?.replace(/\/+$/, '') || 'https://kiorex.com';
const iso = (d) => (d ? d.toISOString() : null);
let CampaignService = class CampaignService {
    prisma;
    config;
    flags;
    outbox;
    constructor(prisma, config, flags, outbox) {
        this.prisma = prisma;
        this.config = config;
        this.flags = flags;
        this.outbox = outbox;
    }
    onModuleInit() { for (const t of exports.CAMPAIGN_EVENTS)
        this.outbox.register(t, async () => undefined); }
    async policy(market, at) {
        const r = await this.config.resolve('CAMPAIGN_POLICY', { market, at });
        return { payload: r.payload, versionId: r.versionId };
    }
    approvalFlagOn(market) { return this.flags.isEnabled(growth_flags_1.GROWTH_FLAG.CAMPAIGN_APPROVAL_REQUIRED, { market }).catch(() => true); }
    moneyOf(c) { return { budgetTotalMinor: c.budgetTotalMinor, budgetDailyMinor: c.budgetDailyMinor, currency: c.currency, channels: c.channels, startsAt: c.startsAt, endsAt: c.endsAt, eligibility: c.eligibility }; }
    hashOf(c) { return (0, campaign_hash_1.moneyHash)(this.moneyOf(c)); }
    approvalCurrent(c) { return !!c.approvedPayloadHash && c.approvedPayloadHash === this.hashOf(c); }
    async approvedSpend(campaignId, client = this.prisma) {
        const g = await client.growthSpendEntry.groupBy({ by: ['status'], where: { campaignId }, _sum: { amountMinor: true } });
        const by = Object.fromEntries(g.map((r) => [r.status, r._sum.amountMinor ?? 0]));
        return { approved: by.APPROVED ?? 0, pending: by.PENDING ?? 0 };
    }
    async create(actor, dto) {
        const market = dto.market ?? growth_flags_1.GROWTH_DEFAULT_MARKET;
        const { payload: policy, versionId } = await this.policy(market);
        const currency = (0, market_public_1.marketFacts)(market).currency;
        const startsAt = dto.startsAt ? new Date(dto.startsAt) : null;
        const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
        const daily = dto.budgetDailyMinor ?? Math.min(dto.budgetTotalMinor, policy.dailyDefaultCapMinor);
        const errors = (0, campaign_guardrails_1.validatePlan)({ budgetTotalMinor: dto.budgetTotalMinor, budgetDailyMinor: daily, currency, channels: dto.channels, startsAt, endsAt }, policy, currency);
        const elig = (0, campaign_eligibility_1.validateEligibility)(dto.eligibility ?? {});
        if (!elig.valid)
            errors.push(...elig.errors.map((m) => ({ path: '/eligibility', message: m })));
        const utm = (0, campaign_utm_1.validateUtmConfig)(dto.utmConfig ?? {}, policy.utmNaming.maxTokenLength);
        if (!utm.valid)
            errors.push(...utm.errors.map((m) => ({ path: '/utmConfig', message: m })));
        if (errors.length)
            throw (0, growth_errors_1.growthError)('CAMPAIGN_INVALID', 'The campaign is not valid', { errors });
        if (dto.landingPageId)
            await this.assertLandingPage(dto.landingPageId, market);
        const utmCampaign = (0, campaign_utm_1.utmCampaignOf)(market, dto.key);
        try {
            const row = await this.prisma.$transaction(async (tx) => {
                const created = await tx.growthCampaign.create({ data: { market, key: dto.key, utmCampaign, name: dto.name.trim(), objective: dto.objective, budgetTotalMinor: dto.budgetTotalMinor, budgetDailyMinor: daily, currency, channels: [...new Set(dto.channels)], startsAt, endsAt, eligibility: elig.value, utmConfig: utm.value, landingPageId: dto.landingPageId ?? null, policyVersionId: versionId, ownerSub: actor.sub } });
                await this.audit(tx, actor, 'create', created.id, { key: created.key, market, budgetTotalMinor: created.budgetTotalMinor });
                await this.outbox.enqueue(tx, { type: 'CampaignCreated', aggregateType: 'GrowthCampaign', aggregateId: created.id, payload: { campaignId: created.id, market, key: created.key, objective: created.objective, channels: created.channels, budgetTotalMinor: created.budgetTotalMinor, currency, createdAt: created.createdAt.toISOString() }, dedupeKey: `CampaignCreated:${created.id}` });
                return created;
            });
            return this.present(row);
        }
        catch (e) {
            if (e.code === 'P2002')
                throw (0, growth_errors_1.growthError)('CAMPAIGN_KEY_TAKEN', 'A campaign with this key already exists in this market');
            throw e;
        }
    }
    async list(f = {}) {
        const rows = await this.prisma.growthCampaign.findMany({
            where: { market: f.market ?? growth_flags_1.GROWTH_DEFAULT_MARKET, ...(f.status ? { status: f.status } : {}), ...(f.objective ? { objective: f.objective } : {}), ...(f.promotional ? { objective: 'PROMOTION' } : {}), ...(f.q ? { OR: [{ name: { contains: f.q, mode: 'insensitive' } }, { key: { contains: f.q.toLowerCase() } }] } : {}) },
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: Math.min(Math.max(f.take ?? 100, 1), 200),
        });
        const spend = await this.prisma.growthSpendEntry.groupBy({ by: ['campaignId'], where: { campaignId: { in: rows.map((r) => r.id) }, status: 'APPROVED' }, _sum: { amountMinor: true } });
        const m = new Map(spend.map((s) => [s.campaignId, s._sum.amountMinor ?? 0]));
        return rows.map((r) => ({ ...this.brief(r), approvedSpendMinor: m.get(r.id) ?? 0, utilisationBp: (0, campaign_guardrails_1.utilisationBp)(m.get(r.id) ?? 0, r.budgetTotalMinor) }));
    }
    async must(id, client = this.prisma) {
        const row = typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? await client.growthCampaign.findUnique({ where: { id } }) : null;
        if (!row)
            throw (0, growth_errors_1.growthError)('CAMPAIGN_NOT_FOUND', 'Campaign not found');
        return row;
    }
    async get(id, now = new Date()) { return this.present(await this.must(id), now); }
    async update(actor, id, dto) {
        return this.prisma.$transaction(async (tx) => {
            const c = await this.lock(tx, id);
            if (c.version !== dto.version)
                throw (0, growth_errors_1.growthError)('CAMPAIGN_LOCKED', 'The campaign was changed by someone else: reload and try again', { currentVersion: c.version });
            if (['PENDING_APPROVAL', 'COMPLETED', 'ARCHIVED'].includes(c.status))
                throw (0, growth_errors_1.growthError)('CAMPAIGN_LOCKED', `A ${c.status} campaign cannot be edited${c.status === 'PENDING_APPROVAL' ? ': send it back to draft first' : ''}`);
            const { payload: policy } = await this.policy(c.market);
            const startsAt = dto.startsAt !== undefined ? new Date(dto.startsAt) : c.startsAt;
            const endsAt = dto.endsAt !== undefined ? new Date(dto.endsAt) : c.endsAt;
            const channels = dto.channels ? [...new Set(dto.channels)] : c.channels;
            const total = dto.budgetTotalMinor ?? c.budgetTotalMinor;
            const daily = dto.budgetDailyMinor ?? (dto.budgetTotalMinor !== undefined ? Math.min(c.budgetDailyMinor, total) : c.budgetDailyMinor);
            const running = c.status === 'ACTIVE' || c.status === 'PAUSED';
            const errors = (0, campaign_guardrails_1.validatePlan)({ budgetTotalMinor: total, budgetDailyMinor: daily, currency: c.currency, channels, startsAt, endsAt }, policy, (0, market_public_1.marketFacts)(c.market).currency);
            let elig = c.eligibility;
            if (dto.eligibility !== undefined) {
                const v = (0, campaign_eligibility_1.validateEligibility)(dto.eligibility);
                if (!v.valid)
                    errors.push(...v.errors.map((m) => ({ path: '/eligibility', message: m })));
                else
                    elig = v.value;
            }
            let utm = c.utmConfig;
            if (dto.utmConfig !== undefined) {
                if (c.activatedAt)
                    errors.push({ path: '/utmConfig', message: 'The tracking configuration is fixed once the campaign has been active (links are already out)' });
                else {
                    const v = (0, campaign_utm_1.validateUtmConfig)(dto.utmConfig, policy.utmNaming.maxTokenLength);
                    if (!v.valid)
                        errors.push(...v.errors.map((m) => ({ path: '/utmConfig', message: m })));
                    else
                        utm = v.value;
                }
            }
            if (errors.length)
                throw (0, growth_errors_1.growthError)('CAMPAIGN_INVALID', 'The campaign is not valid', { errors });
            if (dto.landingPageId)
                await this.assertLandingPage(dto.landingPageId, c.market);
            const spend = await this.approvedSpend(c.id, tx);
            if (total < spend.approved)
                throw (0, growth_errors_1.growthError)('CAMPAIGN_INVALID', 'The total budget cannot be below the spend already approved', { errors: [{ path: '/budgetTotalMinor', message: `Approved spend is ${spend.approved}` }] });
            if (running && (0, campaign_guardrails_1.budgetIncreaseNeedsApproval)(c.budgetTotalMinor, total, policy))
                throw (0, growth_errors_1.growthError)('CAMPAIGN_APPROVAL_REQUIRED', 'A budget increase this large needs a second approver: request a BUDGET_INCREASE approval', { kind: 'BUDGET_INCREASE' });
            const next = { budgetTotalMinor: total, budgetDailyMinor: daily, channels, startsAt, endsAt, eligibility: elig };
            const moneyChanged = this.hashOf(c) !== this.hashOf({ ...c, ...next });
            const needsApproval = (0, campaign_guardrails_1.approvalRequired)({ budgetTotalMinor: total, channels }, policy, await this.approvalFlagOn(c.market)).required;
            const data = {
                ...(dto.name !== undefined ? { name: dto.name.trim() } : {}), ...(dto.objective ? { objective: dto.objective } : {}), ...(dto.landingPageId !== undefined ? { landingPageId: dto.landingPageId } : {}),
                budgetTotalMinor: total, budgetDailyMinor: daily, channels, startsAt, endsAt, eligibility: elig, utmConfig: utm, version: { increment: 1 },
                ...(endsAt && c.status === 'SCHEDULED' ? { autoExpiresAt: new Date(endsAt.getTime() + policy.autoExpiryGraceHours * 3600_000) } : {}),
            };
            const after = { ...c, ...next };
            if (moneyChanged && c.approvedPayloadHash && this.hashOf(after) !== c.approvedPayloadHash)
                data.approvedPayloadHash = null;
            const row = await tx.growthCampaign.update({ where: { id }, data });
            await this.audit(tx, actor, 'update', id, { fields: Object.keys(dto).filter((k) => k !== 'version'), moneyChanged });
            if (moneyChanged && c.status === 'SCHEDULED' && needsApproval)
                await this.moveLocked(tx, row, actor, 'DRAFT', { reasonCode: 'EDITED_AFTER_APPROVAL', reason: 'Money-relevant fields changed after approval' });
            return this.present(await this.must(id, tx));
        });
    }
    async addCreative(actor, id, dto) {
        const c = await this.must(id);
        if (['COMPLETED', 'ARCHIVED'].includes(c.status))
            throw (0, growth_errors_1.growthError)('CAMPAIGN_LOCKED', `A ${c.status} campaign cannot take new creatives`);
        const { payload: policy } = await this.policy(c.market);
        const problem = (0, campaign_guardrails_1.validateAssetRef)(dto.assetRef, c.market, c.id, policy);
        if (problem)
            throw (0, growth_errors_1.growthError)('CAMPAIGN_INVALID', 'The creative reference is not accepted', { errors: [{ path: '/assetRef', message: problem }] });
        const count = await this.prisma.growthCampaignCreative.count({ where: { campaignId: id, status: { not: 'RETIRED' } } });
        if (count >= policy.creativeRules.maxCreatives)
            throw (0, growth_errors_1.growthError)('CAMPAIGN_INVALID', `A campaign has at most ${policy.creativeRules.maxCreatives} creatives`, { errors: [{ path: '/', message: 'Too many creatives' }] });
        const row = await this.prisma.$transaction(async (tx) => {
            const r = await tx.growthCampaignCreative.create({ data: { campaignId: id, kind: dto.kind, assetRef: dto.assetRef, locale: dto.locale ?? 'ar', checksum: dto.checksum ?? null, createdBy: actor.sub } });
            await this.audit(tx, actor, 'creative.add', id, { creativeId: r.id, kind: r.kind });
            return r;
        });
        return { id: row.id, campaignId: row.campaignId, kind: row.kind, assetRef: row.assetRef, locale: row.locale, status: row.status, checksum: row.checksum, createdBy: row.createdBy, createdAt: row.createdAt.toISOString() };
    }
    async creatives(id) {
        await this.must(id);
        return (await this.prisma.growthCampaignCreative.findMany({ where: { campaignId: id }, orderBy: { createdAt: 'asc' } })).map((r) => ({ id: r.id, kind: r.kind, assetRef: r.assetRef, locale: r.locale, status: r.status, checksum: r.checksum, createdBy: r.createdBy, createdAt: r.createdAt.toISOString() }));
    }
    async history(id) {
        await this.must(id);
        return (await this.prisma.growthCampaignStatusHistory.findMany({ where: { campaignId: id }, orderBy: [{ at: 'asc' }, { id: 'asc' }] })).map((h) => ({ id: h.id, from: h.from, to: h.to, actor: h.actor, reasonCode: h.reasonCode, at: h.at.toISOString() }));
    }
    async transition(actor, id, to, o = {}) {
        const run = async (tx) => { const c = await this.lock(tx, id); return this.moveLocked(tx, c, actor, to, o); };
        const row = o.tx ? await run(o.tx) : await this.prisma.$transaction(run);
        return this.present(row, o.now);
    }
    async lock(tx, id) {
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(id))
            throw (0, growth_errors_1.growthError)('CAMPAIGN_NOT_FOUND', 'Campaign not found');
        const r = await tx.$queryRaw(client_1.Prisma.sql `SELECT "id" FROM "GrowthCampaign" WHERE "id" = ${id} FOR UPDATE`);
        if (!r.length)
            throw (0, growth_errors_1.growthError)('CAMPAIGN_NOT_FOUND', 'Campaign not found');
        return this.must(id, tx);
    }
    async contextFor(tx, c, actor, o) {
        const now = o.now ?? new Date();
        const { payload: policy } = await this.policy(c.market);
        const spend = await this.approvedSpend(c.id, tx);
        const need = (0, campaign_guardrails_1.approvalRequired)({ budgetTotalMinor: c.budgetTotalMinor, channels: c.channels }, policy, await this.approvalFlagOn(c.market));
        return { now, startsAt: c.startsAt, endsAt: c.endsAt, approvalRequired: need.required, approvalCurrent: this.approvalCurrent(c), pauseReason: c.pauseReason ?? null, budgetExhausted: (0, campaign_guardrails_1.budgetExhausted)(spend.approved, c.budgetTotalMinor), dailyPauseActive: !!c.pausedUntil && c.pausedUntil.getTime() > now.getTime(), hasReason: !!(o.reasonCode || o.reason), actorKind: actor.kind, requireReasonOnPause: policy.requireReasonOnPause, policy };
    }
    async moveLocked(tx, c, actor, to, o = {}) {
        const now = o.now ?? new Date();
        const from = c.status;
        const ctx = await this.contextFor(tx, c, actor, { ...o, now });
        const v = (0, campaign_state_1.evaluateTransition)(from, to, ctx);
        if (!v.ok)
            throw (0, growth_errors_1.growthError)(v.code, v.message, { from, to });
        const entering = (to === 'SCHEDULED' && from !== 'SCHEDULED') || (to === 'ACTIVE' && from === 'PAUSED');
        if (entering && !o.skipCeiling) {
            const others = await tx.growthCampaign.findMany({ where: { market: c.market, id: { not: c.id }, status: { in: ['ACTIVE', 'SCHEDULED'] } }, select: { status: true, budgetTotalMinor: true, startsAt: true, endsAt: true } });
            const breach = (0, campaign_guardrails_1.ceilingBreach)(c, others.map((x) => ({ ...x, status: x.status })), ctx.policy, (0, market_day_1.marketTimezone)(c.market));
            if (breach)
                throw (0, growth_errors_1.growthError)('CAMPAIGN_CEILING_EXCEEDED', `The monthly ceiling for ${breach.month} would be exceeded (${breach.plannedMinor} planned, ceiling ${breach.ceilingMinor})`, breach);
        }
        const reasonCode = o.reasonCode ?? (o.pauseReason ? o.pauseReason : 'MANUAL');
        const data = { status: to, statusReason: reasonCode, version: { increment: 1 } };
        if (to === 'SCHEDULED')
            data.autoExpiresAt = c.endsAt ? new Date(c.endsAt.getTime() + ctx.policy.autoExpiryGraceHours * 3600_000) : null;
        if (to === 'ACTIVE') {
            data.pauseReason = null;
            data.pausedUntil = null;
            if (!c.activatedAt)
                data.activatedAt = now;
        }
        if (to === 'PAUSED') {
            data.pauseReason = o.pauseReason ?? 'MANUAL';
            data.pausedUntil = o.pauseReason === 'GUARDRAIL' ? (o.pausedUntil ?? (0, market_day_1.nextDayBoundary)(now, (0, market_day_1.marketTimezone)(c.market))) : null;
        }
        if (to === 'COMPLETED') {
            data.completedAt = now;
            data.pauseReason = null;
            data.pausedUntil = null;
        }
        if (to === 'ARCHIVED')
            data.archivedAt = now;
        if (to === 'DRAFT')
            data.approvedPayloadHash = null;
        const row = await tx.growthCampaign.update({ where: { id: c.id }, data });
        await tx.growthCampaignStatusHistory.create({ data: { campaignId: c.id, from, to, actor: actor.sub, reasonCode, at: now } });
        await this.audit(tx, actor, `transition.${to.toLowerCase()}`, c.id, { from, to, reasonCode });
        await this.outbox.enqueue(tx, { type: 'CampaignStatusChanged', aggregateType: 'GrowthCampaign', aggregateId: c.id, payload: { campaignId: c.id, market: c.market, from, to, reasonCode, actorKind: actor.kind, at: now.toISOString() }, dedupeKey: `CampaignStatusChanged:${c.id}:${row.version}` });
        return row;
    }
    async audit(tx, actor, action, id, metadata) {
        await tx.auditLog.create({ data: { actor: actor.sub, action: `growth.campaign.${action}`, resource: 'GrowthCampaign', resourceId: id, metadata: metadata } });
    }
    async assertLandingPage(id, market) {
        const p = await this.prisma.growthLandingPage.findFirst({ where: { id, market }, select: { id: true } });
        if (!p)
            throw (0, growth_errors_1.growthError)('CAMPAIGN_INVALID', 'The landing page does not exist in this market', { errors: [{ path: '/landingPageId', message: 'Unknown landing page' }] });
    }
    brief(c) {
        return { id: c.id, market: c.market, key: c.key, utmCampaign: c.utmCampaign, name: c.name, objective: c.objective, status: c.status, channels: c.channels, budgetTotalMinor: c.budgetTotalMinor, budgetDailyMinor: c.budgetDailyMinor, currency: c.currency, startsAt: iso(c.startsAt), endsAt: iso(c.endsAt), ownerSub: c.ownerSub, pauseReason: c.pauseReason, version: c.version, createdAt: c.createdAt.toISOString() };
    }
    async present(c, now = new Date()) {
        const { payload: policy } = await this.policy(c.market);
        const spend = await this.approvedSpend(c.id);
        const flagOn = await this.approvalFlagOn(c.market);
        const need = (0, campaign_guardrails_1.approvalRequired)({ budgetTotalMinor: c.budgetTotalMinor, channels: c.channels }, policy, flagOn);
        const approvals = await this.prisma.growthCampaignApproval.findMany({ where: { campaignId: c.id }, orderBy: { requestedAt: 'desc' }, take: 20 });
        const links = (0, campaign_utm_1.trackedLinks)({ market: c.market, key: c.key, channels: c.channels, config: c.utmConfig, host: site() });
        const ctxBase = { now, startsAt: c.startsAt, endsAt: c.endsAt, approvalRequired: need.required, approvalCurrent: this.approvalCurrent(c), pauseReason: c.pauseReason ?? null, budgetExhausted: (0, campaign_guardrails_1.budgetExhausted)(spend.approved, c.budgetTotalMinor), dailyPauseActive: !!c.pausedUntil && c.pausedUntil.getTime() > now.getTime(), hasReason: true, actorKind: 'USER', requireReasonOnPause: policy.requireReasonOnPause };
        const actions = (0, campaign_state_1.nextStates)(c.status).map((to) => { const v = (0, campaign_state_1.evaluateTransition)(c.status, to, ctxBase); return { to, allowed: v.ok, ...(v.ok ? {} : { code: v.code, message: v.message }) }; });
        return {
            ...this.brief(c), eligibility: c.eligibility, utmConfig: c.utmConfig, landingPageId: c.landingPageId, policyVersionId: c.policyVersionId, activatedAt: iso(c.activatedAt), completedAt: iso(c.completedAt), archivedAt: iso(c.archivedAt),
            autoExpiresAt: iso(c.autoExpiresAt), pausedUntil: iso(c.pausedUntil), statusReason: c.statusReason, thresholdsFiredBp: c.thresholdsFiredBp, links,
            approval: { required: need.required, reasons: need.reasons, current: this.approvalCurrent(c), payloadHash: this.hashOf(c), pending: approvals.filter((a) => !a.decision).map((a) => ({ id: a.id, kind: a.kind, requestedBy: a.requestedBy, requestedAt: a.requestedAt.toISOString() })) },
            budget: { approvedSpendMinor: spend.approved, pendingSpendMinor: spend.pending, utilisationBp: (0, campaign_guardrails_1.utilisationBp)(spend.approved, c.budgetTotalMinor), remainingMinor: Math.max(0, c.budgetTotalMinor - spend.approved) },
            actions,
        };
    }
};
exports.CampaignService = CampaignService;
exports.CampaignService = CampaignService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, growth_config_service_1.GrowthConfigService, control_plane_public_1.FlagsService, outbox_public_1.OutboxService])
], CampaignService);
//# sourceMappingURL=campaign.service.js.map