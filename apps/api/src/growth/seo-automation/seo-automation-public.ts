import type { PageLocale } from './page-model';

/** Façade of the SEO automation package for the public site (token and types only: the public site never imports the services). */
export const SEO_QUALITY = Symbol('SEO_QUALITY');
export const SEO_AUTOMATION_FLAG = 'growth.seo_automation';

export interface ComputedLink { label: { en: string; ar: string }; path: string; count: number }
export interface ComputedLinkGroup { kind: string; links: ComputedLink[] }

/**
 * What the request handler and the sitemap ask of the quality gate. Every answer is read from stored reports and the stored link graph (cached for a short time): never a crawl in a request.
 * With `autoNoindex` off (the default), `blocked` is always false and `omittedAlternates` is empty: the gate only reports.
 */
export interface SeoQualityPort {
  blocked(market: string, pageKey: string, locale: PageLocale): Promise<boolean>;
  omittedAlternates(market: string, pageKey: string, locale: PageLocale): Promise<PageLocale[]>;
  /** page keys the gate set noindex in this locale (the sitemap leaves them out) */
  blockedSet(market: string, locale: PageLocale): Promise<ReadonlySet<string>>;
  computedLinks(market: string, pageKey: string, locale: PageLocale): Promise<ComputedLinkGroup[]>;
}
export { pageKeyOf, restOfKey } from './page-key';
export type { PageLocale } from './page-model';

/**
 * What the SEO automation needs from the public site, as a port: the public site provides it (`SEO_SITE`), so this package imports nothing from it (no module cycle, and the automation cannot
 * reach a controller, a cache or a header). Everything crossing the port is public marketplace data: no patient field, no contact detail.
 */
export const SEO_SITE = Symbol('SEO_SITE');
export interface SeoProviderLite { id: string; careType: string; clinicId: string; specialty: string | null; governorate: string | null; area: string | null; ratingAvg: number; ratingCount: number; nextSlotAt: Date | null; nameEn: string | null; nameAr: string | null; clinicNameEn: string | null; clinicNameAr: string | null; /** URL slugs exactly as the public site builds them */ citySlug: string | null; areaSlug: string | null; specialtySlug: string | null }
export interface SeoCapture {
  status: number; type: string; params: Record<string, string>;
  title: string; description: string; h1: string[]; bodyHtml: string; jsonLd: unknown[]; canonical: string; alternates: { hreflang: string; href: string }[]; robots: string; links: string[]; reviews: number;
}
export interface SeoSnapshot {
  seo: { reviewMarkupEnabled: boolean; reviewMarkupMinCount: number; minAvailableProviders: number };
  facets: { type: string; params: Record<string, string>; providers: SeoProviderLite[]; city: { en: string; ar: string } | null; district: { en: string; ar: string } | null; specialtyCode: string | null }[];
  /** LIVE and listed providers */
  providers: SeoProviderLite[];
}
export interface SeoSitePort {
  available(): boolean;
  host(): string;
  /** the indexable pages the sitemaps list (type and the path after /{locale}/{cc}) */
  entries(market: string): Promise<{ type: string; rest: string }[]>;
  capture(market: string, locale: PageLocale, rest: string): Promise<SeoCapture | null>;
  snapshot(market: string): Promise<SeoSnapshot>;
  slugs(market: string, entity: 'DOCTOR' | 'CLINIC', ids: string[]): Promise<Map<string, string>>;
  /** route type and params of a public path (any locale), or null */
  route(path: string): { type: string; params: Record<string, string> } | null;
  /** drop the site's cached snapshots, sitemaps and pages after a run */
  refresh(): void;
}

/** Event trigger of the quality gate (profile update, listing publish or pause, slug change). Coalesced, non-throwing, a no-op while `growth.seo_automation` is OFF. */
export const SEO_TRIGGER = Symbol('SEO_TRIGGER');
export interface SeoTriggerPort { request(reason: string, market?: string): void }

/** G-18: the editorial title and description a page currently carries (ACTIVE edit) or null. Read by the public renderer; the editor lives in `LandingEditService`. */
export const SEO_EDITS = Symbol('SEO_EDITS');
export interface LandingEditView { title: string; description: string; version: number }
export interface LandingEditPort { activeFor(market: string, pageKey: string, locale: string): Promise<LandingEditView | null> }
