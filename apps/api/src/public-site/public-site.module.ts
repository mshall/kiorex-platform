import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CdnPurger, PublicSiteCache } from './cache-tags';
import { SlugBootstrapJob, SlugBootstrapService, SlugService } from '../growth/seo/seo-public';
import { PrismaSlugStore, RedirectsService } from './redirects.service';
import { PageSnapshotService } from './page-snapshot.service';
import { SeoSiteAdapter } from './seo-site.adapter';
import { SEO_SITE } from '../growth/seo-automation/seo-automation-public';
import { RenderController } from './render.controller';
import { RobotsController } from './robots.controller';
import { SearchEngineService, SitemapSubmitJob } from './search-engines';
import { SeoOpsController } from './seo-ops.controller';
import { SeoPagesService } from './seo-pages.service';
import { SeoConfigService } from './seo-config.service';
import { SiteDataService } from './site-data.service';
import { SiteIndexService } from './site-index.service';
import { SiteMounter, SiteRoleGuard } from './site-mounter';
import { SitemapController } from './sitemap.controller';
import { SitemapService } from './sitemap.service';
import { BundleRenderer, SiteRenderer } from './ssr-renderer';

/**
 * Public SEO site role (GRW-P1-E, ADR-043): hybrid SSR for public routes only, a role of the existing Kiorex API image (SITE_ROLE=all|api|site).
 * Depends on the global Catalog, Trust, ControlPlane, Market and Prisma modules through their public barrels. Exports only the cache owner, which
 * the Kiorly webhook consumer calls to purge pages and sitemaps.
 */
@Global() // the SEO automation reaches the site through the SEO_SITE token only (GRW-P3-F), so it needs no import of this module
@Module({
  controllers: [SeoOpsController],
  providers: [
    SeoConfigService, PrismaSlugStore, RedirectsService, SiteIndexService, SiteDataService, SitemapService, PageSnapshotService, SeoSiteAdapter, { provide: SEO_SITE, useExisting: SeoSiteAdapter }, CdnPurger, PublicSiteCache,
    { provide: SiteRenderer, useClass: BundleRenderer },
    SlugService, SlugBootstrapService, SlugBootstrapJob, SeoPagesService, SearchEngineService, SitemapSubmitJob,
    RenderController, RobotsController, SitemapController, SiteMounter,
    { provide: APP_GUARD, useClass: SiteRoleGuard },
  ],
  exports: [PublicSiteCache, SEO_SITE],
})
export class PublicSiteModule {}
