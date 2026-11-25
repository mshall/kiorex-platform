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
exports.SeoSiteAdapter = void 0;
const common_1 = require("@nestjs/common");
const cache_tags_1 = require("./cache-tags");
const geo_1 = require("./geo");
const page_snapshot_service_1 = require("./page-snapshot.service");
const redirects_service_1 = require("./redirects.service");
const seo_audit_1 = require("./seo-audit");
const site_data_service_1 = require("./site-data.service");
const sitemap_service_1 = require("./sitemap.service");
const site_config_1 = require("./site.config");
const url_policy_1 = require("./url-policy");
const lite = (p) => ({ id: p.id, careType: p.careType, clinicId: p.clinicId, specialty: p.specialty, governorate: p.governorate, area: p.area, ratingAvg: p.ratingAvg, ratingCount: p.ratingCount, nextSlotAt: p.nextSlotAt, nameEn: p.nameEn, nameAr: p.nameAr, clinicNameEn: p.clinicNameEn, clinicNameAr: p.clinicNameAr, citySlug: (0, geo_1.slugifyPlace)(p.governorate), areaSlug: (0, geo_1.slugifyPlace)(p.area), specialtySlug: p.specialty ? (0, geo_1.specialtySegment)(p.specialty) : null });
let SeoSiteAdapter = class SeoSiteAdapter {
    pages;
    sitemap;
    data;
    redirects;
    cache;
    constructor(pages, sitemap, data, redirects, cache) {
        this.pages = pages;
        this.sitemap = sitemap;
        this.data = data;
        this.redirects = redirects;
        this.cache = cache;
    }
    available() { return this.pages.available(); }
    host() { return (0, site_config_1.siteCfg)().canonicalHost; }
    async entries(market) { return (await this.sitemap.entries(market)).entries.map((e) => ({ type: e.type, rest: e.rest })); }
    async capture(market, locale, rest) {
        const c = await this.pages.capture(market, locale, rest);
        if (!c)
            return null;
        if (c.status !== 200)
            return { status: c.status, type: c.type, params: c.params, title: '', description: '', h1: [], bodyHtml: '', jsonLd: [], canonical: '', alternates: [], robots: '', links: [], reviews: 0 };
        const h = (0, seo_audit_1.parseHead)(c.document);
        const host = (0, site_config_1.siteCfg)().canonicalHost;
        const d = c.data;
        return { status: 200, type: c.type, params: c.params, title: h.title, description: h.description, h1: h.h1, bodyHtml: c.bodyHtml, jsonLd: h.jsonLd.map((j) => j.value), canonical: h.canonical, alternates: h.alternates, robots: h.robots, links: h.links.filter((l) => l.startsWith('/') || l.startsWith(host)), reviews: Array.isArray(d?.reviews) ? d.reviews.length : 0 };
    }
    async snapshot(market) {
        const s = await this.data.snapshot(market);
        return {
            seo: { reviewMarkupEnabled: s.seo.reviewMarkupEnabled, reviewMarkupMinCount: s.seo.reviewMarkupMinCount, minAvailableProviders: s.seo.minAvailableProviders },
            facets: s.facets.all.map((f) => ({ type: f.type, params: f.params, providers: f.providers.map(lite), city: f.city, district: f.district, specialtyCode: f.specialtyCode })),
            providers: s.index.providers.filter((p) => p.status === 'LIVE' && p.listed).map(lite),
        };
    }
    slugs(market, entity, ids) { return this.redirects.slugsFor(market, entity, ids); }
    route(path) { const r = (0, url_policy_1.parsePublicPath)(path); return r.kind === 'match' ? { type: r.value.type, params: r.value.params } : null; }
    refresh() { this.data.invalidate(); this.sitemap.invalidate(); this.cache.purgeAll(); }
};
exports.SeoSiteAdapter = SeoSiteAdapter;
exports.SeoSiteAdapter = SeoSiteAdapter = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [page_snapshot_service_1.PageSnapshotService, sitemap_service_1.SitemapService, site_data_service_1.SiteDataService, redirects_service_1.RedirectsService, cache_tags_1.PublicSiteCache])
], SeoSiteAdapter);
//# sourceMappingURL=seo-site.adapter.js.map