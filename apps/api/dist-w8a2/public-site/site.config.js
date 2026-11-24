"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.siteCfg = void 0;
const market_core_public_1 = require("../market/market-core-public");
const node_path_1 = require("node:path");
const env = (k, d = '') => process.env[k] ?? d;
const num = (k, d) => {
    const v = Number(process.env[k]);
    return Number.isFinite(v) && process.env[k] !== undefined && process.env[k] !== '' ? v : d;
};
const bool = (k, d) => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k] === 'true');
const webRoot = () => (0, node_path_1.resolve)(__dirname, '..', '..', '..', 'web');
const siteCfg = () => {
    const role = (['all', 'api', 'site'].includes(env('SITE_ROLE')) ? env('SITE_ROLE') : 'all');
    const environment = (['production', 'staging', 'development'].includes(env('SITE_ENVIRONMENT')) ? env('SITE_ENVIRONMENT') : 'development');
    return {
        role,
        mounted: role !== 'api' && bool('SITE_ENABLED', true),
        environment,
        indexable: environment === 'production',
        canonicalHost: env('SITE_CANONICAL_HOST', 'https://kiorex.com').replace(/\/+$/, ''),
        ssrBundle: env('SITE_SSR_BUNDLE', (0, node_path_1.resolve)(webRoot(), 'dist-public/server/entry-server.cjs')),
        publicClientDir: env('SITE_PUBLIC_CLIENT_DIR', (0, node_path_1.resolve)(webRoot(), 'dist-public/client')),
        spaShell: env('SITE_SPA_SHELL', (0, node_path_1.resolve)(webRoot(), 'dist/index.html')),
        assetPrefix: '/_p',
        cacheMaxEntries: num('SITE_CACHE_MAX_ENTRIES', 500),
        cacheTtlSeconds: num('SITE_CACHE_TTL_SECONDS', 60),
        sitemapTtlSeconds: num('SITE_SITEMAP_TTL_SECONDS', 300),
        renderTimeoutMs: num('SITE_RENDER_TIMEOUT_MS', 5000),
        rootRedirect: bool('SITE_ROOT_REDIRECT', false),
        legacyRedirects: bool('SITE_LEGACY_REDIRECTS', true),
        frameAncestors: [],
        cdnPurgeMode: (env('SITE_CDN_PURGE_MODE', 'mock') === 'real' ? 'real' : 'mock'),
        defaultMarket: env('DEFAULT_MARKET', market_core_public_1.DEFAULT_MARKET).toLowerCase(),
    };
};
exports.siteCfg = siteCfg;
//# sourceMappingURL=site.config.js.map