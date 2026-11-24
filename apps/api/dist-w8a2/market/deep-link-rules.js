"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.URL_VALUED_PARAMS = exports.isSafeSegment = exports.isRefCode = exports.isProviderLinkCode = exports.LOCALES = exports.SAFE_SEGMENT_RE = exports.REF_CODE_RE = exports.PROVIDER_LINK_CODE_RE = void 0;
exports.normalizeProviderCode = normalizeProviderCode;
exports.normalizeLocale = normalizeLocale;
exports.normalizeCc = normalizeCc;
exports.chooseMarket = chooseMarket;
exports.looksLikeUrlOrTraversal = looksLikeUrlOrTraversal;
exports.PROVIDER_LINK_CODE_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/;
exports.REF_CODE_RE = /^[0-9A-Za-z]{4,16}$/;
exports.SAFE_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
exports.LOCALES = ['ar', 'en'];
const CC_RE = /^[a-z]{2}$/;
const isProviderLinkCode = (v) => typeof v === 'string' && exports.PROVIDER_LINK_CODE_RE.test(v);
exports.isProviderLinkCode = isProviderLinkCode;
const isRefCode = (v) => typeof v === 'string' && exports.REF_CODE_RE.test(v);
exports.isRefCode = isRefCode;
const isSafeSegment = (v) => typeof v === 'string' && exports.SAFE_SEGMENT_RE.test(v);
exports.isSafeSegment = isSafeSegment;
function normalizeProviderCode(v) {
    if (typeof v !== 'string' || v.length !== 8)
        return null;
    const u = v.toUpperCase();
    return exports.PROVIDER_LINK_CODE_RE.test(u) ? u : null;
}
function normalizeLocale(v, fallback = 'ar') {
    return typeof v === 'string' && exports.LOCALES.includes(v.toLowerCase()) ? v.toLowerCase() : fallback;
}
function normalizeCc(v) {
    if (typeof v !== 'string')
        return null;
    const l = v.toLowerCase();
    return CC_RE.test(l) ? l : null;
}
function chooseMarket(linkCc, liveMarkets, defaultMarket) {
    const cc = normalizeCc(linkCc);
    const live = liveMarkets.map((m) => m.toUpperCase());
    if (cc && live.includes(cc.toUpperCase()))
        return cc.toUpperCase();
    return live.includes(defaultMarket.toUpperCase()) ? defaultMarket.toUpperCase() : (live[0] ?? defaultMarket.toUpperCase());
}
exports.URL_VALUED_PARAMS = ['to', 'url', 'redirect', 'redirect_uri', 'redirectUrl', 'next', 'return', 'returnTo', 'return_url', 'continue', 'dest', 'destination', 'target', 'link', 'u', 'goto'];
function looksLikeUrlOrTraversal(v) {
    if (/[\u0000-\u001f\u007f\\]/.test(v))
        return true;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(v) || v.startsWith('//'))
        return true;
    let d = v;
    for (let i = 0; i < 3; i++) {
        try {
            const n = decodeURIComponent(d);
            if (n === d)
                break;
            d = n;
        }
        catch {
            return true;
        }
    }
    return /[\\/]|\.\.|^[a-zA-Z][a-zA-Z0-9+.-]*:|\u0000/.test(d);
}
//# sourceMappingURL=deep-link-rules.js.map