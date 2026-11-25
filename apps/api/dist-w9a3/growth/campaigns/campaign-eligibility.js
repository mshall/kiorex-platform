"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PATIENT_TYPES = exports.LANGUAGES = exports.CARE_TYPES = exports.PLATFORMS = exports.ELIGIBILITY_KEYS = void 0;
exports.validateEligibility = validateEligibility;
exports.isEligible = isEligible;
exports.ELIGIBILITY_KEYS = ['markets', 'cities', 'districts', 'platforms', 'patientType', 'registrationAgeDaysMax', 'registrationAgeDaysMin', 'lifecycleStages', 'careTypes', 'languages'];
exports.PLATFORMS = ['web', 'ios', 'android'];
exports.CARE_TYPES = ['IN_CLINIC', 'VIDEO', 'HOME_VISIT'];
exports.LANGUAGES = ['ar', 'en'];
exports.PATIENT_TYPES = ['ANY', 'NEW', 'RETURNING'];
const place = /^[\p{L}\p{N} .'’-]{1,60}$/u;
const stage = /^[A-Z][A-Z0-9_]{1,31}$/;
const list = (v, ok, path, max, errors) => {
    if (v === undefined)
        return undefined;
    if (!Array.isArray(v) || v.length > max || !v.every(ok)) {
        errors.push(`${path}: a list of at most ${max} valid values is required`);
        return undefined;
    }
    return [...new Set(v)];
};
function validateEligibility(input) {
    const errors = [];
    if (input === undefined || input === null)
        return { valid: true, value: {} };
    if (typeof input !== 'object' || Array.isArray(input))
        return { valid: false, errors: ['/: eligibility must be an object'] };
    const o = input;
    const out = {};
    for (const k of Object.keys(o))
        if (!exports.ELIGIBILITY_KEYS.includes(k))
            errors.push(`/${k}: not an allowed eligibility key (only non-clinical attributes: ${exports.ELIGIBILITY_KEYS.join(', ')})`);
    const m = list(o.markets, (x) => typeof x === 'string' && /^[A-Z]{2}$/.test(x), '/markets', 10, errors);
    if (m)
        out.markets = m;
    const ci = list(o.cities, (x) => typeof x === 'string' && place.test(x), '/cities', 50, errors);
    if (ci)
        out.cities = ci;
    const di = list(o.districts, (x) => typeof x === 'string' && place.test(x), '/districts', 100, errors);
    if (di)
        out.districts = di;
    const pl = list(o.platforms, (x) => exports.PLATFORMS.includes(x), '/platforms', 3, errors);
    if (pl)
        out.platforms = pl;
    const ct = list(o.careTypes, (x) => exports.CARE_TYPES.includes(x), '/careTypes', 3, errors);
    if (ct)
        out.careTypes = ct;
    const la = list(o.languages, (x) => exports.LANGUAGES.includes(x), '/languages', 2, errors);
    if (la)
        out.languages = la;
    const ls = list(o.lifecycleStages, (x) => typeof x === 'string' && stage.test(x), '/lifecycleStages', 20, errors);
    if (ls)
        out.lifecycleStages = ls;
    if (o.patientType !== undefined) {
        if (exports.PATIENT_TYPES.includes(o.patientType))
            out.patientType = o.patientType;
        else
            errors.push('/patientType: ANY, NEW or RETURNING');
    }
    for (const k of ['registrationAgeDaysMax', 'registrationAgeDaysMin'])
        if (o[k] !== undefined) {
            if (Number.isInteger(o[k]) && o[k] >= 0 && o[k] <= 3650)
                out[k] = o[k];
            else
                errors.push(`/${k}: a whole number of days from 0 to 3650`);
        }
    if (out.registrationAgeDaysMin !== undefined && out.registrationAgeDaysMax !== undefined && out.registrationAgeDaysMin > out.registrationAgeDaysMax)
        errors.push('/registrationAgeDaysMin: must not exceed registrationAgeDaysMax');
    return errors.length ? { valid: false, errors } : { valid: true, value: out };
}
const day = 86_400_000;
function isEligible(rule, f, now) {
    if (rule.markets?.length && !rule.markets.includes(f.market))
        return false;
    if (rule.cities?.length && !(f.city && rule.cities.includes(f.city)))
        return false;
    if (rule.districts?.length && !(f.district && rule.districts.includes(f.district)))
        return false;
    if (rule.platforms?.length && !(f.platform && rule.platforms.includes(f.platform)))
        return false;
    if (rule.languages?.length && !(f.language && rule.languages.includes(f.language)))
        return false;
    if (rule.careTypes?.length && !(f.careType && rule.careTypes.includes(f.careType)))
        return false;
    if (rule.lifecycleStages?.length && !(f.lifecycleStage && rule.lifecycleStages.includes(f.lifecycleStage)))
        return false;
    if (rule.patientType === 'NEW' && f.hasBooking === true)
        return false;
    if (rule.patientType === 'RETURNING' && f.hasBooking !== true)
        return false;
    if (rule.registrationAgeDaysMax !== undefined || rule.registrationAgeDaysMin !== undefined) {
        if (!f.registeredAt)
            return false;
        const age = Math.floor((now.getTime() - f.registeredAt.getTime()) / day);
        if (rule.registrationAgeDaysMax !== undefined && age > rule.registrationAgeDaysMax)
            return false;
        if (rule.registrationAgeDaysMin !== undefined && age < rule.registrationAgeDaysMin)
            return false;
    }
    return true;
}
//# sourceMappingURL=campaign-eligibility.js.map