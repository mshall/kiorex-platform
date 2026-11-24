"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.looseRedirectTarget = looseRedirectTarget;
const seo_public_1 = require("../growth/seo/seo-public");
const safety_public_1 = require("../safety/safety-public");
const geo_1 = require("./geo");
const url_policy_1 = require("./url-policy");
const SEGMENT = /^[a-z0-9-]{2,60}$/;
const SPECIALTY_BY_ARABIC = (() => {
    const m = new Map();
    for (const [code, label] of Object.entries(safety_public_1.SPECIALTY_LABELS)) {
        const seg = code.replace(/_/g, '-');
        const n = (0, seo_public_1.normalizeArabic)(label.ar);
        m.set(n, seg);
        m.set(n.replace(/^ال/, ''), seg);
        m.set((0, seo_public_1.normalizeArabic)(label.en), seg);
    }
    return m;
})();
function toSegment(raw) {
    if (SEGMENT.test(raw))
        return raw;
    const lower = raw.toLowerCase().replace(/_/g, '-').replace(/\s+/g, '-');
    if (SEGMENT.test(lower))
        return lower;
    const bySpec = SPECIALTY_BY_ARABIC.get((0, seo_public_1.normalizeArabic)(raw)) ?? SPECIALTY_BY_ARABIC.get((0, seo_public_1.normalizeArabic)(raw).replace(/^ال/, ''));
    if (bySpec)
        return bySpec;
    const place = (0, geo_1.slugifyPlace)(raw.replace(/-/g, ' '));
    return place && SEGMENT.test(place) ? place : null;
}
function looseRedirectTarget(pathname) {
    let decoded;
    try {
        decoded = decodeURIComponent(pathname);
    }
    catch {
        return null;
    }
    const m = /^\/(ar|en)\/([a-z]{2})(\/.*)?$/i.exec(decoded);
    if (!m)
        return null;
    const segs = (m[3] ?? '').split('/').filter(Boolean);
    if (!segs.length || segs.length > 4)
        return null;
    const out = [];
    for (const [i, s] of segs.entries()) {
        const t = i === 0 ? s.toLowerCase() : toSegment(s);
        if (!t)
            return null;
        out.push(t);
    }
    const target = `/${m[1].toLowerCase()}/${m[2].toLowerCase()}/${out.join('/')}`;
    if (target === pathname)
        return null;
    return (0, url_policy_1.parsePublicPath)(target).kind === 'match' ? target : null;
}
//# sourceMappingURL=loose-path.js.map