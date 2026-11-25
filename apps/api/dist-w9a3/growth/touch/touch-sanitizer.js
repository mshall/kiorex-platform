"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VISITOR_KEY_PATTERN = exports.TOUCH_MAX_BODY_BYTES = exports.REF_PATTERN = exports.UTM_PATTERN = exports.UTM_KEYS = exports.CLICK_ID_KINDS = void 0;
exports.parseTouchBody = parseTouchBody;
exports.uaClassOf = uaClassOf;
exports.referrerHostOf = referrerHostOf;
exports.sourceKindOf = sourceKindOf;
exports.parseCookies = parseCookies;
const contracts_1 = require("@kiorex/contracts");
const safety_public_1 = require("../../safety/safety-public");
const growth_errors_1 = require("../growth-errors");
exports.CLICK_ID_KINDS = ['GCLID', 'FBCLID', 'TTCLID', 'MSCLKID', 'WBRAID', 'GBRAID'];
exports.UTM_KEYS = ['source', 'medium', 'campaign', 'content', 'term'];
exports.UTM_PATTERN = /^[A-Za-z0-9_.~:+/-]{1,64}$/;
exports.REF_PATTERN = /^[0-9A-Za-z]{4,16}$/;
exports.TOUCH_MAX_BODY_BYTES = 4096;
const looksPersonal = (v) => v.includes('@') || /%40/i.test(v) || (0, safety_public_1.detectPhi)(v).length > 0;
function parseTouchBody(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body))
        throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'Body must be a JSON object');
    const b = body;
    if (!contracts_1.GROWTH_LANDING_KINDS.includes(b.landingKind))
        throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'landingKind is required and must be a known landing kind', { allowed: contracts_1.GROWTH_LANDING_KINDS });
    const out = { landingKind: b.landingKind, utm: {} };
    if (b.utm !== undefined) {
        if (!b.utm || typeof b.utm !== 'object' || Array.isArray(b.utm))
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'utm must be an object');
        for (const k of exports.UTM_KEYS) {
            const v = b.utm[k];
            if (v === undefined)
                continue;
            if (typeof v !== 'string')
                throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', `utm.${k} must be a string`);
            if (looksPersonal(v))
                throw (0, growth_errors_1.growthError)('GROWTH_PHI_REJECTED', `utm.${k} looks like personal data and the call was rejected`);
            if (!exports.UTM_PATTERN.test(v))
                throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', `utm.${k} must match ${exports.UTM_PATTERN.source}`);
            out.utm[k] = v;
        }
    }
    if (b.clickId !== undefined) {
        const c = b.clickId;
        if (!c || typeof c !== 'object' || !exports.CLICK_ID_KINDS.includes(c.kind) || typeof c.value !== 'string' || c.value.length < 1 || c.value.length > 128)
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'clickId needs a known kind and a value of 1 to 128 characters');
        out.clickId = { kind: c.kind, value: c.value };
    }
    if (b.ref !== undefined) {
        if (typeof b.ref !== 'string' || !exports.REF_PATTERN.test(b.ref))
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'ref must be 4 to 16 letters or digits');
        out.ref = b.ref;
    }
    if (b.lt !== undefined) {
        if (typeof b.lt !== 'string' || b.lt.length < 1 || b.lt.length > 512)
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'lt must be a string of at most 512 characters');
        out.lt = b.lt;
    }
    if (b.dwellMs !== undefined) {
        if (!Number.isInteger(b.dwellMs) || b.dwellMs < 0 || b.dwellMs > 600_000)
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'dwellMs must be an integer from 0 to 600000');
        out.dwellMs = b.dwellMs;
    }
    return out;
}
function uaClassOf(ua) {
    if (!ua)
        return 'unknown';
    const s = ua.toLowerCase();
    if (/bot|crawl|spider|slurp|headless|preview|facebookexternalhit|curl|wget/.test(s))
        return 'bot';
    const platform = /iphone|ipad|ios/.test(s) ? 'ios' : /android/.test(s) ? 'android' : /windows|macintosh|linux|cros/.test(s) ? 'desktop' : 'other';
    const family = /edg\//.test(s) ? 'edge' : /chrome|crios/.test(s) ? 'chrome' : /firefox|fxios/.test(s) ? 'firefox' : /safari/.test(s) ? 'safari' : 'other';
    return `${platform}-${family}`;
}
function referrerHostOf(referer, selfOrigin) {
    if (!referer)
        return null;
    try {
        const u = new URL(referer);
        if (selfOrigin) {
            try {
                if (new URL(selfOrigin).host === u.host)
                    return null;
            }
            catch { }
        }
        return u.host.slice(0, 255);
    }
    catch {
        return null;
    }
}
const SEARCH_HOSTS = /(^|\.)(google|bing|yahoo|duckduckgo|yandex|baidu|ecosia)\./i;
const PAID_MEDIUM = /^(cpc|ppc|paid|paidsocial|paid-social|display|cpm|banner|retargeting|sms|whatsapp|email|push|campaign)$/i;
function sourceKindOf(t, referrerHost) {
    switch (t.landingKind) {
        case 'PROVIDER_LINK': return 'PROVIDER_LINK';
        case 'WIDGET': return 'WIDGET';
        case 'REFERRAL': return 'REFERRAL';
        case 'WHATSAPP': return 'WHATSAPP';
        case 'CAMPAIGN': return 'CAMPAIGN';
        case 'APP_OPEN': return 'DIRECT';
        default: break;
    }
    if (t.clickId || (t.utm.medium && PAID_MEDIUM.test(t.utm.medium)))
        return 'CAMPAIGN';
    if (t.utm.medium?.toLowerCase() === 'organic' || (referrerHost && SEARCH_HOSTS.test(referrerHost)))
        return 'ORGANIC_SEARCH';
    if (['SPECIALTY_CITY', 'SPECIALTY_DISTRICT', 'CARE_TYPE_DISTRICT', 'HUB', 'DOCTOR', 'CLINIC'].includes(t.landingKind))
        return 'ORGANIC_SEARCH';
    return 'DIRECT';
}
function parseCookies(header) {
    const out = {};
    for (const part of (header ?? '').split(';')) {
        const i = part.indexOf('=');
        if (i > 0) {
            try {
                out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
            }
            catch { }
        }
    }
    return out;
}
exports.VISITOR_KEY_PATTERN = /^kxv_[A-Za-z0-9_-]{22,64}$/;
//# sourceMappingURL=touch-sanitizer.js.map