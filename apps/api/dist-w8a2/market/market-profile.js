"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatMoneyMinor = exports.LOCALES = void 0;
exports.isValidTimezone = isValidTimezone;
exports.validateMarketProfile = validateMarketProfile;
exports.normalizeMarketProfile = normalizeMarketProfile;
exports.LOCALES = ['ar', 'en'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const REF = /^[A-Za-z0-9._:/-]{1,120}$/;
const REFLC = /^[a-z0-9/_.-]{1,120}$/;
const ID = /^[a-z0-9_-]{2,32}$/;
const KEYS = ['cc', 'name', 'currency', 'minorUnits', 'phoneCode', 'phoneRegion', 'timezone', 'locales', 'defaultLocale', 'canonicalSegment', 'quietHours', 'workingWeek', 'geographyRef', 'specialtiesRef', 'dataCellId', 'consentDefaultsRef', 'providerImportBatchId', 'regulation'];
const REG_KEYS = ['marketingLicenceRequired', 'marketingLicenceHeld', 'consentRegimeId', 'minimumAge', 'healthAdvertisingRestricted', 'reviewMarkupAllowed', 'dataExportRuleId'];
const BIDI = /[‎‏‪-‮⁦-⁩]/;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
function isValidTimezone(zone) {
    if (typeof zone !== 'string' || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(zone))
        return false;
    try {
        new Intl.DateTimeFormat('en', { timeZone: zone });
        return true;
    }
    catch {
        return false;
    }
}
function validateMarketProfile(payload) {
    const e = [];
    if (!isObj(payload))
        return ['/ must be an object'];
    for (const k of Object.keys(payload))
        if (!KEYS.includes(k))
            e.push(`/${k} is not a known key`);
    const p = payload;
    if (typeof p.cc !== 'string' || !/^[A-Z]{2}$/.test(p.cc))
        e.push('/cc must be two capital letters (ISO 3166-1 alpha-2)');
    if (!isObj(p.name) || typeof p.name.ar !== 'string' || typeof p.name.en !== 'string' || !p.name.ar.trim() || !p.name.en.trim() || p.name.ar.length > 80 || p.name.en.length > 80)
        e.push('/name needs non-empty ar and en names of at most 80 characters');
    else if (BIDI.test(p.name.ar) || BIDI.test(p.name.en))
        e.push('/name must not contain direction override characters');
    if (typeof p.currency !== 'string' || !/^[A-Z]{3}$/.test(p.currency))
        e.push('/currency must be an ISO 4217 code');
    if (!Number.isInteger(p.minorUnits) || p.minorUnits < 0 || p.minorUnits > 4)
        e.push('/minorUnits must be an integer 0 to 4');
    if (typeof p.phoneCode !== 'string' || !/^\+[0-9]{1,4}$/.test(p.phoneCode))
        e.push('/phoneCode must look like +20');
    if (p.phoneRegion !== undefined && (typeof p.phoneRegion !== 'string' || !/^[A-Z]{2}$/.test(p.phoneRegion)))
        e.push('/phoneRegion must be two capital letters');
    if (!isValidTimezone(p.timezone))
        e.push('/timezone must be a valid IANA zone');
    if (!Array.isArray(p.locales) || !p.locales.length || new Set(p.locales).size !== p.locales.length || !p.locales.every((l) => exports.LOCALES.includes(l)))
        e.push('/locales must be a non-empty unique list of ar, en');
    if (!exports.LOCALES.includes(p.defaultLocale) || (Array.isArray(p.locales) && !p.locales.includes(p.defaultLocale)))
        e.push('/defaultLocale must be one of /locales');
    if (typeof p.canonicalSegment !== 'string' || !/^[a-z]{2}$/.test(p.canonicalSegment) || (typeof p.cc === 'string' && p.canonicalSegment !== p.cc.toLowerCase()))
        e.push('/canonicalSegment must be the lowercase market code');
    if (!isObj(p.quietHours) || typeof p.quietHours.start !== 'string' || typeof p.quietHours.end !== 'string' || !HHMM.test(p.quietHours.start) || !HHMM.test(p.quietHours.end) || p.quietHours.start === p.quietHours.end)
        e.push('/quietHours needs distinct HH:MM start and end');
    if (!Array.isArray(p.workingWeek) || !p.workingWeek.length || new Set(p.workingWeek).size !== p.workingWeek.length || !p.workingWeek.every((d) => Number.isInteger(d) && d >= 0 && d <= 6))
        e.push('/workingWeek must be a non-empty unique list of weekdays 0 to 6');
    for (const k of ['geographyRef', 'specialtiesRef', 'dataCellId', 'consentDefaultsRef', 'providerImportBatchId']) {
        const v = p[k];
        if (v !== null && v !== undefined && (typeof v !== 'string' || !(k === 'providerImportBatchId' ? REF : REFLC).test(v)))
            e.push(`/${k} must be a lower-case reference name or null`);
    }
    if (!isObj(p.regulation))
        e.push('/regulation must be an object');
    else {
        const r = p.regulation;
        for (const k of Object.keys(r))
            if (!REG_KEYS.includes(k))
                e.push(`/regulation/${k} is not a known key`);
        for (const k of ['marketingLicenceRequired', 'marketingLicenceHeld', 'healthAdvertisingRestricted', 'reviewMarkupAllowed'])
            if (typeof r[k] !== 'boolean')
                e.push(`/regulation/${k} must be a boolean`);
        if (typeof r.consentRegimeId !== 'string' || !ID.test(r.consentRegimeId))
            e.push('/regulation/consentRegimeId must be a lower-case id (a-z, 0-9, hyphen, underscore, 2 to 32)');
        if (typeof r.dataExportRuleId !== 'string' || !ID.test(r.dataExportRuleId))
            e.push('/regulation/dataExportRuleId must be a reference id');
        if (!Number.isInteger(r.minimumAge) || r.minimumAge < 0 || r.minimumAge > 25)
            e.push('/regulation/minimumAge must be an integer 0 to 25');
        if (r.marketingLicenceHeld === true && r.marketingLicenceRequired !== true)
            e.push('/regulation/marketingLicenceHeld needs marketingLicenceRequired');
    }
    return e;
}
function normalizeMarketProfile(p) {
    const x = p;
    return { ...x, phoneRegion: x.phoneRegion ?? x.cc, geographyRef: x.geographyRef ?? null, specialtiesRef: x.specialtiesRef ?? null, dataCellId: x.dataCellId ?? null, consentDefaultsRef: x.consentDefaultsRef ?? null, providerImportBatchId: x.providerImportBatchId ?? null };
}
const formatMoneyMinor = (minor, profile) => {
    const u = profile.minorUnits;
    const v = (u === 0 ? minor : minor / 10 ** u);
    return `${u === 0 ? String(Math.round(v)) : v.toFixed(u)} ${profile.currency}`;
};
exports.formatMoneyMinor = formatMoneyMinor;
//# sourceMappingURL=market-profile.js.map