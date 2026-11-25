"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildBundle = buildBundle;
const growth_defaults_1 = require("../config/growth-defaults");
const market_core_public_1 = require("../../market/market-core-public");
function buildBundle(cc, steps, o = {}) {
    const id = steps.identity ?? {};
    const reg = (steps.regulation ?? {});
    const consent = (steps.consent ?? {});
    const q = (id.quietHours ?? { start: '21:00', end: '09:00' });
    const lower = cc.toLowerCase();
    const profile = (0, market_core_public_1.normalizeMarketProfile)({
        cc, name: id.name, currency: id.currency, minorUnits: id.minorUnits, phoneCode: id.phoneCode, phoneRegion: id.phoneRegion ?? cc, timezone: id.timezone, locales: id.locales, defaultLocale: id.defaultLocale,
        canonicalSegment: lower, quietHours: { start: q.start, end: q.end }, workingWeek: id.workingWeek,
        geographyRef: o.geographyRef ?? (steps.geography?.count ? `market-geography/${lower}` : null),
        specialtiesRef: steps.specialties ? `market-specialties/${lower}` : null, dataCellId: steps.residency?.dataCellId ?? null,
        consentDefaultsRef: steps.consent ? `consent-defaults/${lower}` : null, providerImportBatchId: steps.providers?.importBatchId ?? null,
        regulation: { marketingLicenceRequired: reg.marketingLicenceRequired, marketingLicenceHeld: reg.marketingLicenceHeld, consentRegimeId: reg.consentRegimeId, minimumAge: reg.minimumAge, healthAdvertisingRestricted: reg.healthAdvertisingRestricted, reviewMarkupAllowed: reg.reviewMarkupAllowed, dataExportRuleId: reg.dataExportRuleId },
    });
    const baseGrowth = growth_defaults_1.GROWTH_DEFAULT_PAYLOADS.MARKET_GROWTH;
    const baseConsent = growth_defaults_1.GROWTH_DEFAULT_PAYLOADS.CONSENT_DEFAULTS;
    const growth = {
        market: cc, currency: profile.currency, phoneCode: profile.phoneCode, locales: profile.locales, canonicalSegment: lower, bookingLinkBaseUrl: o.bookingLinkBaseUrl ?? baseGrowth.bookingLinkBaseUrl,
        qrEnabled: true, marketingLicenceConfirmed: profile.regulation.marketingLicenceHeld, whatsappPhoneNumberIdRef: steps.integrations?.whatsappPhoneNumberIdRef ?? null, integrations: {},
        ...(profile.geographyRef ? { geographyListRef: profile.geographyRef } : {}), ...(profile.dataCellId ? { dataCell: profile.dataCellId } : {}),
    };
    const consentPayload = {
        regimeId: profile.regulation.consentRegimeId, quietHoursStart: q.start, quietHoursEnd: q.end, quietHoursTimezone: profile.timezone,
        maxMarketingPerDay: consent.maxMarketingPerDay ?? baseConsent.maxMarketingPerDay, maxMarketingPerWeek: consent.maxMarketingPerWeek ?? baseConsent.maxMarketingPerWeek,
        withdrawalPropagationSeconds: baseConsent.withdrawalPropagationSeconds, bannerEqualWeight: true,
        textVersionIds: consent.textVersionIds ?? baseConsent.textVersionIds,
    };
    return { MARKET_PROFILE: profile, MARKET_GROWTH: growth, CONSENT_DEFAULTS: consentPayload };
}
//# sourceMappingURL=config-bundle.js.map