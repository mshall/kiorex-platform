/**
 * Pure URL policy of the public site (GRW-P1-E, ARCH section 4.1): route table, canonical URLs, hreflang alternates, query rules,
 * locale negotiation. No framework imports, so it is unit-testable and shared by render, sitemap, redirects and robots.
 * Canonical convention: https://<host>/{ar|en}/{cc}/{type}/{slug}, lowercase, no trailing slash, no tracking query.
 */
export const LOCALES = ['ar', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'ar';
export const isLocale = (v: string): v is Locale => (LOCALES as readonly string[]).includes(v);

export const PAGE_TYPES = ['home', 'hub', 'city', 'district', 'care-district', 'city-hub', 'district-hub', 'same-day', 'telemedicine', 'doctor', 'clinic', 'nurse', 'pharmacy', 'lab', 'static'] as const;
export type PageType = (typeof PAGE_TYPES)[number];

export interface RouteDef {
  type: PageType;
  /** Path relative to /{locale}/{cc}, with :params. */
  pattern: string;
  /** Slug-table entity type resolving the last segment (null = no slug lookup). */
  slugEntity: 'DOCTOR' | 'CLINIC' | 'PHARMACY' | 'LAB' | null;
  /** Listed in sitemaps when the entity passes its guard. */
  inSitemap: boolean;
  /** false = the route exists in the table but is not served yet (404). Pharmacy and lab pages are served from GRW-P1-F (per-entity gate: LIVE partner and the feature flag). */
  enabled: boolean;
}

const SLUG = '[a-z0-9-]{2,60}';
export const ROUTES: readonly RouteDef[] = [
  { type: 'home', pattern: '', slugEntity: null, inSitemap: true, enabled: true },
  { type: 'hub', pattern: 'doctors/:specialty', slugEntity: null, inSitemap: true, enabled: true },
  { type: 'city', pattern: 'doctors/:specialty/:city', slugEntity: null, inSitemap: true, enabled: true },
  { type: 'district', pattern: 'doctors/:specialty/:city/:district', slugEntity: null, inSitemap: true, enabled: true },
  { type: 'care-district', pattern: ':care/:city/:district', slugEntity: null, inSitemap: true, enabled: true },
  // GRW-P1-F: location hubs (all care types in a city / district) and availability hubs per specialty
  { type: 'city-hub', pattern: 'locations/:city', slugEntity: null, inSitemap: true, enabled: true },
  { type: 'district-hub', pattern: 'locations/:city/:district', slugEntity: null, inSitemap: true, enabled: true },
  { type: 'same-day', pattern: 'same-day/:specialty', slugEntity: null, inSitemap: true, enabled: true },
  { type: 'telemedicine', pattern: 'telemedicine/:specialty', slugEntity: null, inSitemap: true, enabled: true },
  { type: 'doctor', pattern: 'doctor/:slug', slugEntity: 'DOCTOR', inSitemap: true, enabled: true },
  { type: 'clinic', pattern: 'clinic/:slug', slugEntity: 'CLINIC', inSitemap: true, enabled: true },
  { type: 'nurse', pattern: 'nurse/:slug', slugEntity: 'DOCTOR', inSitemap: true, enabled: true },
  { type: 'pharmacy', pattern: 'pharmacy/:slug', slugEntity: 'PHARMACY', inSitemap: true, enabled: true },
  { type: 'lab', pattern: 'lab/:slug', slugEntity: 'LAB', inSitemap: true, enabled: true },
  { type: 'static', pattern: ':page', slugEntity: null, inSitemap: false, enabled: false },
];

/** Care types served under their own path segment (ARCH 4.1). */
export const CARE_SEGMENTS = { 'home-nursing': 'HOME_NURSING', physiotherapy: 'PHYSIOTHERAPY' } as const;
export type CareSegment = keyof typeof CARE_SEGMENTS;

export interface ParsedPath {
  locale: Locale;
  cc: string;
  type: PageType;
  params: Record<string, string>;
  /** Path after /{locale}/{cc}, without leading slash ('' for the home page). */
  rest: string;
}

/**
 * Pages that live inside the public namespace but are client-rendered by the SPA (answered with the SPA shell, `noindex`): the consent preference
 * centre `/{locale}/{cc}/preferences` (GRW-P1-I). A new SPA page under the namespace must be listed here on purpose (App.tsx snapshot test).
 */
export const SPA_PASSTHROUGH_PAGES = ['preferences', 'invite/:code'] as const;
/** A pass-through entry may carry `:param` segments (one short token each); the shell is noindex, so a malformed token just shows the app's neutral invalid state. GRW-P2-B3: `/{locale}/{cc}/invite/<code>`. */
const PASSTHROUGH_RES = SPA_PASSTHROUGH_PAGES.map((p) => ({ page: p as string, re: new RegExp(`^${p.split('/').map((seg) => (seg.startsWith(':') ? '[a-z0-9_:-]{1,64}' : seg)).join('\\/')}$`) }));

export type ParseResult =
  | { kind: 'match'; value: ParsedPath }
  | { kind: 'spa'; page: string }
  | { kind: 'redirect'; to: string; reason: 'case' | 'trailing-slash' | 'duplicate-slash' }
  | { kind: 'none' };

const PREFIX = /^\/(ar|en)\/([a-z]{2})(\/.*)?$/i;

const matchers: { def: RouteDef; re: RegExp; names: string[] }[] = ROUTES.filter((r) => r.type !== 'static').map((def) => {
  const names: string[] = [];
  const src = def.pattern.split('/').map((seg) => {
    if (!seg.startsWith(':')) return seg;
    const n = seg.slice(1);
    names.push(n);
    return n === 'care' ? '(home-nursing|physiotherapy)' : `(${SLUG})`;
  }).join('\\/');
  return { def, re: new RegExp(`^${src}$`), names };
});

/** Match a request pathname against the public route table. Normalisation (case, trailing and duplicate slashes) yields a redirect, never a second URL. */
export function parsePublicPath(pathname: string): ParseResult {
  if (!PREFIX.test(pathname)) return { kind: 'none' };
  let p = pathname;
  let reason: 'case' | 'trailing-slash' | 'duplicate-slash' | null = null;
  if (/\/\/+/.test(p)) { p = p.replace(/\/{2,}/g, '/'); reason = 'duplicate-slash'; }
  if (p.length > 1 && p.endsWith('/')) { p = p.replace(/\/+$/, ''); reason ??= 'trailing-slash'; }
  if (p !== p.toLowerCase()) { p = p.toLowerCase(); reason ??= 'case'; }
  if (reason) return { kind: 'redirect', to: p, reason };
  const m = PREFIX.exec(p)!;
  const locale = m[1] as Locale;
  const cc = m[2]!;
  const rest = (m[3] ?? '').replace(/^\//, '');
  const spa = PASSTHROUGH_RES.find((x) => x.re.test(rest));
  if (spa) return { kind: 'spa', page: spa.page };
  for (const { def, re, names } of matchers) {
    const r = re.exec(rest);
    if (!r) continue;
    const params: Record<string, string> = {};
    names.forEach((n, i) => { params[n] = r[i + 1]!; });
    return { kind: 'match', value: { locale, cc, type: def.type, params, rest } };
  }
  return { kind: 'none' };
}

/** Is this pathname inside the public namespace at all (even when no route matches: those answer 404 with noindex)? */
export const isPublicNamespace = (pathname: string): boolean => PREFIX.test(pathname);

export function buildPath(locale: Locale, cc: string, type: PageType, params: Record<string, string> = {}): string {
  const def = ROUTES.find((r) => r.type === type);
  if (!def) throw new Error(`unknown page type ${type}`);
  const rest = def.pattern.split('/').filter(Boolean).map((seg) => (seg.startsWith(':') ? (params[seg.slice(1)] ?? '') : seg)).join('/');
  return `/${locale}/${cc.toLowerCase()}${rest ? `/${rest}` : ''}`;
}

// ── query rules ────────────────────────────────────────────────────────────────────────────────────────────────

export const CONTENT_QUERY_KEYS = ['page', 'sort'] as const;
export const SORT_VALUES = ['rating', 'fee', 'earliest'] as const;
export const TRACKING_QUERY_KEYS = ['gclid', 'fbclid', 'msclkid', 'ttclid', 's', 'ref', 'lt', 'src'] as const;
export const isTrackingKey = (k: string): boolean => k.startsWith('utm_') || (TRACKING_QUERY_KEYS as readonly string[]).includes(k.toLowerCase());

export interface PageQuery { page: number; sort: (typeof SORT_VALUES)[number] | null }

/** Only `page` and `sort` can change content; everything else (utm_*, gclid, fbclid, s, ref) is ignored here and consumed by the touch endpoint. */
export function readPageQuery(query: Record<string, unknown>): PageQuery {
  const one = (v: unknown) => (Array.isArray(v) ? v[0] : v);
  const pageRaw = Number(one(query.page));
  const page = Number.isInteger(pageRaw) && pageRaw >= 1 && pageRaw <= 500 ? pageRaw : 1;
  const sortRaw = String(one(query.sort) ?? '');
  const sort = (SORT_VALUES as readonly string[]).includes(sortRaw) ? (sortRaw as PageQuery['sort']) : null;
  return { page, sort };
}

/** CDN and in-process cache key: path plus the whitelisted content query, canonicalised (page=1 and unknown keys vanish). */
export function cacheKey(pathname: string, q: PageQuery): string {
  const parts: string[] = [];
  if (q.page > 1) parts.push(`page=${q.page}`);
  if (q.sort) parts.push(`sort=${q.sort}`);
  return parts.length ? `${pathname}?${parts.join('&')}` : pathname;
}

// ── canonical and hreflang ─────────────────────────────────────────────────────────────────────────────────────

const host = (h: string) => h.replace(/\/+$/, '');

/** Absolute canonical URL. The canonical keeps `page` > 1 (self-referencing pagination) and drops `sort` and every other key. */
export function canonicalUrl(canonicalHost: string, path: string, q?: PageQuery): string {
  return `${host(canonicalHost)}${path}${q && q.page > 1 ? `?page=${q.page}` : ''}`;
}

export interface Alternate { hreflang: string; href: string }

/**
 * hreflang set: ar, en (self-referencing, reciprocal, fully qualified) plus x-default. x-default is the default-locale version while one market is
 * live (root / redirects there); `rootSelector` points it at the host root once more than one market is live (ARCH rule 5).
 */
export function hreflangAlternates(canonicalHost: string, cc: string, rest: string, opts: { rootSelector?: boolean } = {}): Alternate[] {
  const tail = rest ? `/${rest}` : '';
  const alts: Alternate[] = LOCALES.map((l) => ({ hreflang: l, href: `${host(canonicalHost)}/${l}/${cc.toLowerCase()}${tail}` }));
  alts.push({ hreflang: 'x-default', href: opts.rootSelector ? `${host(canonicalHost)}/` : `${host(canonicalHost)}/${DEFAULT_LOCALE}/${cc.toLowerCase()}${tail}` });
  return alts;
}

/** Swap the locale segment (language switcher and tests). */
export const switchLocale = (path: string, to: Locale): string => path.replace(/^\/(ar|en)\//, `/${to}/`);

// ── locale negotiation (redirects only, never rendering: locale is in the path) ─────────────────────────────────

export function negotiateLocale(opts: { cookie?: string | null; acceptLanguage?: string | null }): Locale {
  const c = /(?:^|;\s*)kx-lang=(ar|en)\b/.exec(opts.cookie ?? '');
  if (c) return c[1] as Locale;
  const ranked = (opts.acceptLanguage ?? '').split(',').map((part, i) => {
    const [tag = '', ...params] = part.trim().split(';');
    const q = params.map((x) => /^\s*q=([\d.]+)/.exec(x)?.[1]).find(Boolean);
    return { lang: tag.trim().toLowerCase().split('-')[0] ?? '', q: q === undefined ? 1 : Number(q), i };
  }).filter((x) => isLocale(x.lang) && Number.isFinite(x.q) && x.q > 0).sort((a, b) => b.q - a.q || a.i - b.i);
  return (ranked[0]?.lang as Locale | undefined) ?? DEFAULT_LOCALE;
}

// ── private paths: never indexed, never rendered by the site ───────────────────────────────────────────────────

/** Every authenticated or transactional SPA route prefix. robots.txt disallows these; the SPA also sends noindex. Kept in step with apps/web App.tsx by a test. */
export const PRIVATE_PATH_PREFIXES = [
  '/api/', '/auth/', '/account', '/appointments', '/checkout/', '/care-plans', '/lab/', '/notifications', '/pharmacy', '/records', '/search',
  '/telemedicine', '/visit-status/', '/waitlist', '/services', '/rx/', '/dev/', '/referral', '/corporate', '/invite/',
] as const;

export const isPrivatePath = (pathname: string): boolean => PRIVATE_PATH_PREFIXES.some((p) => pathname === p.replace(/\/$/, '') || pathname.startsWith(p));
