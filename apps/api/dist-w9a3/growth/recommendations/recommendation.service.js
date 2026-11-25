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
exports.RecommendationService = void 0;
const common_1 = require("@nestjs/common");
const errors_1 = require("../../common/errors");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const client_1 = require("../../prisma/generated/client");
const prisma_service_1 = require("../../prisma/prisma.service");
const automation_flags_1 = require("../automation/automation-flags");
const campaign_service_1 = require("../campaigns/campaign.service");
const growth_config_service_1 = require("../config/growth-config.service");
const growth_flags_1 = require("../growth-flags");
const assert_aggregate_only_1 = require("./assert-aggregate-only");
const ai_summary_service_1 = require("./ai-summary.service");
const recommendation_inputs_service_1 = require("./recommendation-inputs.service");
const recommendation_engine_1 = require("./recommendation.engine");
const recommendation_types_1 = require("./recommendation.types");
const SYSTEM = { sub: 'system:recommendations', kind: 'SYSTEM' };
const DAY = 86_400_000;
const NEXT = { PAUSE_CAMPAIGN: { screen: '/growth/campaigns' }, CONTENT_SUGGESTION: { screen: '/growth/experiments' }, SEO_GAP: { screen: '/growth/seo' }, LIFECYCLE_HOLDOUT: { screen: '/growth/lifecycle' } };
let RecommendationService = class RecommendationService {
    prisma;
    flags;
    inputs;
    summary;
    campaigns;
    config;
    log = new common_1.Logger('recommendations');
    constructor(prisma, flags, inputs, summary, campaigns, config) {
        this.prisma = prisma;
        this.flags = flags;
        this.inputs = inputs;
        this.summary = summary;
        this.campaigns = campaigns;
        this.config = config;
    }
    audit(actor, action, id, metadata) {
        return this.prisma.auditLog.create({ data: { actor: actor.sub, action: `growth.recommendation.${action}`, resource: 'GrowthRecommendation', resourceId: id, metadata: metadata } });
    }
    requestedMode() { const m = process.env.RECOMMENDATION_MODEL_MODE; return m === 'rules' || m === 'real' ? m : 'mock'; }
    async generate(actor, market = growth_flags_1.GROWTH_DEFAULT_MARKET, now = new Date()) {
        const inputs = await this.inputs.collect(market, now);
        const { proposals, dropped } = (0, recommendation_engine_1.runRules)(inputs);
        await this.expireDue(now);
        let created = 0;
        let existing = 0;
        let summarised = 0;
        const todaySummaries = await this.prisma.growthRecommendation.count({ where: { market, aiSummary: { not: client_1.Prisma.DbNull }, createdAt: { gte: new Date(now.getTime() - DAY) } } });
        const mode = this.requestedMode();
        for (const p of proposals) {
            const open = await this.prisma.growthRecommendation.findFirst({ where: { market, kind: p.kind, fingerprint: p.fingerprint, status: 'PROPOSED' }, select: { id: true } });
            if (open) {
                existing++;
                continue;
            }
            (0, assert_aggregate_only_1.assertAggregateOnly)({ payload: p.payload, evidence: p.evidenceRefs });
            let ai = null;
            if (mode !== 'rules' && todaySummaries + summarised < recommendation_types_1.RECOMMENDATION_POLICY.maxAiSummariesPerDay) {
                ai = await this.summary.summarise({ kind: p.kind, payload: p.payload, rationale: p.rationale }, mode, market);
                if (ai)
                    summarised++;
            }
            try {
                const row = await this.prisma.growthRecommendation.create({ data: {
                        market, kind: p.kind, fingerprint: p.fingerprint, payload: p.payload, rationale: p.rationale.en, rationaleAr: p.rationale.ar, evidenceRefs: p.evidenceRefs,
                        confidence: p.confidence, modelMode: ai ? ai.mode : 'rules', aiSummary: ai ? { en: ai.en, ar: ai.ar, label: ai.label, model: ai.model } : client_1.Prisma.DbNull, expiresAt: new Date(now.getTime() + recommendation_types_1.RECOMMENDATION_POLICY.expiryDays * DAY),
                    } });
                created++;
                await this.audit(actor, 'propose', row.id, { kind: p.kind, fingerprint: p.fingerprint, confidence: p.confidence, modelMode: row.modelMode });
            }
            catch (e) {
                if (e.code === 'P2002') {
                    existing++;
                    continue;
                }
                throw e;
            }
        }
        return { market, window: inputs.window, considered: proposals.length, created, existing, dropped, mode };
    }
    async expireDue(now = new Date()) {
        const due = await this.prisma.growthRecommendation.findMany({ where: { status: 'PROPOSED', expiresAt: { lte: now } }, select: { id: true } });
        if (!due.length)
            return 0;
        const r = await this.prisma.growthRecommendation.updateMany({ where: { id: { in: due.map((d) => d.id) }, status: 'PROPOSED' }, data: { status: 'EXPIRED' } });
        for (const d of due)
            await this.audit(SYSTEM, 'expire', d.id, {});
        return r.count;
    }
    present(r) {
        return {
            id: r.id, market: r.market, kind: r.kind, payload: r.payload, rationale: { en: r.rationale, ar: r.rationaleAr }, evidenceRefs: r.evidenceRefs, confidence: r.confidence, status: r.status, decidedBy: r.decidedBy, decidedAt: r.decidedAt,
            decisionNote: r.decisionNote, convertedRef: r.convertedRef, modelMode: r.modelMode, aiAssisted: !!r.aiSummary, aiSummary: r.aiSummary, feedback: r.feedback, expiresAt: r.expiresAt, createdAt: r.createdAt,
            next: r.status === 'APPROVED' || r.status === 'CONVERTED' ? (r.kind === 'LIFECYCLE_HOLDOUT' && String(r.payload.journey).startsWith('auto.') ? { screen: '/growth/automation' } : (NEXT[r.kind] ?? null)) : null,
        };
    }
    async must(id) { const r = await this.prisma.growthRecommendation.findUnique({ where: { id } }); if (!r)
        throw (0, errors_1.notFound)('RECOMMENDATION_NOT_FOUND', 'No such recommendation'); return r; }
    async list(f = {}) {
        await this.expireDue();
        const rows = await this.prisma.growthRecommendation.findMany({ where: { ...(f.market ? { market: f.market } : {}), ...(f.status ? { status: f.status } : {}), ...(f.kind ? { kind: f.kind } : {}) }, orderBy: [{ createdAt: 'desc' }], take: Math.min(f.take ?? 100, 200) });
        return rows.map((r) => this.present(r));
    }
    async get(id) { return this.present(await this.must(id)); }
    async assertOn(market) {
        const r = await this.flags.evaluate(automation_flags_1.AI_RECOMMENDATIONS_FLAG, { market });
        if (!r.effective)
            throw (0, errors_1.forbidden)('FEATURE_DISABLED', 'Feature temporarily unavailable', { key: automation_flags_1.AI_RECOMMENDATIONS_FLAG, scope: r.scope ?? 'GLOBAL', reason: r.reason });
    }
    async feedback(actor, id, value) {
        if (value !== 'USEFUL' && value !== 'NOT_USEFUL')
            throw new errors_1.ApiError(400, 'RECOMMENDATION_FEEDBACK_INVALID', 'feedback is USEFUL or NOT_USEFUL');
        await this.must(id);
        const r = await this.prisma.growthRecommendation.update({ where: { id }, data: { feedback: value, feedbackBy: actor.sub, feedbackAt: new Date() } });
        await this.audit(actor, 'feedback', id, { value });
        return this.present(r);
    }
    async decide(actor, id, decision, note, now = new Date()) {
        if (decision !== 'APPROVE' && decision !== 'REJECT')
            throw new errors_1.ApiError(400, 'RECOMMENDATION_DECISION_INVALID', 'decision is APPROVE or REJECT');
        const cur = await this.must(id);
        await this.assertOn(cur.market);
        if (cur.status !== 'PROPOSED')
            throw (0, errors_1.conflict)('RECOMMENDATION_NOT_PROPOSED', `This recommendation is ${cur.status}`);
        if (cur.expiresAt <= now) {
            await this.prisma.growthRecommendation.updateMany({ where: { id, status: 'PROPOSED' }, data: { status: 'EXPIRED' } });
            throw (0, errors_1.conflict)('RECOMMENDATION_EXPIRED', 'This recommendation has expired');
        }
        const text = typeof note === 'string' ? note.trim().slice(0, 300) : '';
        if (decision === 'REJECT' && text.length < 3)
            throw new errors_1.ApiError(400, 'RECOMMENDATION_NOTE_REQUIRED', 'A short reason is required to reject');
        const won = await this.prisma.growthRecommendation.updateMany({ where: { id, status: 'PROPOSED' }, data: { status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', decidedBy: actor.sub, decidedAt: now, decisionNote: text || null } });
        if (won.count !== 1)
            throw (0, errors_1.conflict)('RECOMMENDATION_NOT_PROPOSED', 'Someone else decided this recommendation first');
        await this.audit(actor, decision === 'APPROVE' ? 'approve' : 'reject', id, { kind: cur.kind });
        let conversionError = null;
        if (decision === 'APPROVE') {
            try {
                await this.convert(actor, cur);
            }
            catch (e) {
                conversionError = e.response?.code ?? e.message.slice(0, 120);
                this.log.warn(`recommendation ${id} approved, draft not created: ${conversionError}`);
                await this.audit(actor, 'convert-failed', id, { error: conversionError });
            }
        }
        return { ...this.present(await this.must(id)), conversionError };
    }
    async convert(actor, r) {
        const p = r.payload;
        let ref = null;
        if (r.kind === 'REALLOCATE_BUDGET') {
            const toChannel = String(p.toChannel);
            const shift = Number(p.shiftMinor);
            const c = await this.campaigns.create({ sub: actor.sub, kind: 'USER' }, { key: `rec-${r.id.slice(-10).toLowerCase()}`, name: `Proposed: more on ${toChannel}`, objective: 'ACQUISITION', market: r.market, budgetTotalMinor: Math.max(1, shift), channels: [toChannel] });
            ref = `campaign:${c.id}`;
        }
        else if (r.kind === 'LIFECYCLE_HOLDOUT' && p.action === 'DISABLE_JOURNEY' && /^[a-z0-9][a-z0-9_-]{1,47}$/.test(String(p.journey))) {
            const cur = await this.config.resolve('LIFECYCLE_POLICY', { market: r.market });
            const payload = JSON.parse(JSON.stringify(cur.payload));
            payload.journeys = { ...(payload.journeys ?? {}), [String(p.journey)]: { messageClass: 'MARKETING', ...(payload.journeys?.[String(p.journey)] ?? {}), enabled: false } };
            const v = await this.config.createDraft({ sub: actor.sub, roles: actor.roles?.length ? actor.roles : ['super_admin'] }, { kind: 'LIFECYCLE_POLICY', scope: 'MARKET', scopeId: r.market, payload, reason: `Recommendation ${r.id}: no measured lift for ${String(p.journey)}`, announcement: `Recommendation ${r.id} proposes switching off the journey ${String(p.journey)} (no booking lift against the holdout).` });
            ref = `config:${v.id}`;
        }
        if (ref)
            await this.prisma.growthRecommendation.update({ where: { id: r.id }, data: { status: 'CONVERTED', convertedRef: ref } });
        return ref;
    }
    catalog() { return { kinds: recommendation_types_1.RECOMMENDATION_KINDS, policy: recommendation_types_1.RECOMMENDATION_POLICY, mode: this.requestedMode() }; }
};
exports.RecommendationService = RecommendationService;
exports.RecommendationService = RecommendationService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, control_plane_public_1.FlagsService, recommendation_inputs_service_1.RecommendationInputsService, ai_summary_service_1.AiSummaryService,
        campaign_service_1.CampaignService, growth_config_service_1.GrowthConfigService])
], RecommendationService);
//# sourceMappingURL=recommendation.service.js.map