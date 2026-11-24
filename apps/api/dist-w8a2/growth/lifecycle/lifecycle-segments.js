"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isClinicalSegmentKey = exports.FORBIDDEN_SEGMENT_EXACT = exports.FORBIDDEN_SEGMENT_HINTS = exports.SEGMENT_ATTRIBUTES = void 0;
exports.validateSegmentRule = validateSegmentRule;
exports.inSegment = inSegment;
exports.validatePolicySegments = validatePolicySegments;
exports.SEGMENT_ATTRIBUTES = ['stage', 'platform', 'language', 'city', 'district', 'registeredDaysAgo', 'lastBookingDaysAgo', 'hasDependants', 'referralStatus'];
exports.FORBIDDEN_SEGMENT_HINTS = ['specialty', 'doctor', 'clinician', 'provider', 'reason', 'visitreason', 'diagnosis', 'icd', 'prescription', 'medication', 'drug', 'pharmacy', 'condition', 'symptom', 'insur', 'gender', 'dateofbirth', 'nationalid'];
exports.FORBIDDEN_SEGMENT_EXACT = ['age', 'lab', 'labs', 'rx', 'test', 'tests', 'sex'];
const isClinicalSegmentKey = (k) => { const l = k.toLowerCase(); return exports.FORBIDDEN_SEGMENT_EXACT.includes(l) || exports.FORBIDDEN_SEGMENT_HINTS.some((h) => l.includes(h)) || /^lab[A-Z_]/.test(k) || /^rx[A-Z_]/.test(k) || /^test[A-Z_]/.test(k); };
exports.isClinicalSegmentKey = isClinicalSegmentKey;
function validateSegmentRule(input) {
    if (input === null || typeof input !== 'object' || Array.isArray(input))
        return { valid: false, errors: ['/: a segment is an object of allowlisted attributes'] };
    const o = input;
    const errors = [];
    const out = {};
    for (const k of Object.keys(o)) {
        if (!exports.SEGMENT_ATTRIBUTES.includes(k)) {
            const clinical = (0, exports.isClinicalSegmentKey)(k);
            errors.push(`/${k}: ${clinical ? 'clinical or identifying attribute, never allowed in a segment' : 'not an allowed segment attribute'} (allowed: ${exports.SEGMENT_ATTRIBUTES.join(', ')})`);
        }
    }
    const strList = (k, re, max) => {
        if (o[k] === undefined)
            return;
        const v = o[k];
        if (!Array.isArray(v) || v.length === 0 || v.length > max || !v.every((x) => typeof x === 'string' && re.test(x)))
            errors.push(`/${k}: a non-empty list of at most ${max} valid values is required`);
        else
            out[k] = [...new Set(v)];
    };
    strList('stage', /^[A-Z][A-Z0-9_]{1,31}$/, 10);
    strList('platform', /^(web|ios|android)$/, 3);
    strList('language', /^(ar|en)$/, 2);
    strList('city', /^[\p{L}\p{N} .'’-]{1,60}$/u, 50);
    strList('district', /^[\p{L}\p{N} .'’-]{1,60}$/u, 100);
    strList('referralStatus', /^[A-Z][A-Z0-9_]{1,31}$/, 10);
    for (const k of ['registeredDaysAgo', 'lastBookingDaysAgo']) {
        if (o[k] === undefined)
            continue;
        const r = o[k];
        const ok = r && typeof r === 'object' && Object.keys(r).every((x) => x === 'min' || x === 'max') && [r.min, r.max].every((n) => n === undefined || (Number.isInteger(n) && n >= 0 && n <= 3650));
        if (!ok || (r.min === undefined && r.max === undefined))
            errors.push(`/${k}: { min?, max? } whole days between 0 and 3650`);
        else if (r.min !== undefined && r.max !== undefined && r.min > r.max)
            errors.push(`/${k}: min must not exceed max`);
        else
            out[k] = r;
    }
    if (o.hasDependants !== undefined) {
        if (typeof o.hasDependants === 'boolean')
            out.hasDependants = o.hasDependants;
        else
            errors.push('/hasDependants: true or false');
    }
    return errors.length ? { valid: false, errors } : { valid: true, value: out };
}
function inSegment(rule, f) {
    const keys = Object.keys(rule);
    if (!keys.length)
        return false;
    const inList = (list, v) => !list || (!!v && list.includes(v));
    const inRange = (r, n) => !r || (n !== null && (r.min === undefined || n >= r.min) && (r.max === undefined || n <= r.max));
    return inList(rule.stage, f.stage) && inList(rule.platform, f.platform) && inList(rule.language, f.language) && inList(rule.city, f.city) && inList(rule.district, f.district) && inList(rule.referralStatus, f.referralStatus)
        && inRange(rule.registeredDaysAgo, f.registeredDaysAgo) && inRange(rule.lastBookingDaysAgo, f.lastBookingDaysAgo) && (rule.hasDependants === undefined || rule.hasDependants === f.hasDependants);
}
function validatePolicySegments(segments) {
    if (segments === undefined)
        return [];
    if (segments === null || typeof segments !== 'object' || Array.isArray(segments))
        return ['/segments: object expected'];
    const errors = [];
    for (const [name, def] of Object.entries(segments)) {
        const attrs = def?.attributes;
        if (!Array.isArray(attrs)) {
            errors.push(`/segments/${name}/attributes: list expected`);
            continue;
        }
        for (const a of attrs)
            if (!exports.SEGMENT_ATTRIBUTES.includes(String(a)))
                errors.push(`/segments/${name}/attributes: "${String(a)}" is not an allowed segment attribute`);
    }
    return errors;
}
//# sourceMappingURL=lifecycle-segments.js.map