import { Injectable, Logger } from '@nestjs/common';
import { PageCache } from './page-cache';
import { SiteMetrics } from './metrics';
import { SitemapService } from './sitemap.service';
import { SiteDataService } from './site-data.service';
import { siteCfg } from './site.config';

/** CDN invalidation port. `mock` records what a real purge would send; `real` is a go-live task (NEEDS_HUMAN, Docs/NEEDS_HUMAN.md) and is never faked. */
@Injectable()
export class CdnPurger {
  private readonly log = new Logger('CdnPurger');
  readonly recent: { at: string; paths: string[] }[] = [];
  async purge(paths: string[]): Promise<void> {
    if (!paths.length) return;
    if (siteCfg().cdnPurgeMode === 'real') { this.log.warn(`SITE_CDN_PURGE_MODE=real is not implemented yet (NEEDS_HUMAN: distribution id and IAM role); ${paths.length} path(s) NOT purged`); return; }
    this.recent.push({ at: new Date().toISOString(), paths });
    if (this.recent.length > 50) this.recent.shift();
    this.log.debug(`mock CDN purge: ${paths.length} path(s)`);
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
