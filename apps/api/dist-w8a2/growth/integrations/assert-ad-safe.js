"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bucketValue = exports.roundToHour = exports.AdUnsafeError = exports.AD_PAYLOAD_KEYS = void 0;
exports.assertAdSafe = assertAdSafe;
const safety_public_1 = require("../../safety/safety-public");
exports.AD_PAYLOAD_KEYS = ['eventName', 'occurredAtHour', 'market', 'valueMinor', 'currency', 'campaignRef', 'clickId'];
const EVENT = /^[A-Za-z][A-Za-z0-9_]{1,39}$/;
const CAMPAIGN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const CLICK = /^[A-Za-z0-9_.-]{10,150}$/;
const HEALTH_OR_PERSON = /specialt|dermat|cardio|pediatr|paediatr|gyn|oncolog|ortho|psych|dental|dentist|ophthal|neuro|urolog|provider|doctor|clinic|clinician|nurse|diagnos|symptom|condition|drug|medic|prescri|treat|lab[_-]?result|pharm|patient|phone|mobile|email|mail|name|address|national/i;
const STRICT_KEYS = ['occurredAtHour', 'market', 'currency'];
const IDENT = [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, /\bc[a-z0-9]{24}\b/, /\b[0-9a-f]{16,}\b/i, /\b(?:sub|usr|user|pat|bk|prov|org|ten)[_-][A-Za-z0-9]{6,}/i, /eyJ[A-Za-z0-9_-]{10,}\./, /[\w.+-]+@[\w-]+\.[\w.-]+/, /\d{9,}/];
class AdUnsafeError extends Error {
    reason;
    code = 'AD_PAYLOAD_UNSAFE';
    constructor(reason) {
        super(`AD_PAYLOAD_UNSAFE: ${reason}`);
        this.reason = reason;
    }
}
exports.AdUnsafeError = AdUnsafeError;
const roundToHour = (iso) => { const t = Date.parse(iso); if (Number.isNaN(t))
    throw new AdUnsafeError('occurredAtHour is not a date'); return new Date(Math.floor(t / 3_600_000) * 3_600_000).toISOString(); };
exports.roundToHour = roundToHour;
const bucketValue = (v, bucket) => Math.round(v / bucket) * bucket;
exports.bucketValue = bucketValue;
const looksLikeIdentifier = (s) => IDENT.some((r) => r.test(s));
function assertAdSafe(input, opts) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new AdUnsafeError('payload must be an object');
    const o = input;
    for (const k of Object.keys(o))
        if (!exports.AD_PAYLOAD_KEYS.includes(k))
            throw new AdUnsafeError(`key ${JSON.stringify(k.slice(0, 24))} is not allowed`);
    for (const [k, v] of Object.entries(o)) {
        if (v === undefined)
            continue;
        if (typeof v === 'string') {
            if (STRICT_KEYS.includes(k))
                continue;
            if (k !== 'clickId' && looksLikeIdentifier(v))
                throw new AdUnsafeError(`${k} looks like an identifier`);
            if ((0, safety_public_1.detectPhi)(v).length)
                throw new AdUnsafeError(`${k} looks like personal data`);
        }
        else if (typeof v !== 'number')
            throw new AdUnsafeError(`${k} has an unsupported type`);
    }
    const eventName = o.eventName;
    const market = o.market;
    const campaignRef = o.campaignRef;
    if (typeof eventName !== 'string' || !EVENT.test(eventName) || HEALTH_OR_PERSON.test(eventName))
        throw new AdUnsafeError('eventName is not an allowed token');
    if (typeof market !== 'string' || !/^[A-Z]{2}$/.test(market))
        throw new AdUnsafeError('market must be a two-letter code');
    if (typeof campaignRef !== 'string' || !CAMPAIGN.test(campaignRef) || HEALTH_OR_PERSON.test(campaignRef))
        throw new AdUnsafeError('campaignRef is not an allowed token');
    if (typeof o.occurredAtHour !== 'string')
        throw new AdUnsafeError('occurredAtHour is required');
    const out = { eventName, occurredAtHour: (0, exports.roundToHour)(o.occurredAtHour), market, campaignRef };
    if (o.valueMinor !== undefined) {
        if (typeof o.valueMinor !== 'number' || !Number.isFinite(o.valueMinor) || o.valueMinor < 0 || o.valueMinor > 1e9)
            throw new AdUnsafeError('valueMinor is out of range');
        out.valueMinor = (0, exports.bucketValue)(o.valueMinor, Math.max(1, opts.valueBucketMinor ?? 1000));
    }
    if (o.currency !== undefined) {
        if (typeof o.currency !== 'string' || !/^[A-Z]{3}$/.test(o.currency))
            throw new AdUnsafeError('currency must be an ISO code');
        out.currency = o.currency;
    }
    if (o.clickId !== undefined) {
        if (!opts.consentAnalytics)
            throw new AdUnsafeError('clickId needs analytics consent');
        if (typeof o.clickId !== 'string' || !CLICK.test(o.clickId) || IDENT.slice(0, 2).concat(IDENT.slice(3, 6)).some((r) => r.test(o.clickId)))
            throw new AdUnsafeError('clickId is malformed');
        out.clickId = o.clickId;
    }
    return out;
}
//# sourceMappingURL=assert-ad-safe.js.map