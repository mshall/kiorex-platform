"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PublicSiteModule = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const cache_tags_1 = require("./cache-tags");
const seo_public_1 = require("../growth/seo/seo-public");
const redirects_service_1 = require("./redirects.service");
const page_snapshot_service_1 = require("./page-snapshot.service");
const seo_site_adapter_1 = require("./seo-site.adapter");
const seo_automation_public_1 = require("../growth/seo-automation/seo-automation-public");
const render_controller_1 = require("./render.controller");
const robots_controller_1 = require("./robots.controller");
const search_engines_1 = require("./search-engines");
const seo_ops_controller_1 = require("./seo-ops.controller");
const seo_pages_service_1 = require("./seo-pages.service");
const seo_config_service_1 = require("./seo-config.service");
const site_data_service_1 = require("./site-data.service");
const site_index_service_1 = require("./site-index.service");
const site_mounter_1 = require("./site-mounter");
const sitemap_controller_1 = require("./sitemap.controller");
const sitemap_service_1 = require("./sitemap.service");
const ssr_renderer_1 = require("./ssr-renderer");
let PublicSiteModule = class PublicSiteModule {
};
exports.PublicSiteModule = PublicSiteModule;
exports.PublicSiteModule = PublicSiteModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        controllers: [seo_ops_controller_1.SeoOpsController],
        providers: [
            seo_config_service_1.SeoConfigService, redirects_service_1.PrismaSlugStore, redirects_service_1.RedirectsService, site_index_service_1.SiteIndexService, site_data_service_1.SiteDataService, sitemap_service_1.SitemapService, page_snapshot_service_1.PageSnapshotService, seo_site_adapter_1.SeoSiteAdapter, { provide: seo_automation_public_1.SEO_SITE, useExisting: seo_site_adapter_1.SeoSiteAdapter }, cache_tags_1.CdnPurger, cache_tags_1.PublicSiteCache,
            { provide: ssr_renderer_1.SiteRenderer, useClass: ssr_renderer_1.BundleRenderer },
            seo_public_1.SlugService, seo_public_1.SlugBootstrapService, seo_public_1.SlugBootstrapJob, seo_pages_service_1.SeoPagesService, search_engines_1.SearchEngineService, search_engines_1.SitemapSubmitJob,
            render_controller_1.RenderController, robots_controller_1.RobotsController, sitemap_controller_1.SitemapController, site_mounter_1.SiteMounter,
            { provide: core_1.APP_GUARD, useClass: site_mounter_1.SiteRoleGuard },
        ],
        exports: [cache_tags_1.PublicSiteCache, seo_automation_public_1.SEO_SITE],
    })
], PublicSiteModule);
//# sourceMappingURL=public-site.module.js.map