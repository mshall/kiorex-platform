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
exports.SitemapService = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const seo_automation_public_1 = require("../growth/seo-automation/seo-automation-public");
const url_policy_1 = require("./url-policy");
const sitemap_xml_1 = require("./sitemap.xml");
const redirects_service_1 = require("./redirects.service");
const site_data_service_1 = require("./site-data.service");
const site_index_service_1 = require("./site-index.service");
const site_config_1 = require("./site.config");
let SitemapService = class SitemapService {
    data;
    redirects;
    index;
    moduleRef;
    built = new Map();
    constructor(data, redirects, index, moduleRef) {
        this.data = data;
        this.redirects = redirects;
        this.index = index;
        this.moduleRef = moduleRef;
    }
    get quality() { try {
        return this.moduleRef.get(seo_automation_public_1.SEO_QUALITY, { strict: false });
    }
    catch {
        return undefined;
    } }
    invalidate() { this.built.clear(); }
    async entries(market) {
        const hit = this.built.get(market);
        if (hit && Date.now() - hit.at < (0, site_config_1.siteCfg)().sitemapTtlSeconds * 1000)
            return hit;
        const s = await this.data.snapshot(market);
        const out = [];
        const maxOf = (ds) => ds.reduce((m, d) => (d && (!m || d > m) ? d : m), null);
        out.push({ type: 'home', rest: '', lastmod: maxOf(s.facets.visible.map((p) => p.lastModified)) });
        for (const f of s.facets.all) {
            if (!f.guard.indexable)
                continue;
            const path = (0, url_policy_1.buildPath)('ar', market, f.type, f.params);
            out.push({ type: f.type, rest: path.split('/').slice(3).join('/'), lastmod: f.lastModified });
        }
        const visible = s.facets.visible;
        const slugs = await this.redirects.slugsFor(market, 'DOCTOR', visible.map((p) => p.id));
        for (const p of visible) {
            const slug = slugs.get(p.id);
            if (!slug)
                continue;
            const kind = p.careType === 'HOME_NURSING' ? 'nurse' : 'doctor';
            out.push({ type: kind, rest: `${kind}/${slug}`, lastmod: p.lastModified });
        }
        const byClinic = new Map();
        for (const p of visible) {
            const d = byClinic.get(p.clinicId);
            if (!d || p.lastModified > d)
                byClinic.set(p.clinicId, p.lastModified);
        }
        const clinicSlugs = await this.redirects.slugsFor(market, 'CLINIC', [...byClinic.keys()]);
        for (const [clinicId, lastmod] of byClinic) {
            const slug = clinicSlugs.get(clinicId);
            if (slug)
                out.push({ type: 'clinic', rest: `clinic/${slug}`, lastmod });
        }
        for (const [kind, entity] of [['pharmacy', 'PHARMACY'], ['lab', 'LAB']]) {
            const list = s.index.partners.filter((x) => x.kind === entity);
            const pslugs = await this.redirects.slugsFor(market, entity, list.map((x) => x.id));
            for (const x of list) {
                const slug = pslugs.get(x.id);
                if (slug)
                    out.push({ type: kind, rest: `${kind}/${slug}`, lastmod: x.lastModified });
            }
        }
        out.sort((a, b) => (a.type === b.type ? (a.rest < b.rest ? -1 : 1) : a.type < b.type ? -1 : 1));
        const built = { at: Date.now(), entries: out, shardSize: Math.max(1, Math.min(s.seo.sitemapShardSize, 50_000)), host: (0, site_config_1.siteCfg)().canonicalHost };
        this.built.set(market, built);
        return built;
    }
    group(b) {
        const g = new Map();
        for (const e of b.entries)
            g.set(e.type, [...(g.get(e.type) ?? []), e]);
        return g;
    }
    async indexXml() {
        const cfg = (0, site_config_1.siteCfg)();
        const refs = [];
        if (cfg.indexable) {
            for (const market of await this.index.liveMarkets()) {
                const b = await this.entries(market);
                for (const [type, list] of [...this.group(b)].sort(([a], [c]) => (a < c ? -1 : 1))) {
                    for (const locale of url_policy_1.LOCALES) {
                        for (let n = 1; n <= Math.ceil(list.length / b.shardSize); n++) {
                            const slice = list.slice((n - 1) * b.shardSize, n * b.shardSize);
                            refs.push({ loc: `${b.host}/sitemaps/${(0, sitemap_xml_1.shardName)(type, market, locale, n)}`, lastmod: slice.reduce((m, e) => (e.lastmod && (!m || e.lastmod > m) ? e.lastmod : m), null) });
                        }
                    }
                }
            }
        }
        return { xml: (0, sitemap_xml_1.buildSitemapIndex)(refs), lastmod: refs.reduce((m, r) => (r.lastmod && (!m || r.lastmod > m) ? r.lastmod : m), null) };
    }
    async shardXml(file) {
        const p = (0, sitemap_xml_1.parseShardName)(file);
        if (!p || !(0, site_config_1.siteCfg)().indexable)
            return null;
        const market = p.cc.toUpperCase();
        if (!(await this.index.marketLive(market)))
            return null;
        const b = await this.entries(market);
        let list = this.group(b).get(p.type);
        if (!list)
            return null;
        const blocked = (await this.quality?.blockedSet(market, p.locale).catch(() => undefined)) ?? new Set();
        if (blocked.size) {
            list = list.filter((e) => { const r = (0, url_policy_1.parsePublicPath)(`/${p.locale}/${p.cc}${e.rest ? `/${e.rest}` : ''}`); return r.kind !== 'match' || !blocked.has((0, seo_automation_public_1.pageKeyOf)(r.value.type, r.value.params)); });
            if (!list.length)
                return null;
        }
        const slice = list.slice((p.n - 1) * b.shardSize, p.n * b.shardSize);
        if (!slice.length)
            return null;
        const urls = slice.map((e) => ({
            loc: (0, url_policy_1.canonicalUrl)(b.host, `/${p.locale}/${p.cc}${e.rest ? `/${e.rest}` : ''}`),
            lastmod: e.lastmod,
            alternates: (0, url_policy_1.hreflangAlternates)(b.host, p.cc, e.rest),
        }));
        return { xml: (0, sitemap_xml_1.buildUrlset)(urls, b.shardSize), lastmod: slice.reduce((m, e) => (e.lastmod && (!m || e.lastmod > m) ? e.lastmod : m), null) };
    }
};
exports.SitemapService = SitemapService;
exports.SitemapService = SitemapService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [site_data_service_1.SiteDataService, redirects_service_1.RedirectsService, site_index_service_1.SiteIndexService, core_1.ModuleRef])
], SitemapService);
//# sourceMappingURL=sitemap.service.js.map