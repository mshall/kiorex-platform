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
exports.PageSnapshotService = void 0;
const common_1 = require("@nestjs/common");
const head_1 = require("./head");
const site_data_service_1 = require("./site-data.service");
const seo_config_service_1 = require("./seo-config.service");
const ssr_renderer_1 = require("./ssr-renderer");
const site_config_1 = require("./site.config");
const url_policy_1 = require("./url-policy");
let PageSnapshotService = class PageSnapshotService {
    data;
    renderer;
    seo;
    constructor(data, renderer, seo) {
        this.data = data;
        this.renderer = renderer;
        this.seo = seo;
    }
    available() { return this.renderer.available(); }
    async capture(market, locale, rest) {
        const cc = market.toLowerCase();
        const path = `/${locale}/${cc}${rest ? `/${rest}` : ''}`;
        const parsed = (0, url_policy_1.parsePublicPath)(path);
        if (parsed.kind !== 'match')
            return null;
        const route = parsed.value;
        const q = { page: 1, sort: null };
        const loaded = await this.data.load(route, q);
        if (loaded.status !== 200)
            return { status: loaded.status, document: '', bodyHtml: '', data: null, type: route.type, params: route.params, rest: route.rest, guardIndexable: false, noindexReasons: [], meta: { title: '', description: '' } };
        const cfg = (0, site_config_1.siteCfg)();
        const seo = await this.seo.get(market);
        const out = await this.renderer.render({ locale, cc, type: route.type, path, query: q, data: loaded.data, site: { canonicalHost: cfg.canonicalHost, reviewMarkup: seo.reviewMarkupEnabled, templates: seo.templates } });
        const doc = (0, head_1.composeDocument)({
            locale, cc, canonical: (0, url_policy_1.canonicalUrl)(cfg.canonicalHost, path, q), alternates: (0, url_policy_1.hreflangAlternates)(cfg.canonicalHost, route.cc, route.rest), indexable: loaded.indexable, title: out.meta.title, description: out.meta.description,
            ogImage: out.meta.ogImage ?? `${cfg.canonicalHost}/og-image.png`, siteName: 'Kiorex', jsonLd: out.jsonLd, bodyHtml: out.html,
            state: { locale, cc, type: route.type, path, query: q, data: loaded.data }, assets: { css: '', script: null, modulePreloads: [], fontPreloads: [] },
        });
        return { status: 200, document: doc.html, bodyHtml: out.html, data: loaded.data, type: route.type, params: route.params, rest: route.rest, guardIndexable: loaded.indexable, noindexReasons: loaded.noindexReasons, meta: { title: out.meta.title, description: out.meta.description } };
    }
};
exports.PageSnapshotService = PageSnapshotService;
exports.PageSnapshotService = PageSnapshotService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [site_data_service_1.SiteDataService, ssr_renderer_1.SiteRenderer, seo_config_service_1.SeoConfigService])
], PageSnapshotService);
//# sourceMappingURL=page-snapshot.service.js.map