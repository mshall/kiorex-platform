"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearCookie = exports.KXE_COOKIE = void 0;
exports.parseKxe = parseKxe;
exports.variantFor = variantFor;
exports.setCookieFor = setCookieFor;
exports.cacheVaryKey = cacheVaryKey;
const experiment_types_1 = require("./experiment.types");
exports.KXE_COOKIE = 'kxe';
const ENTRY = /^[a-z0-9][a-z0-9_-]{1,62}:[a-z0-9_-]{1,32}$/;
function parseKxe(cookieHeader) {
    const out = new Map();
    const m = /(?:^|;\s*)kxe=([^;]*)/.exec(cookieHeader ?? '');
    if (!m)
        return out;
    let raw = '';
    try {
        raw = decodeURIComponent(m[1]);
    }
    catch {
        return out;
    }
    for (const e of raw.split('.').slice(0, experiment_types_1.EXPERIMENT_POLICY.maxCookieExperiments)) {
        if (!ENTRY.test(e))
            continue;
        const [k, v] = e.split(':');
        if (!out.has(k))
            out.set(k, v);
    }
    return out;
}
function variantFor(cookieHeader, exp) {
    const v = parseKxe(cookieHeader).get(exp.key);
    return v && exp.variants.some((x) => x.key === v) ? v : exp.variants[0].key;
}
function setCookieFor(assignments, consentAnalytics, o = {}) {
    if (!consentAnalytics || assignments.length === 0)
        return null;
    const v = assignments.slice(0, experiment_types_1.EXPERIMENT_POLICY.maxCookieExperiments).map((a) => `${a.key}:${a.variant}`).join('.');
    return `${exports.KXE_COOKIE}=${encodeURIComponent(v)}; Path=/; Max-Age=${14 * 86400}; SameSite=Lax${o.secure === false ? '' : '; Secure'}`;
}
const clearCookie = () => `${exports.KXE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; Secure`;
exports.clearCookie = clearCookie;
function cacheVaryKey(cookieHeader) {
    const m = parseKxe(cookieHeader);
    return [...m.entries()].map(([k, v]) => `${k}:${v}`).join('.');
}
//# sourceMappingURL=ssr-variant.js.map