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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SeoOpsController = void 0;
const market_core_public_1 = require("../market/market-core-public");
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const auth_1 = require("../common/auth");
const seo_public_1 = require("../growth/seo/seo-public");
const prisma_service_1 = require("../prisma/prisma.service");
const search_engines_1 = require("./search-engines");
const seo_config_service_1 = require("./seo-config.service");
const seo_pages_service_1 = require("./seo-pages.service");
const sitemap_service_1 = require("./sitemap.service");
const OBJ = { schema: { type: 'object', additionalProperties: true } };
const market = (m) => (m && /^[A-Za-z]{2}$/.test(m) ? m.toUpperCase() : market_core_public_1.DEFAULT_MARKET);
const lim = (n, d = 100, max = 500) => { const v = Number(n); return Number.isInteger(v) && v >= 1 ? Math.min(v, max) : d; };
let SeoOpsController = class SeoOpsController {
    pages;
    seo;
    bootstrap;
    sitemaps;
    engines;
    submitJob;
    prisma;
    constructor(pages, seo, bootstrap, sitemaps, engines, submitJob, prisma) {
        this.pages = pages;
        this.seo = seo;
        this.bootstrap = bootstrap;
        this.sitemaps = sitemaps;
        this.engines = engines;
        this.submitJob = submitJob;
        this.prisma = prisma;
    }
    async overview(m) {
        const mk = market(m);
        const inv = await this.pages.inventory(mk, { limit: 1 });
        const sm = await this.sitemaps.entries(mk);
        const byType = {};
        for (const e of sm.entries)
            byType[e.type] = (byType[e.type] ?? 0) + 1;
        return { market: mk, pages: { total: inv.total, indexable: inv.indexable, noindex: inv.noindex, byReason: inv.byReason }, sitemap: { urlsByType: byType, total: sm.entries.length, shardSize: sm.shardSize }, slugs: await this.pages.slugCoverage(mk), searchEngines: this.engines.status() };
    }
    pagesList(m, type, indexable, limit, offset) {
        return this.pages.inventory(market(m), { type: type || undefined, indexable: indexable === undefined || indexable === '' ? undefined : indexable === 'true', limit: lim(limit), offset: Number(offset) > 0 ? Number(offset) : 0 });
    }
    async slugs(m, entityType, q, limit) {
        const where = { market: market(m), ...(entityType ? { entityType } : {}), ...(q ? { slug: { contains: q.toLowerCase() } } : {}) };
        const [total, items] = await Promise.all([this.prisma.growthSlug.count({ where }), this.prisma.growthSlug.findMany({ where, orderBy: [{ entityType: 'asc' }, { slug: 'asc' }], take: lim(limit), select: { entityType: true, entityId: true, slug: true, createdAt: true, updatedAt: true } })]);
        return { total, items };
    }
    async redirects(m, limit) {
        const mk = market(m);
        const cfg = await this.seo.get(mk);
        const now = Date.now();
        const history = await this.prisma.growthSlugHistory.findMany({ where: { market: mk }, orderBy: { supersededAt: 'desc' }, take: lim(limit), select: { entityType: true, entityId: true, slug: true, replacedBy: true, supersededAt: true } });
        const delisted = await this.prisma.provider.findMany({ where: { market: mk, status: { notIn: ['LIVE', 'PAUSED'] } }, take: lim(limit), orderBy: { syncedAt: 'desc' }, select: { id: true, status: true, specialty: true, syncedAt: true } });
        return {
            slugHistory: history.map((h) => ({ ...h, status: 301, to: h.replacedBy })),
            delisted: delisted.map((d) => ({ providerId: d.id, status: d.status, delistedSince: d.syncedAt, answers: (now - d.syncedAt.getTime()) / 86_400_000 >= cfg.delistedGoneAfterDays ? '410 (or 301 to the specialty hub when it is indexable)' : '404 (or 301 to the specialty hub when it is indexable)' })),
            goneAfterDays: cfg.delistedGoneAfterDays,
        };
    }
    async config(m) {
        const mk = market(m);
        const resolved = await this.seo.get(mk);
        const rows = await this.prisma.growthConfigVersion.findMany({ where: { kind: 'SEO', status: 'ACTIVE', OR: [{ scope: 'GLOBAL', scopeId: '' }, { scope: 'MARKET', scopeId: mk }] }, orderBy: { version: 'asc' }, select: { id: true, version: true, scope: true, scopeId: true, effectiveFrom: true } });
        return { market: mk, resolved, activeVersions: rows, defaults: (0, seo_public_1.SEO_EXTENSION_DEFAULTS)(), templateKeys: seo_public_1.TEMPLATE_KEYS, placeholders: seo_public_1.TEMPLATE_PLACEHOLDERS, hook: 'POST /ops/growth/seo/config/validate' };
    }
    validate(body) { return (0, seo_public_1.validateSeoExtensions)(body); }
    async rebuild(u, m) {
        const mk = market(m);
        this.seo.invalidate();
        this.sitemaps.invalidate();
        const r = await this.pages.rebuild(mk);
        await this.prisma.auditLog.create({ data: { actor: u.sub, action: 'growth.seo.rebuild', resource: 'GrowthLandingPage', metadata: { ...r } } });
        return r;
    }
    async slugBootstrap(u, m, body) {
        const r = await this.bootstrap.runOnce({ market: market(m), dryRun: body?.dryRun === true });
        if (!r.dryRun)
            await this.prisma.auditLog.create({ data: { actor: u.sub, action: 'growth.seo.slugs.bootstrap', resource: 'GrowthSlug', metadata: { created: r.created, existing: r.existing, collisions: r.collisions } } });
        return r;
    }
    searchEngines() { return this.engines.status(); }
    async performance(from, to) { return { mode: this.engines.mode, rows: await this.engines.performance({ from, to }) }; }
    async submit() { return { mode: this.engines.mode, results: await this.submitJob.runOnce() }; }
};
exports.SeoOpsController = SeoOpsController;
__decorate([
    (0, common_1.Get)('overview'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-F SEO overview: page counts and guard reasons, slug coverage, sitemap sizes, search-engine status' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    (0, swagger_1.ApiQuery)({ name: 'market', required: false }),
    __param(0, (0, common_1.Query)('market')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], SeoOpsController.prototype, "overview", null);
__decorate([
    (0, common_1.Get)('pages'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-F generated pages with guard results (read-only)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    (0, swagger_1.ApiQuery)({ name: 'market', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'type', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'indexable', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'limit', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'offset', required: false }),
    __param(0, (0, common_1.Query)('market')),
    __param(1, (0, common_1.Query)('type')),
    __param(2, (0, common_1.Query)('indexable')),
    __param(3, (0, common_1.Query)('limit')),
    __param(4, (0, common_1.Query)('offset')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, String]),
    __metadata("design:returntype", void 0)
], SeoOpsController.prototype, "pagesList", null);
__decorate([
    (0, common_1.Get)('slugs'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-F slugs (read-only)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    (0, swagger_1.ApiQuery)({ name: 'market', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'entityType', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'q', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'limit', required: false }),
    __param(0, (0, common_1.Query)('market')),
    __param(1, (0, common_1.Query)('entityType')),
    __param(2, (0, common_1.Query)('q')),
    __param(3, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String]),
    __metadata("design:returntype", Promise)
], SeoOpsController.prototype, "slugs", null);
__decorate([
    (0, common_1.Get)('redirects'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-F redirect inventory: slug history (301) and delisted providers (301 to the hub or 404 then 410)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    (0, swagger_1.ApiQuery)({ name: 'market', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'limit', required: false }),
    __param(0, (0, common_1.Query)('market')),
    __param(1, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], SeoOpsController.prototype, "redirects", null);
__decorate([
    (0, common_1.Get)('config'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-F resolved SEO configuration with the template catalogue (read-only)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    (0, swagger_1.ApiQuery)({ name: 'market', required: false }),
    __param(0, (0, common_1.Query)('market')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], SeoOpsController.prototype, "config", null);
__decorate([
    (0, common_1.Post)('config/validate'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-F validate SEO extension keys (templates, pagination, review markup, thresholds) before a config version is stored (hook for package K); stores nothing' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], SeoOpsController.prototype, "validate", null);
__decorate([
    (0, common_1.Post)('rebuild'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-F rebuild the page guard table, drop caches (audited)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    (0, swagger_1.ApiQuery)({ name: 'market', required: false }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Query)('market')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], SeoOpsController.prototype, "rebuild", null);
__decorate([
    (0, common_1.Post)('slugs/bootstrap'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-F slug bootstrap and backfill for LIVE providers, clinics, pharmacies and labs (idempotent; dryRun reports only; audited)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    (0, swagger_1.ApiQuery)({ name: 'market', required: false }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Query)('market')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], SeoOpsController.prototype, "slugBootstrap", null);
__decorate([
    (0, common_1.Get)('search-engines'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-F Search Console and Bing integration status (mock by default)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], SeoOpsController.prototype, "searchEngines", null);
__decorate([
    (0, common_1.Get)('search-engines/performance'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-F performance pull through the integration abstraction (mock rows are labelled sample)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('from')),
    __param(1, (0, common_1.Query)('to')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], SeoOpsController.prototype, "performance", null);
__decorate([
    (0, common_1.Post)('search-engines/submit-sitemap'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-F submit the sitemap index to the search engines through the adapter (mock by default)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SeoOpsController.prototype, "submit", null);
exports.SeoOpsController = SeoOpsController = __decorate([
    (0, swagger_1.ApiTags)('growth'),
    (0, auth_1.OpsOnly)(),
    (0, common_1.Controller)('ops/growth/seo'),
    __metadata("design:paramtypes", [seo_pages_service_1.SeoPagesService, seo_config_service_1.SeoConfigService, seo_public_1.SlugBootstrapService, sitemap_service_1.SitemapService,
        search_engines_1.SearchEngineService, search_engines_1.SitemapSubmitJob, prisma_service_1.PrismaService])
], SeoOpsController);
//# sourceMappingURL=seo-ops.controller.js.map