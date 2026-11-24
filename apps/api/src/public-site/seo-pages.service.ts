import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PublicSiteCache } from './cache-tags';
import type { Facet } from './facets';
import { RedirectsService } from './redirects.service';
import { SiteDataService } from './site-data.service';
import { buildPath } from './url-policy';

export interface PageRow {
  type: string; key: string; path: { ar: string; en: string }; indexable: boolean; reasons: string[];
  providers: number; uniqueBlocks: number; siblingOverlapPercent: number | null; parentOverlapPercent: number | null; lastModified: string | null;
}
export interface PageFilter { type?: string; indexable?: boolean; limit?: number; offset?: number }

const LANDING_TYPE: Record<string, string> = { hub: 'HUB', city: 'SPECIALTY_CITY', district: 'SPECIALTY_DISTRICT', 'care-district': 'CARE_TYPE_DISTRICT', 'city-hub': 'CITY_HUB', 'district-hub': 'DISTRICT_HUB', 'same-day': 'SAME_DAY', telemedicine: 'TELEMEDICINE' };

/**
 * SEO page inventory and rebuild (GRW-P1-F). The inventory is the facet table the renderer and the sitemap already share, exposed read-only for ops;
 * `rebuild` drops every cached snapshot and page, recomputes the guard for all generated pages and records the result per page and locale in
 * GrowthLandingPage (so a dashboard and the audit can see what is indexable and why not). It changes no content: pages are always rendered from live data.
 */
@Injectable()
export class SeoPagesService {
  constructor(private readonly data: SiteDataService, private readonly cache: PublicSiteCache, private readonly prisma: PrismaService, private readonly redirects: RedirectsService) {}

  private row(f: Facet, market: string): PageRow {
    return {
      type: f.type, key: f.key, path: { ar: buildPath('ar', market, f.type, f.params), en: buildPath('en', market, f.type, f.params) }, indexable: f.guard.indexable, reasons: f.guard.reasons,
      providers: f.providers.length, uniqueBlocks: f.uniqueBlocks, siblingOverlapPercent: f.overlapPercent, parentOverlapPercent: f.parentOverlapPercent, lastModified: f.lastModified?.toISOString() ?? null,
    };
  }

  async inventory(market: string, f: PageFilter = {}): Promise<{ total: number; indexable: number; noindex: number; byReason: Record<string, number>; items: PageRow[] }> {
    const snap = await this.data.snapshot(market);
    const rows = snap.facets.all.map((x) => this.row(x, market)).sort((a, b) => (a.type === b.type ? (a.key < b.key ? -1 : 1) : a.type < b.type ? -1 : 1));
    const byReason: Record<string, number> = {};
    for (const r of rows) for (const reason of r.reasons) byReason[reason] = (byReason[reason] ?? 0) + 1;
    const filtered = rows.filter((r) => (!f.type || r.type === f.type) && (f.indexable === undefined || r.indexable === f.indexable));
    const off = Math.max(0, f.offset ?? 0); const lim = Math.min(Math.max(1, f.limit ?? 100), 500);
    return { total: rows.length, indexable: rows.filter((r) => r.indexable).length, noindex: rows.filter((r) => !r.indexable).length, byReason, items: filtered.slice(off, off + lim) };
  }

  async rebuild(market: string): Promise<{ market: string; pages: number; indexable: number; noindex: number; landingRowsWritten: number; staleRowsDeactivated: number }> {
    this.cache.purgeAll();
    const snap = await this.data.snapshot(market);
    const seen = new Set<string>();
    let written = 0;
    for (const f of snap.facets.all) {
      for (const locale of ['ar', 'en']) {
        const pageType = LANDING_TYPE[f.type]!;
        seen.add(`${pageType}|${locale}|${f.key}`);
        await this.prisma.growthLandingPage.upsert({
          where: { market_pageType_locale_paramsKey: { market, pageType, locale, paramsKey: f.key } },
          create: { market, pageType, locale, paramsKey: f.key, params: f.params, indexable: f.guard.indexable, guardResult: { reasons: f.guard.reasons, providers: f.providers.length, uniqueBlocks: f.uniqueBlocks, siblingOverlapPercent: f.overlapPercent, parentOverlapPercent: f.parentOverlapPercent }, lastRenderedAt: new Date() },
          update: { params: f.params, indexable: f.guard.indexable, guardResult: { reasons: f.guard.reasons, providers: f.providers.length, uniqueBlocks: f.uniqueBlocks, siblingOverlapPercent: f.overlapPercent, parentOverlapPercent: f.parentOverlapPercent }, lastRenderedAt: new Date() },
        });
        written++;
      }
    }
    // pages that no longer exist (no provider supports them any more): never indexable again until they come back
    const old = await this.prisma.growthLandingPage.findMany({ where: { market, indexable: true }, select: { id: true, pageType: true, locale: true, paramsKey: true } });
    const stale = old.filter((o) => !seen.has(`${o.pageType}|${o.locale}|${o.paramsKey}`)).map((o) => o.id);
    if (stale.length) await this.prisma.growthLandingPage.updateMany({ where: { id: { in: stale } }, data: { indexable: false, guardResult: { reasons: ['NO_LONGER_GENERATED'] } } });
    const idx = snap.facets.all.filter((f) => f.guard.indexable).length;
    return { market, pages: snap.facets.all.length, indexable: idx, noindex: snap.facets.all.length - idx, landingRowsWritten: written, staleRowsDeactivated: stale.length };
  }

  /** Slug coverage: providers (and clinics) that can be public but have no slug yet; the bootstrap job closes this gap. */
  async slugCoverage(market: string): Promise<{ providersLive: number; providersWithSlug: number; clinicsLive: number; clinicsWithSlug: number; missingProviderIds: string[] }> {
    const rows = await this.prisma.provider.findMany({ where: { market, status: { in: ['LIVE', 'PAUSED'] } }, select: { id: true, clinicId: true } });
    const ps = await this.redirects.slugsFor(market, 'DOCTOR', rows.map((r) => r.id));
    const clinicIds = [...new Set(rows.map((r) => r.clinicId))];
    const cs = await this.redirects.slugsFor(market, 'CLINIC', clinicIds);
    return { providersLive: rows.length, providersWithSlug: ps.size, clinicsLive: clinicIds.length, clinicsWithSlug: cs.size, missingProviderIds: rows.filter((r) => !ps.has(r.id)).map((r) => r.id).slice(0, 100) };
  }
}
