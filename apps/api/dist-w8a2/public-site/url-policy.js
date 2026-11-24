"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPrivatePath = exports.PRIVATE_PATH_PREFIXES = exports.switchLocale = exports.isTrackingKey = exports.TRACKING_QUERY_KEYS = exports.SORT_VALUES = exports.CONTENT_QUERY_KEYS = exports.isPublicNamespace = exports.SPA_PASSTHROUGH_PAGES = exports.CARE_SEGMENTS = exports.ROUTES = exports.PAGE_TYPES = exports.isLocale = exports.DEFAULT_LOCALE = exports.LOCALES = void 0;
exports.parsePublicPath = parsePublicPath;
exports.buildPath = buildPath;
exports.readPageQuery = readPageQuery;
exports.cacheKey = cacheKey;
exports.canonicalUrl = canonicalUrl;
exports.hreflangAlternates = hreflangAlternates;
exports.negotiateLocale = negotiateLocale;
exports.LOCALES = ['ar', 'en'];
exports.DEFAULT_LOCALE = 'ar';
const isLocale = (v) => exports.LOCALES.includes(v);
exports.isLocale = isLocale;
exports.PAGE_TYPES = ['home', 'hub', 'city', 'district', 'care-district', 'city-hub', 'district-hub', 'same-day', 'telemedicine', 'doctor', 'clinic', 'nurse', 'pharmacy', 'lab', 'static'];
const SLUG = '[a-z0-9-]{2,60}';
exports.ROUTES = [
    { type: 'home', pattern: '', slugEntity: null, inSitemap: true, enabled: true },
    { type: 'hub', pattern: 'doctors/:specialty', slugEntity: null, inSitemap: true, enabled: true },
    { type: 'city', pattern: 'doctors/:specialty/:city', slugEntity: null, inSitemap: true, enabled: true },
    { type: 'district', pattern: 'doctors/:specialty/:city/:district', slugEntity: null, inSitemap: true, enabled: true },
    { type: 'care-district', pattern: ':care/:city/:district', slugEntity: null, inSitemap: true, enabled: true },
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
exports.CARE_SEGMENTS = { 'home-nursing': 'HOME_NURSING', physiotherapy: 'PHYSIOTHERAPY' };
exports.SPA_PASSTHROUGH_PAGES = ['preferences', 'invite/:code'];
const PASSTHROUGH_RES = exports.SPA_PASSTHROUGH_PAGES.map((p) => ({ page: p, re: new RegExp(`^${p.split('/').map((seg) => (seg.startsWith(':') ? '[a-z0-9_:-]{1,64}' : seg)).join('\\/')}$`) }));
const PREFIX = /^\/(ar|en)\/([a-z]{2})(\/.*)?$/i;
const matchers = exports.ROUTES.filter((r) => r.type !== 'static').map((def) => {
    const names = [];
    const src = def.pattern.split('/').map((seg) => {
        if (!seg.startsWith(':'))
            return seg;
        const n = seg.slice(1);
        names.push(n);
        return n === 'care' ? '(home-nursing|physiotherapy)' : `(${SLUG})`;
    }).join('\\/');
    return { def, re: new RegExp(`^${src}$`), names };
});
function parsePublicPath(pathname) {
    if (!PREFIX.test(pathname))
        return { kind: 'none' };
    let p = pathname;
    let reason = null;
    if (/\/\/+/.test(p)) {
        p = p.replace(/\/{2,}/g, '/');
        reason = 'duplicate-slash';
    }
    if (p.length > 1 && p.endsWith('/')) {
        p = p.replace(/\/+$/, '');
        reason ??= 'trailing-slash';
    }
    if (p !== p.toLowerCase()) {
        p = p.toLowerCase();
        reason ??= 'case';
    }
    if (reason)
        return { kind: 'redirect', to: p, reason };
    const m = PREFIX.exec(p);
    const locale = m[1];
    const cc = m[2];
    const rest = (m[3] ?? '').replace(/^\//, '');
    const spa = PASSTHROUGH_RES.find((x) => x.re.test(rest));
    if (spa)
        return { kind: 'spa', page: spa.page };
    for (const { def, re, names } of matchers) {
        const r = re.exec(rest);
        if (!r)
            continue;
        const params = {};
        names.forEach((n, i) => { params[n] = r[i + 1]; });
        return { kind: 'match', value: { locale, cc, type: def.type, params, rest } };
    }
    return { kind: 'none' };
}
const isPublicNamespace = (pathname) => PREFIX.test(pathname);
exports.isPublicNamespace = isPublicNamespace;
function buildPath(locale, cc, type, params = {}) {
    const def = exports.ROUTES.find((r) => r.type === type);
    if (!def)
        throw new Error(`unknown page type ${type}`);
    const rest = def.pattern.split('/').filter(Boolean).map((seg) => (seg.startsWith(':') ? (params[seg.slice(1)] ?? '') : seg)).join('/');
    return `/${locale}/${cc.toLowerCase()}${rest ? `/${rest}` : ''}`;
}
exports.CONTENT_QUERY_KEYS = ['page', 'sort'];
exports.SORT_VALUES = ['rating', 'fee', 'earliest'];
exports.TRACKING_QUERY_KEYS = ['gclid', 'fbclid', 'msclkid', 'ttclid', 's', 'ref', 'lt', 'src'];
const isTrackingKey = (k) => k.startsWith('utm_') || exports.TRACKING_QUERY_KEYS.includes(k.toLowerCase());
exports.isTrackingKey = isTrackingKey;
function readPageQuery(query) {
    const one = (v) => (Array.isArray(v) ? v[0] : v);
    const pageRaw = Number(one(query.page));
    const page = Number.isInteger(pageRaw) && pageRaw >= 1 && pageRaw <= 500 ? pageRaw : 1;
    const sortRaw = String(one(query.sort) ?? '');
    const sort = exports.SORT_VALUES.includes(sortRaw) ? sortRaw : null;
    return { page, sort };
}
function cacheKey(pathname, q) {
    const parts = [];
    if (q.page > 1)
        parts.push(`page=${q.page}`);
    if (q.sort)
        parts.push(`sort=${q.sort}`);
    return parts.length ? `${pathname}?${parts.join('&')}` : pathname;
}
const host = (h) => h.replace(/\/+$/, '');
function canonicalUrl(canonicalHost, path, q) {
    return `${host(canonicalHost)}${path}${q && q.page > 1 ? `?page=${q.page}` : ''}`;
}
function hreflangAlternates(canonicalHost, cc, rest, opts = {}) {
    const tail = rest ? `/${rest}` : '';
    const alts = exports.LOCALES.map((l) => ({ hreflang: l, href: `${host(canonicalHost)}/${l}/${cc.toLowerCase()}${tail}` }));
    alts.push({ hreflang: 'x-default', href: opts.rootSelector ? `${host(canonicalHost)}/` : `${host(canonicalHost)}/${exports.DEFAULT_LOCALE}/${cc.toLowerCase()}${tail}` });
    return alts;
}
const switchLocale = (path, to) => path.replace(/^\/(ar|en)\//, `/${to}/`);
exports.switchLocale = switchLocale;
function negotiateLocale(opts) {
    const c = /(?:^|;\s*)kx-lang=(ar|en)\b/.exec(opts.cookie ?? '');
    if (c)
        return c[1];
    const ranked = (opts.acceptLanguage ?? '').split(',').map((part, i) => {
        const [tag = '', ...params] = part.trim().split(';');
        const q = params.map((x) => /^\s*q=([\d.]+)/.exec(x)?.[1]).find(Boolean);
        return { lang: tag.trim().toLowerCase().split('-')[0] ?? '', q: q === undefined ? 1 : Number(q), i };
    }).filter((x) => (0, exports.isLocale)(x.lang) && Number.isFinite(x.q) && x.q > 0).sort((a, b) => b.q - a.q || a.i - b.i);
    return ranked[0]?.lang ?? exports.DEFAULT_LOCALE;
}
exports.PRIVATE_PATH_PREFIXES = [
    '/api/', '/auth/', '/account', '/appointments', '/checkout/', '/care-plans', '/lab/', '/notifications', '/pharmacy', '/records', '/search',
    '/telemedicine', '/visit-status/', '/waitlist', '/services', '/rx/', '/dev/', '/referral', '/invite/',
];
const isPrivatePath = (pathname) => exports.PRIVATE_PATH_PREFIXES.some((p) => pathname === p.replace(/\/$/, '') || pathname.startsWith(p));
exports.isPrivatePath = isPrivatePath;
//# sourceMappingURL=url-policy.js.map