import { Injectable } from '@nestjs/common';
import type { SeoCapture, SeoProviderLite, SeoSnapshot, SeoSitePort } from '../growth/seo-automation/seo-automation-public';
import { PublicSiteCache } from './cache-tags';
import { slugifyPlace, specialtySegment } from './geo';
import { PageSnapshotService } from './page-snapshot.service';
import { RedirectsService } from './redirects.service';
import { parseHead } from './seo-audit';
import { SiteDataService } from './site-data.service';
import type { IndexedProvider } from './site-index.service';
import { SitemapService } from './sitemap.service';
import { siteCfg } from './site.config';
import { parsePublicPath, type Locale } from './url-policy';

const lite = (p: IndexedProvider): SeoProviderLite => ({ id: p.id, careType: p.careType, clinicId: p.clinicId, specialty: p.specialty, governorate: p.governorate, area: p.area, ratingAvg: p.ratingAvg, ratingCount: p.ratingCount, nextSlotAt: p.nextSlotAt, nameEn: p.nameEn, nameAr: p.nameAr, clinicNameEn: p.clinicNameEn, clinicNameAr: p.clinicNameAr, citySlug: slugifyPlace(p.governorate), areaSlug: slugifyPlace(p.area), specialtySlug: p.specialty ? specialtySegment(p.specialty) : null });

/**
 * The public site's side of the SEO automation port (GRW-P3-F). Read-only: it renders pages for analysis (no cache write, no headers), reads the sitemap entries and the facet table, and on `refresh`
 * drops the site's own caches so a new quality decision or link graph reaches the next request. It exposes public marketplace data only.
 */
@Injectable()
export class SeoSiteAdapter implements SeoSitePort {
  constructor(private readonly pages: PageSnapshotService, private readonly sitemap: SitemapService, private readonly data: SiteDataService, private readonly redirects: RedirectsService, private readonly cache: PublicSiteCache) {}

  available(): boolean { return this.pages.available(); }
  host(): string { return siteCfg().canonicalHost; }
  async entries(market: string) { return (await this.sitemap.entries(market)).entries.map((e) => ({ type: e.type, rest: e.rest })); }

  async capture(market: string, locale: Locale, rest: string): Promise<SeoCapture | null> {
    const c = await this.pages.capture(market, locale, rest); if (!c) return null;
    if (c.status !== 200) return { status: c.status, type: c.type, params: c.params, title: '', description: '', h1: [], bodyHtml: '', jsonLd: [], canonical: '', alternates: [], robots: '', links: [], reviews: 0 };
    const h = parseHead(c.document); const host = siteCfg().canonicalHost; const d = c.data as { reviews?: unknown[] } | null;
    return { status: 200, type: c.type, params: c.params, title: h.title, description: h.description, h1: h.h1, bodyHtml: c.bodyHtml, jsonLd: h.jsonLd.map((j) => j.value), canonical: h.canonical, alternates: h.alternates, robots: h.robots, links: h.links.filter((l) => l.startsWith('/') || l.startsWith(host)), reviews: Array.isArray(d?.reviews) ? d!.reviews!.length : 0 };
  }

  async snapshot(market: string): Promise<SeoSnapshot> {
    const s = await this.data.snapshot(market);
    return {
      seo: { reviewMarkupEnabled: s.seo.reviewMarkupEnabled, reviewMarkupMinCount: s.seo.reviewMarkupMinCount, minAvailableProviders: s.seo.minAvailableProviders },
      facets: s.facets.all.map((f) => ({ type: f.type, params: f.params, providers: f.providers.map(lite), city: f.city, district: f.district, specialtyCode: f.specialtyCode })),
      providers: s.index.providers.filter((p) => p.status === 'LIVE' && p.listed).map(lite),
    };
  }

  slugs(market: string, entity: 'DOCTOR' | 'CLINIC', ids: string[]) { return this.redirects.slugsFor(market, entity, ids); }
  route(path: string) { const r = parsePublicPath(path); return r.kind === 'match' ? { type: r.value.type, params: r.value.params } : null; }
  refresh(): void { this.data.invalidate(); this.sitemap.invalidate(); this.cache.purgeAll(); }
}
