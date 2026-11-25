import { Injectable, Logger } from '@nestjs/common';
import { PageCache } from './page-cache';
import { SiteMetrics } from './metrics';
import { SitemapService } from './sitemap.service';
import { SiteDataService } from './site-data.service';
import { siteCfg } from './site.config';
import { createCdnPurgePort, MockCdnPurgeAdapter, type CdnPurgePort } from '../platform/platform-public';

/** CDN invalidation. Delegates to the `CdnPurgePort` (src/platform/adapters/cdn): `mock` records, `real` is the CloudFront skeleton (G-22), configured only by env and never faked. */
@Injectable()
export class CdnPurger {
  private readonly log = new Logger('CdnPurger');
  private readonly port: CdnPurgePort = createCdnPurgePort(siteCfg().cdnPurgeMode, { distributionId: process.env.SITE_CDN_DISTRIBUTION_ID ?? null, region: process.env.SITE_CDN_REGION });
  get recent(): { at: string; paths: string[] }[] { return this.port instanceof MockCdnPurgeAdapter ? this.port.recent : []; }
  async purge(paths: string[]): Promise<void> {
    if (!paths.length) return;
    const r = await this.port.purge(paths);
    if (r.status === 'NOT_CONFIGURED' || r.status === 'FAILED') this.log.warn(`CDN purge ${r.status}: ${r.paths} path(s) NOT purged (${r.reason ?? 'see NEEDS_HUMAN: CDN purge'})`);
    else this.log.debug(`CDN purge ${r.status}: ${r.paths} path(s)`);
  }
}

/**
 * Owner of the page cache and of every purge. The Kiorly webhook consumer (PROVIDER_PROFILE_UPDATED, LISTING_STATUS_CHANGED) calls
 * `onListingChanged` after it re-synced the catalogue: the entity pages, every list page, the home page and the sitemaps are dropped, and the
 * CDN is asked to invalidate the same paths, so a status change shows up well inside the 15 minute freshness target.
 */
@Injectable()
export class PublicSiteCache {
  private cfg = siteCfg();
  readonly pages = new PageCache(this.cfg.cacheMaxEntries, this.cfg.cacheTtlSeconds * 1000);
  readonly metrics = new SiteMetrics();
  constructor(private readonly data: SiteDataService, private readonly sitemap: SitemapService, private readonly cdn: CdnPurger) {}

  async onListingChanged(ids: readonly (string | null | undefined)[]): Promise<{ purged: number }> {
    const known = ids.filter((x): x is string => !!x);
    this.data.invalidate();
    this.sitemap.invalidate();
    const keys = known.length ? this.pages.purgeTags(['list', ...known.flatMap((i) => [`provider:${i}`, `clinic:${i}`])]) : (() => { const n = this.pages.clear(); return n ? ['*'] : []; })();
    this.metrics.inc('purges');
    await this.cdn.purge([...new Set([...keys.map((k) => k.split('?')[0]!), '/sitemap.xml', '/sitemaps/*'])]);
    return { purged: keys.length };
  }

  purgeAll(): void { this.data.invalidate(); this.sitemap.invalidate(); this.pages.clear(); }
}
