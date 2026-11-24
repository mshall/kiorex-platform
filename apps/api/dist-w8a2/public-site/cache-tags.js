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
exports.PublicSiteCache = exports.CdnPurger = void 0;
const common_1 = require("@nestjs/common");
const page_cache_1 = require("./page-cache");
const metrics_1 = require("./metrics");
const sitemap_service_1 = require("./sitemap.service");
const site_data_service_1 = require("./site-data.service");
const site_config_1 = require("./site.config");
let CdnPurger = class CdnPurger {
    log = new common_1.Logger('CdnPurger');
    recent = [];
    async purge(paths) {
        if (!paths.length)
            return;
        if ((0, site_config_1.siteCfg)().cdnPurgeMode === 'real') {
            this.log.warn(`SITE_CDN_PURGE_MODE=real is not implemented yet (NEEDS_HUMAN: distribution id and IAM role); ${paths.length} path(s) NOT purged`);
            return;
        }
        this.recent.push({ at: new Date().toISOString(), paths });
        if (this.recent.length > 50)
            this.recent.shift();
        this.log.debug(`mock CDN purge: ${paths.length} path(s)`);
    }
};
exports.CdnPurger = CdnPurger;
exports.CdnPurger = CdnPurger = __decorate([
    (0, common_1.Injectable)()
], CdnPurger);
let PublicSiteCache = class PublicSiteCache {
    data;
    sitemap;
    cdn;
    cfg = (0, site_config_1.siteCfg)();
    pages = new page_cache_1.PageCache(this.cfg.cacheMaxEntries, this.cfg.cacheTtlSeconds * 1000);
    metrics = new metrics_1.SiteMetrics();
    constructor(data, sitemap, cdn) {
        this.data = data;
        this.sitemap = sitemap;
        this.cdn = cdn;
    }
    async onListingChanged(ids) {
        const known = ids.filter((x) => !!x);
        this.data.invalidate();
        this.sitemap.invalidate();
        const keys = known.length ? this.pages.purgeTags(['list', ...known.flatMap((i) => [`provider:${i}`, `clinic:${i}`])]) : (() => { const n = this.pages.clear(); return n ? ['*'] : []; })();
        this.metrics.inc('purges');
        await this.cdn.purge([...new Set([...keys.map((k) => k.split('?')[0]), '/sitemap.xml', '/sitemaps/*'])]);
        return { purged: keys.length };
    }
    purgeAll() { this.data.invalidate(); this.sitemap.invalidate(); this.pages.clear(); }
};
exports.PublicSiteCache = PublicSiteCache;
exports.PublicSiteCache = PublicSiteCache = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [site_data_service_1.SiteDataService, sitemap_service_1.SitemapService, CdnPurger])
], PublicSiteCache);
//# sourceMappingURL=cache-tags.js.map