import { GROWTH_DEFAULT_PAYLOADS } from '../config/growth-defaults';
import { normalizeMarketProfile, type MarketProfile } from '../../market/market-core-public';

/**
 * The configuration bundle of a market (GRW-P3-G): the three config versions the wizard drafts from the plan. PURE. Every payload validates against its schema (the contract JSON
 * Schema for MARKET_GROWTH and CONSENT_DEFAULTS, the local validator for MARKET_PROFILE); the unit test runs all three. Nothing here is a launch decision.
 */
export type Steps = Partial<Record<string, Record<string, unknown>>>;
export interface Bundle { MARKET_PROFILE: Record<string, unknown>; MARKET_GROWTH: Record<string, unknown>; CONSENT_DEFAULTS: Record<string, unknown> }

export function buildBundle(cc: string, steps: Steps, o: { geographyRef?: string | null; bookingLinkBaseUrl?: string } = {}): Bundle {
  const id = steps.identity ?? {}; const reg = (steps.regulation ?? {}) as Record<string, unknown>; const consent = (steps.consent ?? {}) as Record<string, unknown>;
  const q = (id.quietHours ?? { start: '21:00', end: '09:00' }) as { start: string; end: string };
  const lower = cc.toLowerCase();
  const profile: MarketProfile = normalizeMarketProfile({
    cc, name: id.name, currency: id.currency, minorUnits: id.minorUnits, phoneCode: id.phoneCode, phoneRegion: id.phoneRegion ?? cc, timezone: id.timezone, locales: id.locales, defaultLocale: id.defaultLocale,
    canonicalSegment: lower, quietHours: { start: q.start, end: q.end }, workingWeek: id.workingWeek,
    geographyRef: o.geographyRef ?? ((steps.geography?.count as number | undefined) ? `market-geography/${lower}` : null),
    specialtiesRef: steps.specialties ? `market-specialties/${lower}` : null, dataCellId: (steps.residency?.dataCellId as string | undefined) ?? null,
    consentDefaultsRef: steps.consent ? `consent-defaults/${lower}` : null, providerImportBatchId: (steps.providers?.importBatchId as string | undefined) ?? null,
    regulation: { marketingLicenceRequired: reg.marketingLicenceRequired, marketingLicenceHeld: reg.marketingLicenceHeld, consentRegimeId: reg.consentRegimeId, minimumAge: reg.minimumAge, healthAdvertisingRestricted: reg.healthAdvertisingRestricted, reviewMarkupAllowed: reg.reviewMarkupAllowed, dataExportRuleId: reg.dataExportRuleId },
  });
  const baseGrowth = GROWTH_DEFAULT_PAYLOADS.MARKET_GROWTH as Record<string, unknown>; const baseConsent = GROWTH_DEFAULT_PAYLOADS.CONSENT_DEFAULTS as Record<string, unknown>;
  const growth: Record<string, unknown> = {
    market: cc, currency: profile.currency, phoneCode: profile.phoneCode, locales: profile.locales, canonicalSegment: lower, bookingLinkBaseUrl: o.bookingLinkBaseUrl ?? baseGrowth.bookingLinkBaseUrl,
    qrEnabled: true, marketingLicenceConfirmed: profile.regulation.marketingLicenceHeld, whatsappPhoneNumberIdRef: (steps.integrations?.whatsappPhoneNumberIdRef as string | null | undefined) ?? null, integrations: {},
    ...(profile.geographyRef ? { geographyListRef: profile.geographyRef } : {}), ...(profile.dataCellId ? { dataCell: profile.dataCellId } : {}),
  };
  const consentPayload: Record<string, unknown> = {
    regimeId: profile.regulation.consentRegimeId, quietHoursStart: q.start, quietHoursEnd: q.end, quietHoursTimezone: profile.timezone,
    maxMarketingPerDay: consent.maxMarketingPerDay ?? baseConsent.maxMarketingPerDay, maxMarketingPerWeek: consent.maxMarketingPerWeek ?? baseConsent.maxMarketingPerWeek,
    withdrawalPropagationSeconds: baseConsent.withdrawalPropagationSeconds, bannerEqualWeight: true,
    textVersionIds: consent.textVersionIds ?? baseConsent.textVersionIds,
  };
  return { MARKET_PROFILE: profile as unknown as Record<string, unknown>, MARKET_GROWTH: growth, CONSENT_DEFAULTS: consentPayload };
}
