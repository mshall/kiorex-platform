import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CdnPurger, PublicSiteCache } from './cache-tags';
import { SlugBootstrapJob, SlugBootstrapService, SlugService } from '../growth/seo/seo-public';
import { PrismaSlugStore, RedirectsService } from './redirects.service';
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
@Module({
  controllers: [SeoOpsController],
  providers: [
    SeoConfigService, PrismaSlugStore, RedirectsService, SiteIndexService, SiteDataService, SitemapService, CdnPurger, PublicSiteCache,
    { provide: SiteRenderer, useClass: BundleRenderer },
    SlugService, SlugBootstrapService, SlugBootstrapJob, SeoPagesService, SearchEngineService, SitemapSubmitJob,
    RenderController, RobotsController, SitemapController, SiteMounter,
    { provide: APP_GUARD, useClass: SiteRoleGuard },
  ],
  exports: [PublicSiteCache],
})
export class PublicSiteModule {}
