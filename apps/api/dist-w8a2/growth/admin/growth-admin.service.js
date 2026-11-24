"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GrowthAdminService = exports.PLANNED_INTEGRATIONS = exports.marketOf = exports.EDITABLE = void 0;
const market_core_public_1 = require("../../market/market-core-public");
const common_1 = require("@nestjs/common");
const contracts_1 = require("@kiorex/contracts");
const prisma_service_1 = require("../../prisma/prisma.service");
const env_1 = require("../../common/providers/env");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const errors_1 = require("../../common/errors");
const growth_errors_1 = require("../growth-errors");
const growth_limiter_1 = require("../growth-limiter");
const growth_config_service_1 = require("../config/growth-config.service");
const touch_rules_1 = require("../fraud/touch-rules");
const growth_env_1 = require("./growth-env");
const growth_overview_source_1 = require("./growth-overview.source");
const clampDays = (d, def = 30) => { const n = Number(d); return Number.isInteger(n) ? Math.min(90, Math.max(1, n)) : def; };
const clampTake = (t, def = 100, max = 200) => { const n = Number(t); return Number.isInteger(n) ? Math.min(max, Math.max(1, n)) : def; };
exports.EDITABLE = Object.keys(contracts_1.GROWTH_CONFIG_SCHEMAS);
const MARKET = /^[A-Z]{2}$/;
const marketOf = (m) => (m && MARKET.test(m) ? m : market_core_public_1.DEFAULT_MARKET);
exports.marketOf = marketOf;
const MARKETING_FLAGS = ['growth.marketing_messaging', 'growth.analytics_visitor', 'growth.campaigns', 'growth.patient_referral', 'growth.rewards'];
exports.PLANNED_INTEGRATIONS = [
    { key: 'search_console', phase: 1, label: 'Google Search Console', direction: 'pull', note: 'Manual export in Phase 1; API pull in Phase 2' },
    { key: 'google_ads', phase: 3, label: 'Google Ads', direction: 'push conversions, pull spend', note: 'AnonymizedConversion only' },
    { key: 'meta_ads', phase: 3, label: 'Meta Ads', direction: 'pull spend', note: 'AnonymizedConversion only' },
    { key: 'tiktok_ads', phase: 3, label: 'TikTok Ads', direction: 'pull spend', note: 'AnonymizedConversion only' },
    { key: 'play_console', phase: 2, label: 'Google Play Console', direction: 'pull installs and ratings', note: 'Aggregates' },
    { key: 'app_store_connect', phase: 2, label: 'App Store Connect', direction: 'pull installs and ratings', note: 'Aggregates' },
];
let GrowthAdminService = class GrowthAdminService {
    prisma;
    config;
    flags;
    overviewSource;
    constructor(prisma, config, flags, overviewSource) {
        this.prisma = prisma;
        this.config = config;
        this.flags = flags;
        this.overviewSource = overviewSource;
    }
    audit(actor, action, resource, resourceId, metadata) {
        return this.prisma.auditLog.create({ data: { actor, action, resource, resourceId, metadata: metadata } });
    }
    async overview(q) {
        const market = (0, exports.marketOf)(q.market);
        const days = clampDays(q.days);
        const since = new Date(Date.now() - days * 86_400_000);
        const [data, health, fraudOpen, widgets, indexable, pages, slugs] = await Promise.all([
            this.overviewSource.overview({ market, days }),
            this.configHealth(market),
            this.prisma.growthFraudSignal.count({ where: { market, reviewStatus: 'OPEN' } }),
            this.prisma.widgetRegistration.count({ where: { market, status: 'ACTIVE' } }),
            this.prisma.growthLandingPage.count({ where: { market, indexable: true } }),
            this.prisma.growthLandingPage.count({ where: { market } }),
            this.prisma.growthSlug.count({ where: { market } }),
        ]);
        return { ...data, since: data.since ?? since.toISOString(), config: health, fraudOpen, activeWidgets: widgets, landingPages: { total: pages, indexable }, slugs };
    }
    async configHealth(market) {
        const out = [];
        for (const kind of exports.EDITABLE) {
            const r = await this.config.resolve(kind, { market });
            const [pending, scheduled] = await Promise.all([
                this.prisma.growthConfigVersion.count({ where: { kind, status: 'PENDING_APPROVAL' } }),
                this.prisma.growthConfigVersion.count({ where: { kind, status: 'APPROVED', effectiveFrom: { gt: new Date() } } }),
            ]);
            out.push({ kind, source: r.source, version: r.version, scope: r.scope, scopeId: r.scopeId, effectiveFrom: r.effectiveFrom?.toISOString() ?? null, pending, scheduled });
        }
        return out;
    }
    async channels(q) {
        const market = (0, exports.marketOf)(q.market);
        const days = clampDays(q.days);
        const since = new Date(Date.now() - days * 86_400_000);
        const [sources, touches] = await Promise.all([
            this.prisma.growthAcquisitionSource.findMany({ where: { market }, orderBy: [{ sourceKind: 'asc' }, { createdAt: 'desc' }], take: 500 }),
            this.prisma.growthTouchpoint.groupBy({ by: ['sourceId'], where: { market, occurredAt: { gte: since } }, _count: { _all: true }, _max: { occurredAt: true } }),
        ]);
        const byId = new Map(touches.map((t) => [t.sourceId, t]));
        const rows = sources.map((s) => ({ id: s.id, sourceKind: s.sourceKind, sourceRef: s.sourceRef, label: s.label, ownerOrgRef: s.ownerOrgRef, active: s.active, touches: byId.get(s.id)?._count._all ?? 0, lastTouchAt: byId.get(s.id)?._max.occurredAt?.toISOString() ?? null }));
        const kinds = new Map();
        for (const r of rows) {
            const k = kinds.get(r.sourceKind) ?? { sourceKind: r.sourceKind, sources: 0, active: 0, touches: 0 };
            k.sources++;
            if (r.active)
                k.active++;
            k.touches += r.touches;
            kinds.set(r.sourceKind, k);
        }
        return { days, market, kinds: [...kinds.values()], sources: rows };
    }
    async updateChannel(actor, id, patch) {
        const before = await this.prisma.growthAcquisitionSource.findUnique({ where: { id } });
        if (!before)
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'Unknown acquisition source');
        const next = await this.prisma.growthAcquisitionSource.update({ where: { id }, data: { ...(patch.active !== undefined ? { active: patch.active } : {}), ...(patch.label !== undefined ? { label: patch.label.slice(0, 120) || null } : {}) } });
        await this.audit(actor, 'growth.channel.update', 'GrowthAcquisitionSource', id, { sourceKind: before.sourceKind, sourceRef: before.sourceRef, active: [before.active, next.active], label: [before.label, next.label] });
        return { id: next.id, sourceKind: next.sourceKind, sourceRef: next.sourceRef, label: next.label, active: next.active };
    }
    async providerAcquisition(q) {
        const market = (0, exports.marketOf)(q.market);
        const days = clampDays(q.days);
        const since = new Date(Date.now() - days * 86_400_000);
        const [touches, byKind, owned] = await Promise.all([
            this.prisma.growthTouchpoint.groupBy({ by: ['providerOrgRef'], where: { market, occurredAt: { gte: since }, providerOrgRef: { not: null } }, _count: { _all: true }, orderBy: { _count: { providerOrgRef: 'desc' } }, take: 25 }),
            this.prisma.growthAcquisitionSource.groupBy({ by: ['sourceKind'], where: { market, ownerOrgRef: { not: null } }, _count: { _all: true } }),
            this.prisma.growthAcquisitionSource.count({ where: { market, ownerOrgRef: { not: null }, active: true } }),
        ]);
        return { days, market, ownedSources: owned, sourcesByKind: byKind.map((k) => ({ sourceKind: k.sourceKind, count: k._count._all })), topOrganisations: touches.map((t) => ({ orgRef: t.providerOrgRef, touches: t._count._all })) };
    }
    async seoStatus(q) {
        const market = (0, exports.marketOf)(q.market);
        const cfg = await this.config.resolve('SEO', { market });
        const p = cfg.payload;
        const [byType, lastRendered, slugCount, historyCount, thinReasons] = await Promise.all([
            this.prisma.growthLandingPage.groupBy({ by: ['pageType', 'indexable'], where: { market }, _count: { _all: true } }),
            this.prisma.growthLandingPage.aggregate({ where: { market }, _max: { lastRenderedAt: true } }),
            this.prisma.growthSlug.count({ where: { market } }),
            this.prisma.growthSlugHistory.count({ where: { market } }),
            this.prisma.growthLandingPage.findMany({ where: { market, indexable: false }, select: { guardResult: true }, take: 500 }),
        ]);
        const env = (0, growth_env_1.siteEnvironment)();
        const indexable = byType.filter((r) => r.indexable).reduce((n, r) => n + r._count._all, 0);
        const thin = byType.filter((r) => !r.indexable).reduce((n, r) => n + r._count._all, 0);
        const reasonCounts = new Map();
        for (const t of thinReasons) {
            const rs = t.guardResult?.reasons ?? [];
            for (const r of rs)
                reasonCounts.set(r, (reasonCounts.get(r) ?? 0) + 1);
        }
        const shard = Number(p.sitemapShardSize) || 10000;
        return {
            market, config: { version: cfg.version, source: cfg.source, payload: p },
            thresholds: { minLiveProviders: p.minLiveProviders, minUniqueBlocks: p.minUniqueBlocks, maxSiblingSimilarityPercent: p.maxSiblingSimilarityPercent },
            robots: { environment: env, mode: env === 'production' ? 'ALLOW_PUBLIC' : 'DISALLOW_ALL', note: 'Only an explicit production environment is indexable (public site rule); every other environment disallows everything.' },
            sitemap: { indexablePages: indexable, shards: Math.max(1, Math.ceil(indexable / shard)), shardSize: shard, lastRenderedAt: lastRendered._max.lastRenderedAt?.toISOString() ?? null },
            pages: { total: indexable + thin, indexable, thin, byType: byType.map((r) => ({ pageType: r.pageType, indexable: r.indexable, count: r._count._all })), thinReasons: [...reasonCounts.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count) },
            slugs: { current: slugCount, history: historyCount },
            live: await this.selfFetchSite(),
        };
    }
    async selfFetchSite() {
        const base = `http://127.0.0.1:${process.env.PORT ?? 4000}`;
        const get = async (path) => { try {
            const r = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(1500) });
            return { status: r.status, text: (await r.text()).slice(0, 20_000) };
        }
        catch {
            return null;
        } };
        const [robots, sitemap] = await Promise.all([get('/robots.txt'), get('/sitemap.xml')]);
        return { reachable: !!(robots || sitemap), robots: robots ? { status: robots.status, lines: robots.text.split('\n').slice(0, 12) } : null, sitemap: sitemap ? { status: sitemap.status, shards: (sitemap.text.match(/<loc>/g) ?? []).length } : null };
    }
    async slugs(q) {
        const market = (0, exports.marketOf)(q.market);
        const rows = await this.prisma.growthSlug.findMany({ where: { market, ...(q.entityType ? { entityType: q.entityType } : {}), ...(q.q ? { slug: { contains: q.q.toLowerCase().slice(0, 60) } } : {}) }, orderBy: { updatedAt: 'desc' }, take: clampTake(q.take, 50) });
        const hist = await this.prisma.growthSlugHistory.findMany({ where: { market, OR: rows.map((r) => ({ entityType: r.entityType, entityId: r.entityId })).concat(rows.length ? [] : [{ entityType: '__none__', entityId: '__none__' }]) }, orderBy: { supersededAt: 'desc' } });
        const h = new Map();
        for (const x of hist) {
            const k = `${x.entityType}:${x.entityId}`;
            h.set(k, [...(h.get(k) ?? []), x]);
        }
        return rows.map((r) => ({ id: r.id, entityType: r.entityType, entityId: r.entityId, slug: r.slug, updatedAt: r.updatedAt.toISOString(), history: (h.get(`${r.entityType}:${r.entityId}`) ?? []).map((x) => ({ slug: x.slug, replacedBy: x.replacedBy, supersededAt: x.supersededAt.toISOString() })) }));
    }
    async redirects(q) {
        const rows = await this.prisma.growthSlugHistory.findMany({ where: { market: (0, exports.marketOf)(q.market) }, orderBy: { supersededAt: 'desc' }, take: clampTake(q.take, 100) });
        return rows.map((x) => ({ id: x.id, entityType: x.entityType, entityId: x.entityId, from: x.slug, to: x.replacedBy, status: x.replacedBy ? 301 : 410, supersededAt: x.supersededAt.toISOString() }));
    }
    async landingPages(q) {
        const market = (0, exports.marketOf)(q.market);
        const where = { market, ...(q.indexable === 'true' ? { indexable: true } : q.indexable === 'false' ? { indexable: false } : {}), ...(q.pageType ? { pageType: q.pageType } : {}) };
        const [rows, total] = await Promise.all([this.prisma.growthLandingPage.findMany({ where, orderBy: { updatedAt: 'desc' }, take: clampTake(q.take, 100) }), this.prisma.growthLandingPage.count({ where })]);
        return { total, items: rows.map((r) => ({ id: r.id, pageType: r.pageType, locale: r.locale, params: r.params, indexable: r.indexable, reasons: (r.guardResult?.reasons ?? []), lastRenderedAt: r.lastRenderedAt?.toISOString() ?? null })) };
    }
    async widgets(q) {
        const market = (0, exports.marketOf)(q.market);
        const [rows, policy, audit] = await Promise.all([
            this.prisma.widgetRegistration.findMany({ where: { market }, orderBy: { updatedAt: 'desc' }, take: 200 }),
            this.config.resolve('WIDGET_POLICY', { market }),
            this.prisma.auditLog.findMany({ where: { OR: [{ resource: 'WidgetRegistration' }, { action: { startsWith: 'growth.widget' } }] }, orderBy: { createdAt: 'desc' }, take: 50 }),
        ]);
        return {
            market, policy: { version: policy.version, source: policy.source, payload: policy.payload },
            registrations: rows.map((r) => ({ id: r.id, orgRef: r.orgRef, orgSlug: r.orgSlug, origins: r.origins, status: r.status, syncedAt: r.syncedAt.toISOString() })),
            audit: audit.map((a) => ({ id: a.id, actor: a.actor, action: a.action, resourceId: a.resourceId, metadata: a.metadata, createdAt: a.createdAt.toISOString() })),
        };
    }
    async setWidgetStatus(actor, orgRef, status) {
        const before = await this.prisma.widgetRegistration.findUnique({ where: { orgRef } });
        if (!before)
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'Unknown widget registration');
        const next = await this.prisma.widgetRegistration.update({ where: { orgRef }, data: { status } });
        await this.audit(actor, 'growth.widget.status', 'WidgetRegistration', orgRef, { from: before.status, to: next.status, origins: next.origins.length });
        return { orgRef, status: next.status };
    }
    async templates() {
        const { TEMPLATES } = await Promise.resolve().then(() => __importStar(require('../../engagement/engagement-public')));
        return Object.entries(TEMPLATES).map(([kind, t]) => {
            const purpose = t.marketing ? 'MARKETING' : t.reminder ? 'REMINDER' : 'TRANSACTIONAL';
            return {
                kind, templateId: t.templateId, purpose, consentClass: purpose === 'MARKETING' ? 'MARKETING_CONSENT_PER_CHANNEL' : purpose === 'REMINDER' ? 'REMINDERS_CONSENT' : 'NONE_REQUIRED',
                quietHoursBypass: !!t.bypassQuiet, placeholders: [...new Set([...t.en.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))], hasEn: !!t.en, hasAr: !!t.ar,
                metaApproval: t.templateId.startsWith('TODO_NEEDS_HUMAN') ? 'NEEDS_HUMAN' : 'ID_SET', en: t.en, ar: t.ar,
            };
        });
    }
    async integrations(q) {
        const market = (0, exports.marketOf)(q.market);
        const mg = await this.config.resolve('MARKET_GROWTH', { market }).catch(() => null);
        const sel = (mg?.payload?.integrations ?? {});
        const providers = env_1.PROVIDER_KINDS.map((kind) => {
            const e = (0, env_1.providerEnv)(kind);
            const secretRefs = [`${kind}_API_KEY`, `${kind}_WEBHOOK_SECRET`].map((name) => ({ name, set: !!process.env[name] }));
            return { kind, mode: e.mode, provider: e.provider, apiUrlSet: !!e.apiUrl, senderIdSet: !!e.senderId, secretRefs, problems: (0, env_1.providerProblems)(kind), ready: e.mode === 'mock' || (0, env_1.providerProblems)(kind).length === 0, selected: sel[kind.toLowerCase()] ?? null };
        });
        const flags = [];
        for (const key of MARKETING_FLAGS) {
            const r = await this.flags.evaluate(key, { market });
            flags.push({ key, effective: r.effective, reason: r.reason });
        }
        return { market, selection: sel, whatsappPhoneNumberIdRef: mg?.payload?.whatsappPhoneNumberIdRef ?? null, selectionVersion: mg?.version ?? null, selectionSource: mg?.source ?? null, providers, planned: exports.PLANNED_INTEGRATIONS, flags, rule: 'Configuration stores secret reference names only. Mock adapters are the default until the real-provider go-live pass (NEEDS_HUMAN).' };
    }
    async fraudSignals(q) {
        const market = (0, exports.marketOf)(q.market);
        if (q.status && !['OPEN', 'CONFIRMED', 'DISMISSED'].includes(q.status))
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'Unknown status');
        const where = { market, ...(q.status ? { reviewStatus: q.status } : {}), ...(q.ruleId ? { ruleId: q.ruleId } : {}) };
        const [rows, counts] = await Promise.all([this.prisma.growthFraudSignal.findMany({ where, orderBy: { createdAt: 'desc' }, take: clampTake(q.take, 100) }), this.prisma.growthFraudSignal.groupBy({ by: ['reviewStatus'], where: { market }, _count: { _all: true } })]);
        return {
            counts: Object.fromEntries(['OPEN', 'CONFIRMED', 'DISMISSED'].map((s) => [s, counts.find((c) => c.reviewStatus === s)?._count._all ?? 0])),
            items: rows.map((r) => ({ id: r.id, ruleId: r.ruleId, score: r.score, subject: r.subjectHash.slice(0, 10), evidenceRef: r.evidenceRef, createdAt: r.createdAt.toISOString(), reviewStatus: r.reviewStatus, reviewedBy: r.reviewedBy, reviewedAt: r.reviewedAt?.toISOString() ?? null, reviewNote: r.reviewNote })),
        };
    }
    async fraudThresholds(q) {
        const pol = await this.config.resolve('ATTRIBUTION_POLICY', { market: (0, exports.marketOf)(q.market) });
        const p = pol.payload;
        return {
            editable: false, note: 'Thresholds are code constants and attribution policy values today; a configurable fraud-threshold kind is planned for Phase 3 (fraud scoring and review).',
            rules: [
                { ruleId: touch_rules_1.FRAUD_RULES.CLICK_WITHOUT_RENDER, score: 20, threshold: `provider-owned touch with dwell < ${String(p.minDwellMsForProviderTouch)} ms`, source: 'ATTRIBUTION_POLICY.minDwellMsForProviderTouch', editableVia: 'ATTRIBUTION_POLICY' },
                { ruleId: touch_rules_1.FRAUD_RULES.BURST_PER_IP_HASH, score: 40, threshold: `more than ${(0, growth_limiter_1.growthLimits)().burstPerMin} touches per minute from one rotating hash`, source: 'GROWTH_FRAUD_BURST_PER_MIN (environment)', editableVia: null },
                { ruleId: touch_rules_1.FRAUD_RULES.PROVIDER_LED_SHARE_JUMP, score: '50-100', threshold: 'provider-led share in the last 24 h is 35 points above the organisation 30-day baseline (min 10 recent and 30 baseline decisions)', source: 'code constants', editableVia: null },
            ],
            rule: 'A signal is evidence for review. It never changes an attribution decision by itself.',
        };
    }
    async reviewFraud(actor, id, status, note) {
        const before = await this.prisma.growthFraudSignal.findUnique({ where: { id } });
        if (!before)
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'Unknown fraud signal');
        if (before.reviewStatus !== 'OPEN')
            throw new errors_1.ApiError(409, 'GROWTH_CONFIG_TRANSITION_FORBIDDEN', 'This signal was already reviewed', { reviewStatus: before.reviewStatus });
        const r = await this.prisma.growthFraudSignal.updateMany({ where: { id, reviewStatus: 'OPEN' }, data: { reviewStatus: status, reviewedBy: actor, reviewedAt: new Date(), reviewNote: note?.slice(0, 300) ?? null } });
        if (!r.count)
            throw new errors_1.ApiError(409, 'GROWTH_CONFIG_TRANSITION_FORBIDDEN', 'This signal was already reviewed');
        await this.audit(actor, 'growth.fraud.review', 'GrowthFraudSignal', id, { ruleId: before.ruleId, status, hasNote: !!note });
        return { id, reviewStatus: status };
    }
    async auditLog(q) {
        const when = {};
        for (const [k, v, key] of [['from', q.from, 'gte'], ['to', q.to, 'lt'], ['before', q.before, 'lt']]) {
            if (!v)
                continue;
            const d = new Date(v);
            if (Number.isNaN(d.getTime()))
                throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', `${k} must be an ISO date-time`);
            when[key] = key === 'lt' && when.lt ? new Date(Math.min(when.lt.getTime(), d.getTime())) : d;
        }
        const take = clampTake(q.take, 50);
        const rows = await this.prisma.auditLog.findMany({
            where: { AND: [{ OR: [{ action: { startsWith: 'growth.' } }, { resource: { startsWith: 'Growth' } }, { resource: 'WidgetRegistration' }] }, ...(q.action ? [{ action: { startsWith: q.action.slice(0, 80) } }] : []), ...(q.actor ? [{ actor: q.actor.slice(0, 80) }] : []), ...(q.resource ? [{ resource: q.resource.slice(0, 80) }] : []), ...(Object.keys(when).length ? [{ createdAt: when }] : [])] },
            orderBy: { createdAt: 'desc' }, take: take + 1,
        });
        const page = rows.slice(0, take);
        return { items: page.map((a) => ({ id: a.id, actor: a.actor, action: a.action, resource: a.resource, resourceId: a.resourceId, metadata: a.metadata, createdAt: a.createdAt.toISOString() })), nextBefore: rows.length > take ? page[page.length - 1].createdAt.toISOString() : null };
    }
    async marketConfigs() {
        const { marketFacts, marketProfile } = await Promise.resolve().then(() => __importStar(require('../../market/market-public')));
        const defs = await this.prisma.flagDefinition.findMany({ where: { key: { startsWith: 'market.', endsWith: '.live' } }, select: { key: true } });
        const listed = [];
        for (const cc of defs.map((d) => d.key.split('.')[1].toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)).sort()) {
            const r = await this.flags.evaluate(`market.${cc.toLowerCase()}.live`, { market: cc });
            listed.push({ code: cc, live: r.effective, state: r.effective ? 'LIVE' : r.reason });
        }
        const out = [];
        for (const m of listed) {
            const [growth, consent, attribution, seo, widget, districts, cities] = await Promise.all([
                this.config.resolve('MARKET_GROWTH', { market: m.code }).catch(() => null), this.config.resolve('CONSENT_DEFAULTS', { market: m.code }), this.config.resolve('ATTRIBUTION_POLICY', { market: m.code }),
                this.config.resolve('SEO', { market: m.code }), this.config.resolve('WIDGET_POLICY', { market: m.code }),
                this.prisma.growthSlug.count({ where: { market: m.code, entityType: 'DISTRICT' } }), this.prisma.growthSlug.count({ where: { market: m.code, entityType: 'CITY' } }),
            ]);
            const flags = [];
            for (const key of MARKETING_FLAGS) {
                const r = await this.flags.evaluate(key, { market: m.code });
                flags.push({ key, effective: r.effective, reason: r.reason });
            }
            const facts = marketFacts(m.code);
            const prof = marketProfile(m.code);
            const own = (r) => !!prof || r?.source === 'ACTIVE';
            const g = (growth && own(growth) ? growth.payload : {});
            const c = (own(consent) ? consent.payload : {});
            const a = attribution.payload;
            const brief = (r) => (r ? { version: r.version, source: r.source, scope: r.scope } : null);
            out.push({
                code: m.code, live: m.live, state: m.state, name: facts.name, currency: facts.currency || (g.currency ?? ''), phoneCode: facts.phoneCode || (g.phoneCode ?? ''), locales: g.locales ?? seo.payload.locales,
                timeZone: prof?.timezone ?? c.quietHoursTimezone ?? null, quietHours: { start: prof?.quietHours.start ?? c.quietHoursStart ?? null, end: prof?.quietHours.end ?? c.quietHoursEnd ?? null }, consent: { regimeId: c.regimeId, maxMarketingPerDay: c.maxMarketingPerDay, maxMarketingPerWeek: c.maxMarketingPerWeek, withdrawalPropagationSeconds: c.withdrawalPropagationSeconds },
                retention: { touchEvidenceRetentionMonths: a.touchEvidenceRetentionMonths, unlinkedTouchRetentionMonths: a.unlinkedTouchRetentionMonths, visitorKeyMaxDays: a.visitorKeyMaxDays },
                marketing: { marketingLicenceConfirmed: g.marketingLicenceConfirmed ?? false, qrEnabled: g.qrEnabled ?? null, flags },
                geography: { geographyListRef: g.geographyListRef ?? null, cities, districts, note: 'District list is the market-pack list (NEEDS_HUMAN NH-040); this console only stores the reference.' },
                integrations: g.integrations ?? {}, versions: { MARKET_GROWTH: brief(growth), CONSENT_DEFAULTS: brief(consent), ATTRIBUTION_POLICY: brief(attribution), SEO: brief(seo), WIDGET_POLICY: brief(widget) },
            });
        }
        return out;
    }
    async analytics(q) {
        const market = (0, exports.marketOf)(q.market);
        const days = clampDays(q.days, 14);
        const since = new Date(Date.now() - days * 86_400_000);
        const rows = await this.prisma.$queryRaw `SELECT date_trunc('day', "occurredAt")::date AS day, "name", count(*)::int AS n FROM "GrowthEvent" WHERE "market" = ${market} AND "occurredAt" >= ${since} GROUP BY 1, 2 ORDER BY 1 ASC, 2 ASC`;
        const decisions = await this.prisma.$queryRaw `SELECT date_trunc('day', "createdAt")::date AS day, "origin", count(*)::int AS n FROM "GrowthAttributionDecision" WHERE "market" = ${market} AND "createdAt" >= ${since} AND "supersedesId" IS NULL GROUP BY 1, 2 ORDER BY 1 ASC, 2 ASC`;
        return { market, days, source: 'internal', note: 'Raw growth tables. The analytics v1 rollup (package J) adds k-anonymity, dimensions and the metric definitions of KX-32 and will replace this view.', events: rows.map((r) => ({ day: r.day.toISOString().slice(0, 10), name: r.name, count: r.n })), decisions: decisions.map((r) => ({ day: r.day.toISOString().slice(0, 10), origin: r.origin, count: r.n })) };
    }
    async finance(q) {
        const market = (0, exports.marketOf)(q.market);
        const days = clampDays(q.days);
        const since = new Date(Date.now() - days * 86_400_000);
        const origins = await this.prisma.growthAttributionDecision.groupBy({ by: ['origin'], where: { market, createdAt: { gte: since }, supersedesId: null }, _count: { _all: true } });
        const corrections = await this.prisma.growthAttributionDecision.count({ where: { market, createdAt: { gte: since }, supersedesId: { not: null } } });
        const count = (o) => origins.find((x) => x.origin === o)?._count._all ?? 0;
        let revenue = null;
        try {
            const rows = await this.prisma.$queryRaw `SELECT "kind", count(*)::int AS n, sum("amountMinor") AS sum, max("currency") AS currency FROM "GrowthRevenueFact" WHERE "market" = ${market} AND "occurredAt" >= ${since} GROUP BY "kind"`;
            revenue = { charges: Number(rows.find((r) => r.kind === 'CHARGE')?.sum ?? 0), reversals: Number(rows.find((r) => r.kind === 'REVERSAL')?.sum ?? 0), currency: rows[0]?.currency ?? 'EGP' };
        }
        catch {
            revenue = null;
        }
        return { market, days, decisions: { providerLed: count('PROVIDER_LED'), marketplace: count('MARKETPLACE'), unattributed: count('UNATTRIBUTED'), corrections }, revenueFacts: revenue, rule: 'Provider-led bookings never carry the platform fee and evidence can only remove a fee, never add one. Amounts live in the commission statements and the Fees page.' };
    }
};
exports.GrowthAdminService = GrowthAdminService;
exports.GrowthAdminService = GrowthAdminService = __decorate([
    (0, common_1.Injectable)(),
    __param(3, (0, common_1.Inject)(growth_overview_source_1.GROWTH_OVERVIEW_SOURCE)),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, growth_config_service_1.GrowthConfigService, control_plane_public_1.FlagsService, Object])
], GrowthAdminService);
//# sourceMappingURL=growth-admin.service.js.map