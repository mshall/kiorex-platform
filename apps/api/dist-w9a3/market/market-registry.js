"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.knownProfileCodes = exports.marketMinorUnits = exports.marketCurrency = exports.marketQuietHours = exports.marketTimezone = exports.marketFacts = exports.marketProfileSnapshot = exports.UNKNOWN_MARKET_ZONE = exports.DEFAULT_MARKET = exports.MARKET_FACTS = exports.CODE_PROFILES = void 0;
exports.setMarketProfileSnapshot = setMarketProfileSnapshot;
exports.marketProfile = marketProfile;
const market_profile_1 = require("./market-profile");
const REG = { marketingLicenceRequired: true, marketingLicenceHeld: false, consentRegimeId: 'pending-counsel', minimumAge: 18, healthAdvertisingRestricted: true, reviewMarkupAllowed: true, dataExportRuleId: 'pending-counsel' };
const code = (cc, ar, en, currency, phoneCode, timezone, workingWeek) => (0, market_profile_1.normalizeMarketProfile)({
    cc, name: { ar, en }, currency, minorUnits: 2, phoneCode, phoneRegion: cc, timezone, locales: ['ar', 'en'], defaultLocale: 'ar', canonicalSegment: cc.toLowerCase(), quietHours: { start: '21:00', end: '09:00' }, workingWeek,
    geographyRef: null, specialtiesRef: null, dataCellId: null, consentDefaultsRef: null, providerImportBatchId: null, regulation: { ...REG },
});
exports.CODE_PROFILES = {
    EG: code('EG', 'مصر', 'Egypt', 'EGP', '+20', 'Africa/Cairo', [0, 1, 2, 3, 4, 6]),
    SA: code('SA', 'السعودية', 'Saudi Arabia', 'SAR', '+966', 'Asia/Riyadh', [0, 1, 2, 3, 4]),
    AE: code('AE', 'الإمارات', 'United Arab Emirates', 'AED', '+971', 'Asia/Dubai', [1, 2, 3, 4, 5]),
};
exports.MARKET_FACTS = Object.fromEntries(Object.values(exports.CODE_PROFILES).map((p) => [p.cc, { currency: p.currency, phoneCode: p.phoneCode, name: p.name }]));
const envDefault = (process.env.DEFAULT_MARKET ?? '').trim().toUpperCase();
exports.DEFAULT_MARKET = /^[A-Z]{2}$/.test(envDefault) ? envDefault : exports.CODE_PROFILES.EG.cc;
exports.UNKNOWN_MARKET_ZONE = 'UTC';
let snapshot = new Map();
function setMarketProfileSnapshot(list) { snapshot = new Map(list.map((p) => [p.cc, p])); }
const marketProfileSnapshot = () => [...snapshot.values()];
exports.marketProfileSnapshot = marketProfileSnapshot;
function marketProfile(cc) { const k = String(cc ?? '').toUpperCase(); return snapshot.get(k) ?? exports.CODE_PROFILES[k]; }
const marketFacts = (cc) => {
    const p = marketProfile(cc);
    return p ? { currency: p.currency, phoneCode: p.phoneCode, name: p.name } : { currency: '', phoneCode: '', name: { ar: String(cc).toUpperCase(), en: String(cc).toUpperCase() } };
};
exports.marketFacts = marketFacts;
const marketTimezone = (cc) => marketProfile(cc)?.timezone ?? exports.UNKNOWN_MARKET_ZONE;
exports.marketTimezone = marketTimezone;
const marketQuietHours = (cc) => { const p = marketProfile(cc) ?? exports.CODE_PROFILES[exports.DEFAULT_MARKET] ?? exports.CODE_PROFILES.EG; return { ...p.quietHours, timezone: p.timezone }; };
exports.marketQuietHours = marketQuietHours;
const marketCurrency = (cc) => marketProfile(cc)?.currency ?? '';
exports.marketCurrency = marketCurrency;
const marketMinorUnits = (cc) => marketProfile(cc)?.minorUnits ?? 2;
exports.marketMinorUnits = marketMinorUnits;
const knownProfileCodes = () => [...new Set([...snapshot.keys(), ...Object.keys(exports.CODE_PROFILES)])].sort();
exports.knownProfileCodes = knownProfileCodes;
//# sourceMappingURL=market-registry.js.map