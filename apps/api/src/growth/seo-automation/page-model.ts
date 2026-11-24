import type { TemplateKey } from '../seo/seo-public';
import type { CheckId, SeoAutomationConfig } from './seo-automation-config';

export type PageLocale = 'ar' | 'en';

/**
 * One public page in one locale as the checks see it. A page KEY is locale-neutral: `<type>:<rest>` where rest is the path after /{locale}/{cc} (slugs are Latin), for example
 * `doctor:sara-hassan`, `district:cardiology/cairo/maadi`, `home:`.
 */
export interface PageContent {
  pageKey: string;
  templateKind: TemplateKey;
  locale: PageLocale;
  /** expected canonical URL (absolute) built from the url policy */
  expectedCanonical: string;
  title: string;
  description: string;
  h1: string[];
  /** visible text of the body (scripts and styles removed) */
  text: string;
  jsonLd: unknown[];
  canonical: string;
  alternates: { hreflang: string; href: string }[];
  robots: string;
  /** internal links found in the page body */
  links: string[];
  /** provider ids on a listing page, and of its parent page: input of the overlap checks */
  providerIds?: string[];
  liveProviders?: number;
  availableProviders?: number;
  /** review markup state: rendered in JSON-LD, visible reviews on the page */
  reviewMarkupRendered: boolean;
  visibleReviews: number;
}

export interface CheckResult { id: CheckId; ok: boolean; severity: 'block' | 'warn'; detail?: string }

/** Everything a check may look at besides the page itself. All of it is derived from the same crawl, so a check never reaches the network or the database. */
export interface CheckContext {
  cfg: SeoAutomationConfig;
  host: string;
  /** boolean config of the SEO kind */
  reviewMarkupEnabled: boolean;
  reviewMarkupMinCount: number;
  minAvailableProviders: number;
  /** every page of the crawl by `${pageKey}|${locale}` */
  pages: ReadonlyMap<string, PageContent>;
  /** unique shingles of a page (boilerplate removed), memoised per crawl */
  uniqueShingles(p: PageContent): ReadonlySet<string>;
  uniqueWordCount(p: PageContent): number;
  /** duplicated titles and descriptions of this locale: value to the keys that carry it */
  titleOwners: ReadonlyMap<string, string[]>;
  descriptionOwners: ReadonlyMap<string, string[]>;
  /** page keys that have NO inbound internal link from another indexable page */
  orphans: ReadonlySet<string>;
}

export const pageId = (pageKey: string, locale: PageLocale): string => `${pageKey}|${locale}`;
export const splitKey = (pageKey: string): { type: string; rest: string } => { const i = pageKey.indexOf(':'); return { type: pageKey.slice(0, i), rest: pageKey.slice(i + 1) }; };
export const keyOf = (type: string, rest: string): string => `${type}:${rest}`;

/** Parent hub of a generated page, or null (home, doctors and clinics have the link graph as parents, not a content parent). */
export function parentKey(pageKey: string): string | null {
  const { type, rest } = splitKey(pageKey); const parts = rest.split('/');
  switch (type) {
    case 'district': return keyOf('city', parts.slice(0, 2).join('/'));
    case 'city': return keyOf('hub', parts[0]!);
    case 'district-hub': return keyOf('city-hub', parts[0]!);
    case 'same-day': case 'telemedicine': return keyOf('hub', parts[0]!);
    default: return null;
  }
}
/** Siblings: same type and same parent. */
export function siblingKeys(pageKey: string, all: Iterable<string>): string[] {
  const { type } = splitKey(pageKey); const parent = parentKey(pageKey);
  return [...all].filter((k) => k !== pageKey && splitKey(k).type === type && parentKey(k) === parent);
}
