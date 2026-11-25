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
exports.SeoPagesService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const cache_tags_1 = require("./cache-tags");
const redirects_service_1 = require("./redirects.service");
const site_data_service_1 = require("./site-data.service");
const url_policy_1 = require("./url-policy");
const LANDING_TYPE = { hub: 'HUB', city: 'SPECIALTY_CITY', district: 'SPECIALTY_DISTRICT', 'care-district': 'CARE_TYPE_DISTRICT', 'city-hub': 'CITY_HUB', 'district-hub': 'DISTRICT_HUB', 'same-day': 'SAME_DAY', telemedicine: 'TELEMEDICINE' };
let SeoPagesService = class SeoPagesService {
    data;
    cache;
    prisma;
    redirects;
    constructor(data, cache, prisma, redirects) {
        this.data = data;
        this.cache = cache;
        this.prisma = prisma;
        this.redirects = redirects;
    }
    row(f, market) {
        return {
            type: f.type, key: f.key, path: { ar: (0, url_policy_1.buildPath)('ar', market, f.type, f.params), en: (0, url_policy_1.buildPath)('en', market, f.type, f.params) }, indexable: f.guard.indexable, reasons: f.guard.reasons,
            providers: f.providers.length, uniqueBlocks: f.uniqueBlocks, siblingOverlapPercent: f.overlapPercent, parentOverlapPercent: f.parentOverlapPercent, lastModified: f.lastModified?.toISOString() ?? null,
        };
    }
    async inventory(market, f = {}) {
        const snap = await this.data.snapshot(market);
        const rows = snap.facets.all.map((x) => this.row(x, market)).sort((a, b) => (a.type === b.type ? (a.key < b.key ? -1 : 1) : a.type < b.type ? -1 : 1));
        const byReason = {};
        for (const r of rows)
            for (const reason of r.reasons)
                byReason[reason] = (byReason[reason] ?? 0) + 1;
        const filtered = rows.filter((r) => (!f.type || r.type === f.type) && (f.indexable === undefined || r.indexable === f.indexable));
        const off = Math.max(0, f.offset ?? 0);
        const lim = Math.min(Math.max(1, f.limit ?? 100), 500);
        return { total: rows.length, indexable: rows.filter((r) => r.indexable).length, noindex: rows.filter((r) => !r.indexable).length, byReason, items: filtered.slice(off, off + lim) };
    }
    async rebuild(market) {
        this.cache.purgeAll();
        const snap = await this.data.snapshot(market);
        const seen = new Set();
        let written = 0;
        for (const f of snap.facets.all) {
            for (const locale of ['ar', 'en']) {
                const pageType = LANDING_TYPE[f.type];
                seen.add(`${pageType}|${locale}|${f.key}`);
                await this.prisma.growthLandingPage.upsert({
                    where: { market_pageType_locale_paramsKey: { market, pageType, locale, paramsKey: f.key } },
                    create: { market, pageType, locale, paramsKey: f.key, params: f.params, indexable: f.guard.indexable, guardResult: { reasons: f.guard.reasons, providers: f.providers.length, uniqueBlocks: f.uniqueBlocks, siblingOverlapPercent: f.overlapPercent, parentOverlapPercent: f.parentOverlapPercent }, lastRenderedAt: new Date() },
                    update: { params: f.params, indexable: f.guard.indexable, guardResult: { reasons: f.guard.reasons, providers: f.providers.length, uniqueBlocks: f.uniqueBlocks, siblingOverlapPercent: f.overlapPercent, parentOverlapPercent: f.parentOverlapPercent }, lastRenderedAt: new Date() },
                });
                written++;
            }
        }
        const old = await this.prisma.growthLandingPage.findMany({ where: { market, indexable: true }, select: { id: true, pageType: true, locale: true, paramsKey: true } });
        const stale = old.filter((o) => !seen.has(`${o.pageType}|${o.locale}|${o.paramsKey}`)).map((o) => o.id);
        if (stale.length)
            await this.prisma.growthLandingPage.updateMany({ where: { id: { in: stale } }, data: { indexable: false, guardResult: { reasons: ['NO_LONGER_GENERATED'] } } });
        const idx = snap.facets.all.filter((f) => f.guard.indexable).length;
        return { market, pages: snap.facets.all.length, indexable: idx, noindex: snap.facets.all.length - idx, landingRowsWritten: written, staleRowsDeactivated: stale.length };
    }
    async slugCoverage(market) {
        const rows = await this.prisma.provider.findMany({ where: { market, status: { in: ['LIVE', 'PAUSED'] } }, select: { id: true, clinicId: true } });
        const ps = await this.redirects.slugsFor(market, 'DOCTOR', rows.map((r) => r.id));
        const clinicIds = [...new Set(rows.map((r) => r.clinicId))];
        const cs = await this.redirects.slugsFor(market, 'CLINIC', clinicIds);
        return { providersLive: rows.length, providersWithSlug: ps.size, clinicsLive: clinicIds.length, clinicsWithSlug: cs.size, missingProviderIds: rows.filter((r) => !ps.has(r.id)).map((r) => r.id).slice(0, 100) };
    }
};
exports.SeoPagesService = SeoPagesService;
exports.SeoPagesService = SeoPagesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [site_data_service_1.SiteDataService, cache_tags_1.PublicSiteCache, prisma_service_1.PrismaService, redirects_service_1.RedirectsService])
], SeoPagesService);
//# sourceMappingURL=seo-pages.service.js.map