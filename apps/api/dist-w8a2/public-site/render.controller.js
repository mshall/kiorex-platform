"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPublicNamespace = exports.RenderController = void 0;
const market_core_public_1 = require("../market/market-core-public");
const common_1 = require("@nestjs/common");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const control_plane_public_1 = require("../control-plane/control-plane-public");
const growth_public_1 = require("../growth/growth-public");
const seo_automation_public_1 = require("../growth/seo-automation/seo-automation-public");
const cache_tags_1 = require("./cache-tags");
const head_1 = require("./head");
const loose_path_1 = require("./loose-path");
const search_engines_1 = require("./search-engines");
const headers_1 = require("./headers");
const redirects_service_1 = require("./redirects.service");
const seo_config_service_1 = require("./seo-config.service");
const site_data_service_1 = require("./site-data.service");
const site_index_service_1 = require("./site-index.service");
const ssr_renderer_1 = require("./ssr-renderer");
const site_config_1 = require("./site.config");
const url_policy_1 = require("./url-policy");
Object.defineProperty(exports, "isPublicNamespace", { enumerable: true, get: function () { return url_policy_1.isPublicNamespace; } });
const BRAND_FILES = /^(favicon\.svg|favicon-32\.png|favicon\.ico|apple-touch-icon\.png|manifest\.webmanifest|og-image\.png|kiorex-mark\.svg|pwa\/[a-z0-9-]+\.png)$/;
const TYPES = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.map': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
let RenderController = class RenderController {
    data;
    renderer;
    redirects;
    seo;
    flags;
    index;
    cache;
    quality;
    log = new common_1.Logger('PublicSite');
    constructor(data, renderer, redirects, seo, flags, index, cache, quality) {
        this.data = data;
        this.renderer = renderer;
        this.redirects = redirects;
        this.seo = seo;
        this.flags = flags;
        this.index = index;
        this.cache = cache;
        this.quality = quality;
    }
    handle = async (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            next();
            return;
        }
        const started = performance.now();
        try {
            const loose = /%|_|[^\x00-\x7f]/.test(req.path) ? (0, loose_path_1.looseRedirectTarget)(req.path) : null;
            const parsed = loose ? { kind: 'redirect', to: loose, reason: 'case' } : (0, url_policy_1.parsePublicPath)(req.path);
            const search = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
            if (parsed.kind === 'redirect') {
                this.redirect(res, parsed.to + search, 301, await this.edgeSeconds());
                this.cache.metrics.inc('redirects');
                return;
            }
            if (parsed.kind === 'spa') {
                await this.spaShell(req, res, 'SPA_PAGE');
                return;
            }
            if (parsed.kind === 'none') {
                const loose = (0, loose_path_1.looseRedirectTarget)(req.path);
                if (loose) {
                    this.redirect(res, loose + search, 301, await this.edgeSeconds());
                    this.cache.metrics.inc('redirects_loose');
                    return;
                }
                await this.notFound(req, res, req.path, 'ROUTE_NOT_FOUND', 404);
                return;
            }
            const route = parsed.value;
            const market = route.cc.toUpperCase();
            if (!(await this.index.marketLive(market))) {
                await this.notFound(req, res, req.path, 'MARKET_NOT_LIVE', 404);
                return;
            }
            if (!(await this.flags.isEnabled(growth_public_1.GROWTH_FLAG.SSR_PUBLIC_PAGES, { market }))) {
                this.cache.metrics.inc('flag_off');
                await this.spaShell(req, res, 'FLAG_OFF');
                return;
            }
            const q = (0, url_policy_1.readPageQuery)(req.query);
            const key = (0, url_policy_1.cacheKey)(req.path, q);
            const hit = this.cache.pages.get(key);
            if (hit) {
                this.cache.metrics.inc('cache_hit');
                this.send(req, res, hit, 'HIT');
                return;
            }
            const seo = await this.seo.get(market);
            const loaded = await this.data.load(route, q);
            let response;
            if (loaded.status === 301)
                response = this.redirectResponse(loaded.to, seo.edgeCacheSeconds);
            else if (loaded.status !== 200)
                response = await this.notFoundResponse(req.path, loaded.reason, loaded.status, route.locale, route.cc);
            else
                response = await this.renderPage(route, q, loaded, seo.edgeCacheSeconds, seo.staleWhileRevalidateSeconds, seo.reviewMarkupEnabled, seo.templates);
            this.cache.metrics.observeRender(performance.now() - started);
            this.cache.metrics.inc(`status_${response.status}`);
            this.cache.pages.set(key, response);
            this.send(req, res, response, 'MISS', performance.now() - started);
        }
        catch (e) {
            this.cache.metrics.inc('render_errors');
            this.log.error(`render failed for ${req.path}: ${e.message}`);
            await this.spaShell(req, res, 'RENDER_ERROR');
        }
    };
    async renderPage(route, q, loaded, sMaxAge, swr, reviewMarkup, templates = {}) {
        const cfg = (0, site_config_1.siteCfg)();
        const market = route.cc.toUpperCase();
        const pageKey = (0, seo_automation_public_1.pageKeyOf)(route.type, route.params);
        const blockedByGate = (await this.quality?.blocked(market, pageKey, route.locale).catch(() => false)) ?? false;
        const omitted = (await this.quality?.omittedAlternates(market, pageKey, route.locale).catch(() => [])) ?? [];
        const computed = loaded.data.kind === 'not-found' ? [] : await this.computedLinks(market, pageKey, route.locale, loaded.data);
        const pageData = computed.length ? { ...loaded.data, computedLinks: computed } : loaded.data;
        const out = await this.renderer.render({ locale: route.locale, cc: route.cc, type: route.type, path: this.pathOf(route), query: q, data: pageData, site: { canonicalHost: cfg.canonicalHost, reviewMarkup, templates, imageCdn: process.env.SITE_IMAGE_CDN?.startsWith('https://') ? process.env.SITE_IMAGE_CDN.replace(/\/+$/, '') : null } });
        const indexable = cfg.indexable && loaded.indexable && !blockedByGate;
        const path = this.pathOf(route);
        const all = (0, url_policy_1.hreflangAlternates)(cfg.canonicalHost, route.cc, route.rest);
        const keep = all.filter((a) => !omitted.includes(a.hreflang));
        const alternates = omitted.length ? keep.map((a) => (a.hreflang === 'x-default' ? { ...a, href: keep.find((k) => k.hreflang !== 'x-default')?.href ?? a.href } : a)) : all;
        const assets = this.renderer.assets();
        const { html, styleHash } = (0, head_1.composeDocument)({
            locale: route.locale, cc: route.cc, canonical: (0, url_policy_1.canonicalUrl)(cfg.canonicalHost, path, q), alternates, indexable, title: out.meta.title, description: out.meta.description,
            ogImage: out.meta.ogImage ?? `${cfg.canonicalHost}/og-image.png`, siteName: 'Kiorex', jsonLd: out.jsonLd, bodyHtml: out.html,
            state: { locale: route.locale, cc: route.cc, type: route.type, path, query: q, data: pageData }, assets,
            ...(route.type === 'home' && cfg.indexable ? { verification: { google: (0, search_engines_1.verificationCfg)().googleMeta, bing: (0, search_engines_1.verificationCfg)().bingMeta } } : {}),
        });
        const headers = {
            ...(0, headers_1.securityHeaders)({ styleHashes: assets.css ? [styleHash] : [], frameAncestors: cfg.frameAncestors }),
            'Content-Type': 'text/html; charset=utf-8', 'Content-Language': route.locale, 'Cache-Control': (0, headers_1.publicCacheControl)({ sMaxAge, staleWhileRevalidate: swr }), Vary: 'Accept-Encoding',
            ...(loaded.lastModified ? { 'Last-Modified': loaded.lastModified.toUTCString() } : {}),
            ...(indexable ? {} : { 'X-Robots-Tag': 'noindex' }),
        };
        return { status: 200, headers, body: html, etag: (0, headers_1.etagOf)(html), tags: loaded.tags };
    }
    async computedLinks(market, pageKey, locale, data) {
        if (!this.quality)
            return [];
        try {
            const groups = await this.quality.computedLinks(market, pageKey, locale);
            if (!groups.length)
                return [];
            const seen = new Set();
            const walk = (v) => { if (Array.isArray(v))
                v.forEach(walk);
            else if (v && typeof v === 'object')
                for (const [k, x] of Object.entries(v)) {
                    if (k === 'path' && typeof x === 'string')
                        seen.add(x);
                    else
                        walk(x);
                } };
            walk(data);
            return groups.map((g) => ({ ...g, links: g.links.filter((l) => !seen.has(l.path)) })).filter((g) => g.links.length);
        }
        catch {
            return [];
        }
    }
    pathOf(route) { return `/${route.locale}/${route.cc}${route.rest ? `/${route.rest}` : ''}`; }
    redirectResponse(to, sMaxAge) {
        return { status: 301, headers: { Location: to, 'Cache-Control': (0, headers_1.errorCacheControl)(sMaxAge), Vary: 'Accept-Encoding', 'Content-Type': 'text/plain; charset=utf-8', ...(0, headers_1.securityHeaders)({ styleHashes: [] }) }, body: `Moved to ${to}`, etag: (0, headers_1.etagOf)(to), tags: ['list'] };
    }
    async notFoundResponse(path, reason, status, locale, cc) {
        const cfg = (0, site_config_1.siteCfg)();
        let html;
        let styleHash = '';
        const assets = this.renderer.available() ? this.renderer.assets() : { css: '', script: null, modulePreloads: [], fontPreloads: [] };
        try {
            const out = await this.renderer.render({ locale, cc, type: 'not-found', path, query: { page: 1, sort: null }, data: { kind: 'not-found', reason }, site: { canonicalHost: cfg.canonicalHost, reviewMarkup: false } });
            const doc = (0, head_1.composeDocument)({ locale, cc, canonical: '', alternates: [], indexable: false, title: out.meta.title, description: out.meta.description, ogImage: `${cfg.canonicalHost}/og-image.png`, siteName: 'Kiorex', jsonLd: [], bodyHtml: out.html, state: { locale, cc, type: 'not-found', path, query: { page: 1, sort: null }, data: { kind: 'not-found', reason } }, assets });
            html = doc.html.replace(/<link rel="canonical" href="">/, '');
            styleHash = doc.styleHash;
        }
        catch {
            html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="robots" content="noindex,follow"><title>${status === 410 ? '410' : '404'}</title></head><body><h1>${status === 410 ? 'Gone' : 'Not found'}</h1><p><a href="/${locale}/${(0, head_1.escapeHtml)(cc)}">Kiorex</a></p></body></html>`;
        }
        const headers = { ...(0, headers_1.securityHeaders)({ styleHashes: styleHash ? [styleHash] : [] }), 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': (0, headers_1.errorCacheControl)(60), 'X-Robots-Tag': 'noindex', Vary: 'Accept-Encoding' };
        return { status, headers, body: html, etag: (0, headers_1.etagOf)(html), tags: ['list'] };
    }
    async notFound(req, res, path, reason, status) {
        this.cache.metrics.inc(`status_${status}`);
        const cc = /^\/(?:ar|en)\/([a-z]{2})/i.exec(path)?.[1]?.toLowerCase() ?? market_core_public_1.DEFAULT_MARKET.toLowerCase();
        const locale = (/^\/(ar|en)\//i.exec(path)?.[1]?.toLowerCase() ?? 'ar');
        this.send(req, res, await this.notFoundResponse(path, reason, status, locale, cc), 'MISS');
    }
    send(req, res, r, cacheState, ms) {
        res.removeHeader('X-Powered-By');
        res.set(r.headers);
        res.set('ETag', r.etag);
        res.set('X-Site-Cache', cacheState);
        if (ms !== undefined)
            res.set('Server-Timing', `ssr;dur=${ms.toFixed(1)}`);
        if (r.status === 200 && (0, headers_1.etagMatches)(req.headers['if-none-match'], r.etag)) {
            res.status(304).end();
            return;
        }
        res.status(r.status).send(req.method === 'HEAD' ? undefined : r.body);
    }
    redirect(res, to, status, sMaxAge, extra = {}) {
        res.status(status).set({ Location: to, 'Cache-Control': (0, headers_1.errorCacheControl)(sMaxAge), ...extra }).send(`Moved to ${to}`);
    }
    async edgeSeconds() { return (await this.seo.get()).edgeCacheSeconds; }
    async spaShell(req, res, reason) {
        this.cache.metrics.inc(`spa_shell_${reason.toLowerCase()}`);
        const shell = this.renderer.spaShell();
        const base = { 'X-Robots-Tag': 'noindex', 'Cache-Control': headers_1.noStore, 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'", 'X-Site-Fallback': reason, 'Content-Type': 'text/html; charset=utf-8' };
        if (!shell) {
            res.status(503).set({ ...base, 'Retry-After': '30' }).send('<!doctype html><meta name="robots" content="noindex"><title>Kiorex</title><p>Temporarily unavailable.</p>');
            return;
        }
        const html = /<meta[^>]+name=["']robots["']/i.test(shell) ? shell : shell.replace('</head>', '<meta name="robots" content="noindex,nofollow"></head>');
        res.status(200).set(base).send(req.method === 'HEAD' ? undefined : html);
    }
    legacyDoctor = async (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            next();
            return;
        }
        try {
            const id = String(req.params.id ?? '');
            if (!(0, site_config_1.siteCfg)().legacyRedirects || req.query.book !== undefined) {
                await this.spaShell(req, res, 'LEGACY_APP');
                return;
            }
            if (!(await this.flags.isEnabled(growth_public_1.GROWTH_FLAG.SSR_PUBLIC_PAGES, { market: (0, site_config_1.siteCfg)().defaultMarket.toUpperCase() }))) {
                await this.spaShell(req, res, 'FLAG_OFF');
                return;
            }
            const locale = (0, url_policy_1.negotiateLocale)({ cookie: req.headers.cookie, acceptLanguage: req.headers['accept-language'] });
            const to = await this.redirects.legacyDoctorTarget(id, locale);
            if (!to) {
                await this.spaShell(req, res, 'LEGACY_NO_SLUG');
                return;
            }
            this.cache.metrics.inc('legacy_redirects');
            this.redirect(res, to, 301, 0, { 'Cache-Control': 'private, no-cache', Vary: 'Accept-Language, Cookie' });
        }
        catch (e) {
            this.log.error(`legacy redirect failed: ${e.message}`);
            await this.spaShell(req, res, 'RENDER_ERROR');
        }
    };
    root = async (req, res, next) => {
        if (!(0, site_config_1.siteCfg)().rootRedirect || (req.method !== 'GET' && req.method !== 'HEAD')) {
            next();
            return;
        }
        const live = await this.index.liveMarkets();
        if (live.length !== 1) {
            next();
            return;
        }
        const locale = (0, url_policy_1.negotiateLocale)({ cookie: req.headers.cookie, acceptLanguage: req.headers['accept-language'] });
        this.redirect(res, (0, url_policy_1.buildPath)(locale, live[0], 'home'), 301, 0, { 'Cache-Control': 'private, no-cache', Vary: 'Accept-Language, Cookie' });
    };
    brandAsset = (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            next();
            return;
        }
        const rel = req.path.replace(/^\/+/, '');
        const root = (0, node_path_1.dirname)((0, site_config_1.siteCfg)().spaShell);
        const file = (0, node_path_1.join)(root, rel);
        if (!BRAND_FILES.test(rel) || !file.startsWith(root + node_path_1.sep) || !(0, node_fs_1.existsSync)(file) || !(0, node_fs_1.statSync)(file).isFile()) {
            next();
            return;
        }
        res.status(200).set({ 'Content-Type': TYPES[(0, node_path_1.extname)(file)] ?? 'application/octet-stream', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' }).send(req.method === 'HEAD' ? undefined : (0, node_fs_1.readFileSync)(file));
    };
    assets = (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            next();
            return;
        }
        const root = (0, site_config_1.siteCfg)().publicClientDir;
        const rel = (0, node_path_1.normalize)(decodeURIComponent(req.path.slice((0, site_config_1.siteCfg)().assetPrefix.length))).replace(/^([/\\])+/, '');
        const file = (0, node_path_1.join)(root, rel);
        if (rel.startsWith('..') || !file.startsWith(root + node_path_1.sep) || rel.startsWith('.vite') || !(0, node_fs_1.existsSync)(file) || !(0, node_fs_1.statSync)(file).isFile()) {
            res.status(404).set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).send('Not found');
            return;
        }
        const type = TYPES[(0, node_path_1.extname)(file)] ?? 'application/octet-stream';
        res.status(200).set({ 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': '*' }).send(req.method === 'HEAD' ? undefined : (0, node_fs_1.readFileSync)(file));
    };
    health = async (_req, res) => {
        const cfg = (0, site_config_1.siteCfg)();
        const bundle = this.renderer.available();
        const flagOn = await this.flags.isEnabled(growth_public_1.GROWTH_FLAG.SSR_PUBLIC_PAGES, { market: cfg.defaultMarket.toUpperCase() }).catch(() => null);
        const ready = bundle && !!this.renderer.assets().script;
        res.status(200).set({ 'Cache-Control': headers_1.noStore, 'X-Robots-Tag': 'noindex' }).json({
            status: ready ? 'ok' : 'degraded', role: cfg.role, environment: cfg.environment, indexable: cfg.indexable,
            bundle: { available: bundle, clientAssets: !!this.renderer.assets().script, spaShell: !!this.renderer.spaShell() },
            flag: { key: growth_public_1.GROWTH_FLAG.SSR_PUBLIC_PAGES, enabled: flagOn },
            ...this.cache.metrics.snapshot({ hits: this.cache.pages.hits, misses: this.cache.pages.misses, size: this.cache.pages.size }),
        });
    };
    metrics = (_req, res) => {
        res.status(200).set({ 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8', 'Cache-Control': headers_1.noStore, 'X-Robots-Tag': 'noindex' })
            .send(this.cache.metrics.prometheus({ hits: this.cache.pages.hits, misses: this.cache.pages.misses, size: this.cache.pages.size }));
    };
};
exports.RenderController = RenderController;
exports.RenderController = RenderController = __decorate([
    (0, common_1.Injectable)(),
    __param(7, (0, common_1.Optional)()),
    __param(7, (0, common_1.Inject)(seo_automation_public_1.SEO_QUALITY)),
    __metadata("design:paramtypes", [site_data_service_1.SiteDataService, ssr_renderer_1.SiteRenderer, redirects_service_1.RedirectsService, seo_config_service_1.SeoConfigService,
        control_plane_public_1.FlagsService, site_index_service_1.SiteIndexService, cache_tags_1.PublicSiteCache, Object])
], RenderController);
//# sourceMappingURL=render.controller.js.map