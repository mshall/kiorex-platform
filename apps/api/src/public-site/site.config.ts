import { resolve } from 'node:path';

/**
 * Public site (GRW-P1-E) runtime configuration. Read lazily so tests can override process.env. No secret lives here.
 *
 * ROLE (ADR-043 D6): the SSR site is a role of the existing Kiorex API image.
 *   all  = API and public site in one process (default; local and the first deployment)
 *   api  = API only (the site routes are NOT mounted)
 *   site = public site only (the /api/v1 surface answers 404 except health), so the same image can run as a second service later
 * SITE_ENVIRONMENT decides indexing: only `production` ever allows crawling; anything else (staging, development, unset) is blocked.
 */
const env = (k: string, d = ''): string => process.env[k] ?? d;
const num = (k: string, d: number): number => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && process.env[k] !== undefined && process.env[k] !== '' ? v : d;
};
const bool = (k: string, d: boolean): boolean => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k] === 'true');

export type SiteRole = 'all' | 'api' | 'site';
export type SiteEnvironment = 'production' | 'staging' | 'development';

const webRoot = (): string => resolve(__dirname, '..', '..', '..', 'web');

export const siteCfg = () => {
  const role = (['all', 'api', 'site'].includes(env('SITE_ROLE')) ? env('SITE_ROLE') : 'all') as SiteRole;
  const environment = (['production', 'staging', 'development'].includes(env('SITE_ENVIRONMENT')) ? env('SITE_ENVIRONMENT') : 'development') as SiteEnvironment;
  return {
    role,
    /** Site routes are mounted for `all` and `site`. SITE_ENABLED=false is a hard off-switch that serves nothing (the flag growth.ssr_public_pages is the soft one). */
    mounted: role !== 'api' && bool('SITE_ENABLED', true),
    environment,
    /** Only an explicit `production` is indexable (robots allow, sitemaps referenced, no X-Robots-Tag noindex). */
    indexable: environment === 'production',
    /** Canonical host is configuration, never the request Host header (cache poisoning guard, ARCH section 5). */
    canonicalHost: env('SITE_CANONICAL_HOST', 'https://kiorex.com').replace(/\/+$/, ''),
    /** Compiled SSR bundle (CommonJS, self-contained) and the client assets of the public hydration entry. */
    ssrBundle: env('SITE_SSR_BUNDLE', resolve(webRoot(), 'dist-public/server/entry-server.cjs')),
    publicClientDir: env('SITE_PUBLIC_CLIENT_DIR', resolve(webRoot(), 'dist-public/client')),
    /** SPA shell used for the flag-OFF and render-failure fallbacks (the existing patient web index.html). */
    spaShell: env('SITE_SPA_SHELL', resolve(webRoot(), 'dist/index.html')),
    /** URL prefix the public client assets are served under (vite base of the public build). */
    assetPrefix: '/_p',
    /** Edge cache: s-maxage / stale-while-revalidate come from the SEO config; these are the in-process cache bounds. */
    cacheMaxEntries: num('SITE_CACHE_MAX_ENTRIES', 500),
    cacheTtlSeconds: num('SITE_CACHE_TTL_SECONDS', 60),
    sitemapTtlSeconds: num('SITE_SITEMAP_TTL_SECONDS', 300),
    renderTimeoutMs: num('SITE_RENDER_TIMEOUT_MS', 5000),
    /** GET / 301s to the default market home (only when the CDN routes / to this role; the SPA owns / for signed-in users otherwise). */
    rootRedirect: bool('SITE_ROOT_REDIRECT', false),
    /** Legacy /doctors/:id 301 to the slug URL (falls through to the SPA shell when the provider has no slug yet). */
    legacyRedirects: bool('SITE_LEGACY_REDIRECTS', true),
    /** Origins allowed to frame public pages. Always empty for the patient site: only the widget host (package G) ever sets one (ADR-044). */
    frameAncestors: [] as string[],
    /** mock = record the paths a CDN purge would invalidate (default); real = NEEDS_HUMAN, not implemented. */
    cdnPurgeMode: (env('SITE_CDN_PURGE_MODE', 'mock') === 'real' ? 'real' : 'mock') as 'mock' | 'real',
    defaultMarket: env('DEFAULT_MARKET', 'EG').toLowerCase(),
  };
};
