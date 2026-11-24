import { DEFAULT_MARKET } from '../market/market-core-public';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { FlagsService } from '../control-plane/control-plane-public';
import { GROWTH_FLAG } from '../growth/growth-public';
import { SsrVariantService, type SsrVariant } from '../growth/experiments/experiments-public';
import { pageKeyOf, SEO_QUALITY, type ComputedLinkGroup, type SeoQualityPort } from '../growth/seo-automation/seo-automation-public';
import { PublicSiteCache } from './cache-tags';
import { composeDocument, escapeHtml } from './head';
import { looseRedirectTarget } from './loose-path';
import { verificationCfg } from './search-engines';
import { errorCacheControl, etagMatches, etagOf, noStore, publicCacheControl, securityHeaders } from './headers';
import { RedirectsService } from './redirects.service';
import { SeoConfigService } from './seo-config.service';
import { SiteDataService } from './site-data.service';
import { SiteIndexService } from './site-index.service';
import type { LoadResult } from './site-data.types';
import { SiteRenderer } from './ssr-renderer';
import { siteCfg } from './site.config';
import { buildPath, cacheKey, canonicalUrl, hreflangAlternates, negotiateLocale, parsePublicPath, readPageQuery, isPublicNamespace, type Locale } from './url-policy';
import type { CachedResponse } from './page-cache';

const BRAND_FILES = /^(favicon\.svg|favicon-32\.png|favicon\.ico|apple-touch-icon\.png|manifest\.webmanifest|og-image\.png|kiorex-mark\.svg|pwa\/[a-z0-9-]+\.png)$/;
const TYPES: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.map': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };

/**
 * Public site request handler (GRW-P1-E): parse and normalise the URL, check the flag and the market, load PUBLIC data, render through the SSR
 * bundle, answer 200/301/404/410 with CloudFront-friendly headers. The handler never reads the session, cookies or Authorization (they cannot
 * influence the response), so a private value can never reach the page, the in-process cache or the CDN. Any render failure falls back to the
 * client SPA shell: the SEO layer can never take booking down (RB-G2).
 */
@Injectable()
export class RenderController {
  private readonly log = new Logger('PublicSite');
  constructor(
    private readonly data: SiteDataService, private readonly renderer: SiteRenderer, private readonly redirects: RedirectsService, private readonly seo: SeoConfigService,
    private readonly flags: FlagsService, private readonly index: SiteIndexService, private readonly cache: PublicSiteCache,
    @Optional() @Inject(SEO_QUALITY) private readonly quality?: SeoQualityPort,
    @Optional() private readonly variants?: SsrVariantService,
  ) {}

  // ── pages ────────────────────────────────────────────────────────────────────────────────────────────────────

  handle = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { next(); return; }
    const started = performance.now();
    try {
      // percent-encoded, non-ASCII or underscore variants (Arabic names): resolve BEFORE the case normaliser, which would lower-case the escapes
      const loose = /%|_|[^\x00-\x7f]/.test(req.path) ? looseRedirectTarget(req.path) : null;
      const parsed = loose ? ({ kind: 'redirect', to: loose, reason: 'case' } as const) : parsePublicPath(req.path);
      const search = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
      if (parsed.kind === 'redirect') { this.redirect(res, parsed.to + search, 301, await this.edgeSeconds()); this.cache.metrics.inc('redirects'); return; }
      if (parsed.kind === 'spa') { await this.spaShell(req, res, 'SPA_PAGE'); return; }
      if (parsed.kind === 'none') {
        // Arabic, case or underscore variants of a real URL: ONE 301 to the clean canonical (never a second URL for the same page)
        const loose = looseRedirectTarget(req.path);
        if (loose) { this.redirect(res, loose + search, 301, await this.edgeSeconds()); this.cache.metrics.inc('redirects_loose'); return; }
        await this.notFound(req, res, req.path, 'ROUTE_NOT_FOUND', 404); return;
      }
      const route = parsed.value;
      const market = route.cc.toUpperCase();
      if (!(await this.index.marketLive(market))) { await this.notFound(req, res, req.path, 'MARKET_NOT_LIVE', 404); return; }
      if (!(await this.flags.isEnabled(GROWTH_FLAG.SSR_PUBLIC_PAGES, { market }))) { this.cache.metrics.inc('flag_off'); await this.spaShell(req, res, 'FLAG_OFF'); return; }
      const q = readPageQuery(req.query as Record<string, unknown>);
      // GRW-P3-A SSR slot: a variant only for a consented visitor holding the `kxe` cookie on a page type with a copy slot; otherwise null and the shared cache key below is unchanged
      const sv = await this.variants?.resolve({ cookieHeader: req.headers.cookie, pageType: route.type, market, locale: route.locale }).catch(() => null) ?? null;
      const key = cacheKey(req.path, q) + (sv ? `|x:${sv.experiment}:${sv.variant}` : '');
      const hit = this.cache.pages.get(key);
      if (hit) { this.cache.metrics.inc('cache_hit'); this.send(req, res, hit, 'HIT'); return; }
      const seo = await this.seo.get(market);
      const loaded = await this.data.load(route, q);
      let response: CachedResponse;
      if (loaded.status === 301) response = this.redirectResponse(loaded.to, seo.edgeCacheSeconds);
      else if (loaded.status !== 200) response = await this.notFoundResponse(req.path, loaded.reason, loaded.status, route.locale, route.cc);
      else response = await this.renderPage(route, q, loaded, seo.edgeCacheSeconds, seo.staleWhileRevalidateSeconds, seo.reviewMarkupEnabled, seo.templates, sv);
      this.cache.metrics.observeRender(performance.now() - started);
      this.cache.metrics.inc(`status_${response.status}`);
      this.cache.pages.set(key, response);
      this.send(req, res, response, 'MISS', performance.now() - started);
    } catch (e) {
      this.cache.metrics.inc('render_errors');
      this.log.error(`render failed for ${req.path}: ${(e as Error).message}`); // path only: never data, never headers
      await this.spaShell(req, res, 'RENDER_ERROR');
    }
  };

  private async renderPage(route: NonNullable<ReturnType<typeof parsePublicPath> & { kind: 'match' }>['value'], q: ReturnType<typeof readPageQuery>, loaded: Extract<LoadResult, { status: 200 }>, sMaxAge: number, swr: number, reviewMarkup: boolean, templates: Record<string, Record<string, { title?: string; description?: string }>> = {}, sv: SsrVariant | null = null): Promise<CachedResponse> {
    const cfg = siteCfg();
    // GRW-P3-F: stored quality decisions and the computed internal links (read from the database tables, cached; with SEO_AUTOMATION.autoNoindex off nothing here changes a page's indexing)
    const market = route.cc.toUpperCase(); const pageKey = pageKeyOf(route.type, route.params);
    const blockedByGate = (await this.quality?.blocked(market, pageKey, route.locale).catch(() => false)) ?? false;
    const omitted = (await this.quality?.omittedAlternates(market, pageKey, route.locale).catch(() => [])) ?? [];
    const computed = loaded.data.kind === 'not-found' ? [] : await this.computedLinks(market, pageKey, route.locale, loaded.data);
    const pageData = computed.length ? ({ ...loaded.data, computedLinks: computed } as typeof loaded.data) : loaded.data;
    const experiments = sv ? { [sv.surface]: { experiment: sv.experiment, variant: sv.variant } } : undefined;
    const out = await this.renderer.render({ locale: route.locale, cc: route.cc, type: route.type, path: this.pathOf(route), query: q, data: pageData, site: { canonicalHost: cfg.canonicalHost, reviewMarkup, templates, imageCdn: process.env.SITE_IMAGE_CDN?.startsWith('https://') ? process.env.SITE_IMAGE_CDN.replace(/\/+$/, '') : null }, ...(experiments ? { experiments } : {}) });
    const indexable = cfg.indexable && loaded.indexable && !blockedByGate;
    const path = this.pathOf(route);
    // an incomplete locale is not offered as an alternate, and x-default then points at the locale that is complete
    const all = hreflangAlternates(cfg.canonicalHost, route.cc, route.rest);
    const keep = all.filter((a) => !omitted.includes(a.hreflang as Locale));
    const alternates = omitted.length ? keep.map((a) => (a.hreflang === 'x-default' ? { ...a, href: keep.find((k) => k.hreflang !== 'x-default')?.href ?? a.href } : a)) : all;
    const assets = this.renderer.assets();
    const { html, styleHash } = composeDocument({
      locale: route.locale, cc: route.cc, canonical: canonicalUrl(cfg.canonicalHost, path, q), alternates, indexable, title: out.meta.title, description: out.meta.description,
      ogImage: out.meta.ogImage ?? `${cfg.canonicalHost}/og-image.png`, siteName: 'Kiorex', jsonLd: out.jsonLd, bodyHtml: out.html,
      state: { locale: route.locale, cc: route.cc, type: route.type, path, query: q, data: pageData, ...(experiments ? { experiments } : {}) }, assets,
      ...(route.type === 'home' && cfg.indexable ? { verification: { google: verificationCfg().googleMeta, bing: verificationCfg().bingMeta } } : {}),
    });
    const headers: Record<string, string> = {
      ...securityHeaders({ styleHashes: assets.css ? [styleHash] : [], frameAncestors: cfg.frameAncestors }),
      'Content-Type': 'text/html; charset=utf-8', 'Content-Language': route.locale, ...(sv ? { 'Cache-Control': 'private, no-cache', Vary: 'Accept-Encoding, Cookie' } : { 'Cache-Control': publicCacheControl({ sMaxAge, staleWhileRevalidate: swr }), Vary: 'Accept-Encoding' }),
      ...(loaded.lastModified ? { 'Last-Modified': loaded.lastModified.toUTCString() } : {}),
      ...(indexable ? {} : { 'X-Robots-Tag': 'noindex' }),
    };
    return { status: 200, headers, body: html, etag: etagOf(html), tags: loaded.tags };
  }

  /** Computed links not already on the page (the P1 link blocks stay as they are; a computed link only adds what is missing). */
  private async computedLinks(market: string, pageKey: string, locale: Locale, data: unknown): Promise<ComputedLinkGroup[]> {
    if (!this.quality) return [];
    try {
      const groups = await this.quality.computedLinks(market, pageKey, locale);
      if (!groups.length) return [];
      const seen = new Set<string>(); const walk = (v: unknown) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (k === 'path' && typeof x === 'string') seen.add(x); else walk(x); } };
      walk(data);
      return groups.map((g) => ({ ...g, links: g.links.filter((l) => !seen.has(l.path)) })).filter((g) => g.links.length);
    } catch { return []; }
  }

  private pathOf(route: { locale: Locale; cc: string; rest: string }): string { return `/${route.locale}/${route.cc}${route.rest ? `/${route.rest}` : ''}`; }

  private redirectResponse(to: string, sMaxAge: number): CachedResponse {
    return { status: 301, headers: { Location: to, 'Cache-Control': errorCacheControl(sMaxAge), Vary: 'Accept-Encoding', 'Content-Type': 'text/plain; charset=utf-8', ...securityHeaders({ styleHashes: [] }) }, body: `Moved to ${to}`, etag: etagOf(to), tags: ['list'] };
  }

  private async notFoundResponse(path: string, reason: string, status: 404 | 410, locale: Locale, cc: string): Promise<CachedResponse> {
    const cfg = siteCfg();
    let html: string; let styleHash = '';
    const assets = this.renderer.available() ? this.renderer.assets() : { css: '', script: null, modulePreloads: [], fontPreloads: [] };
    try {
      const out = await this.renderer.render({ locale, cc, type: 'not-found', path, query: { page: 1, sort: null }, data: { kind: 'not-found', reason }, site: { canonicalHost: cfg.canonicalHost, reviewMarkup: false } });
      const doc = composeDocument({ locale, cc, canonical: '', alternates: [], indexable: false, title: out.meta.title, description: out.meta.description, ogImage: `${cfg.canonicalHost}/og-image.png`, siteName: 'Kiorex', jsonLd: [], bodyHtml: out.html, state: { locale, cc, type: 'not-found', path, query: { page: 1, sort: null }, data: { kind: 'not-found', reason } }, assets });
      html = doc.html.replace(/<link rel="canonical" href="">/, ''); styleHash = doc.styleHash;
    } catch {
      html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="robots" content="noindex,follow"><title>${status === 410 ? '410' : '404'}</title></head><body><h1>${status === 410 ? 'Gone' : 'Not found'}</h1><p><a href="/${locale}/${escapeHtml(cc)}">Kiorex</a></p></body></html>`;
    }
    const headers = { ...securityHeaders({ styleHashes: styleHash ? [styleHash] : [] }), 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': errorCacheControl(60), 'X-Robots-Tag': 'noindex', Vary: 'Accept-Encoding' };
    return { status, headers, body: html, etag: etagOf(html), tags: ['list'] };
  }

  private async notFound(req: Request, res: Response, path: string, reason: string, status: 404 | 410): Promise<void> {
    this.cache.metrics.inc(`status_${status}`);
    const cc = /^\/(?:ar|en)\/([a-z]{2})/i.exec(path)?.[1]?.toLowerCase() ?? DEFAULT_MARKET.toLowerCase();
    const locale = (/^\/(ar|en)\//i.exec(path)?.[1]?.toLowerCase() ?? 'ar') as Locale;
    this.send(req, res, await this.notFoundResponse(path, reason, status, locale, cc), 'MISS');
  }

  private send(req: Request, res: Response, r: CachedResponse, cacheState: 'HIT' | 'MISS', ms?: number): void {
    res.removeHeader('X-Powered-By');
    res.set(r.headers);
    res.set('ETag', r.etag);
    res.set('X-Site-Cache', cacheState);
    if (ms !== undefined) res.set('Server-Timing', `ssr;dur=${ms.toFixed(1)}`);
    if (r.status === 200 && etagMatches(req.headers['if-none-match'], r.etag)) { res.status(304).end(); return; }
    res.status(r.status).send(req.method === 'HEAD' ? undefined : r.body);
  }

  private redirect(res: Response, to: string, status: 301 | 302, sMaxAge: number, extra: Record<string, string> = {}): void {
    res.status(status).set({ Location: to, 'Cache-Control': errorCacheControl(sMaxAge), ...extra }).send(`Moved to ${to}`);
  }

  private async edgeSeconds(): Promise<number> { return (await this.seo.get()).edgeCacheSeconds; }

  // ── SPA shell fallback (flag OFF, render failure, legacy ids without a slug) ───────────────────────────────────

  async spaShell(req: Request, res: Response, reason: string): Promise<void> {
    this.cache.metrics.inc(`spa_shell_${reason.toLowerCase()}`);
    const shell = this.renderer.spaShell();
    const base = { 'X-Robots-Tag': 'noindex', 'Cache-Control': noStore, 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'", 'X-Site-Fallback': reason, 'Content-Type': 'text/html; charset=utf-8' };
    if (!shell) { res.status(503).set({ ...base, 'Retry-After': '30' }).send('<!doctype html><meta name="robots" content="noindex"><title>Kiorex</title><p>Temporarily unavailable.</p>'); return; }
    const html = /<meta[^>]+name=["']robots["']/i.test(shell) ? shell : shell.replace('</head>', '<meta name="robots" content="noindex,nofollow"></head>');
    res.status(200).set(base).send(req.method === 'HEAD' ? undefined : html);
  }

  // ── legacy SPA URL, root, assets, health ───────────────────────────────────────────────────────────────────────

  /** Legacy /doctors/:id: 301 to the slug URL when the provider has one (locale from kx-lang cookie, then Accept-Language), else the SPA shell. */
  legacyDoctor = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { next(); return; }
    try {
      const id = String(req.params.id ?? '');
      if (!siteCfg().legacyRedirects || req.query.book !== undefined) { await this.spaShell(req, res, 'LEGACY_APP'); return; }
      if (!(await this.flags.isEnabled(GROWTH_FLAG.SSR_PUBLIC_PAGES, { market: siteCfg().defaultMarket.toUpperCase() }))) { await this.spaShell(req, res, 'FLAG_OFF'); return; }
      const locale = negotiateLocale({ cookie: req.headers.cookie, acceptLanguage: req.headers['accept-language'] });
      const to = await this.redirects.legacyDoctorTarget(id, locale);
      if (!to) { await this.spaShell(req, res, 'LEGACY_NO_SLUG'); return; }
      this.cache.metrics.inc('legacy_redirects');
      // locale is negotiated from request headers, so this redirect must not be shared between visitors
      this.redirect(res, to, 301, 0, { 'Cache-Control': 'private, no-cache', Vary: 'Accept-Language, Cookie' });
    } catch (e) { this.log.error(`legacy redirect failed: ${(e as Error).message}`); await this.spaShell(req, res, 'RENDER_ERROR'); }
  };

  /** GET / (only when SITE_ROOT_REDIRECT=true): one live market 301s to its home in the negotiated locale; several would need the selector page. */
  root = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!siteCfg().rootRedirect || (req.method !== 'GET' && req.method !== 'HEAD')) { next(); return; }
    const live = await this.index.liveMarkets();
    if (live.length !== 1) { next(); return; }
    const locale = negotiateLocale({ cookie: req.headers.cookie, acceptLanguage: req.headers['accept-language'] });
    this.redirect(res, buildPath(locale, live[0]!, 'home'), 301, 0, { 'Cache-Control': 'private, no-cache', Vary: 'Accept-Language, Cookie' });
  };

  /**
   * The few unhashed brand files every public page links (favicons, touch icon, web manifest, social image, mark). They live in the patient web build (the SPA shell's folder); without
   * this route a deployment that sends the public pages to this role alone answered 404 for them (a console error on every page). Fixed allow-list, one day of caching.
   */
  brandAsset = (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { next(); return; }
    const rel = req.path.replace(/^\/+/, '');
    const root = dirname(siteCfg().spaShell);
    const file = join(root, rel);
    if (!BRAND_FILES.test(rel) || !file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) { next(); return; }
    res.status(200).set({ 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' }).send(req.method === 'HEAD' ? undefined : readFileSync(file));
  };

  /** Public client assets (hashed, immutable) under /_p/. Path traversal safe; only files inside the public client dir. */
  assets = (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { next(); return; }
    const root = siteCfg().publicClientDir;
    const rel = normalize(decodeURIComponent(req.path.slice(siteCfg().assetPrefix.length))).replace(/^([/\\])+/, '');
    const file = join(root, rel);
    if (rel.startsWith('..') || !file.startsWith(root + sep) || rel.startsWith('.vite') || !existsSync(file) || !statSync(file).isFile()) { res.status(404).set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).send('Not found'); return; }
    const type = TYPES[extname(file)] ?? 'application/octet-stream';
    res.status(200).set({ 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': '*' }).send(req.method === 'HEAD' ? undefined : readFileSync(file));
  };

  health = async (_req: Request, res: Response): Promise<void> => {
    const cfg = siteCfg();
    const bundle = this.renderer.available();
    const flagOn = await this.flags.isEnabled(GROWTH_FLAG.SSR_PUBLIC_PAGES, { market: cfg.defaultMarket.toUpperCase() }).catch(() => null);
    const ready = bundle && !!this.renderer.assets().script;
    res.status(200).set({ 'Cache-Control': noStore, 'X-Robots-Tag': 'noindex' }).json({
      status: ready ? 'ok' : 'degraded', role: cfg.role, environment: cfg.environment, indexable: cfg.indexable,
      bundle: { available: bundle, clientAssets: !!this.renderer.assets().script, spaShell: !!this.renderer.spaShell() },
      flag: { key: GROWTH_FLAG.SSR_PUBLIC_PAGES, enabled: flagOn },
      ...this.cache.metrics.snapshot({ hits: this.cache.pages.hits, misses: this.cache.pages.misses, size: this.cache.pages.size }),
    });
  };

  metrics = (_req: Request, res: Response): void => {
    res.status(200).set({ 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8', 'Cache-Control': noStore, 'X-Robots-Tag': 'noindex' })
      .send(this.cache.metrics.prometheus({ hits: this.cache.pages.hits, misses: this.cache.pages.misses, size: this.cache.pages.size }));
  };
}

export { isPublicNamespace };
