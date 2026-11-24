import type { GrowthConfigKind } from '@kiorex/contracts';

/**
 * PROPOSED_DEFAULT payloads for the growth configuration kinds (GROWTH_ARCHITECTURE_DECISIONS section 6.3 and 16, work-packages file section 7:
 * the CEO still has to ratify precedence and windows). They are the fallback when no ACTIVE GrowthConfigVersion exists for a kind, never a
 * replacement for the versioned, maker-checker rows. Each payload validates against its JSON Schema in @kiorex/contracts (unit test).
 * No secret and no country-specific branch: market facts live in MARKET_GROWTH payloads.
 */
export const PROPOSED_DEFAULT_MARKER = 'PROPOSED_DEFAULT';

export const GROWTH_DEFAULT_PAYLOADS: Partial<Record<GrowthConfigKind, Record<string, unknown>>> = {
  ATTRIBUTION_POLICY: {
    providerTouchWindowDays: 30,
    patientReferralWindowDays: 30,
    campaignClickWindowDays: 7,
    campaignViewWindowHours: 0,
    visitorKeyMaxDays: 180,
    newPatientLookbackMonths: 24,
    touchEvidenceRetentionMonths: 25,
    unlinkedTouchRetentionMonths: 13,
    minDwellMsForProviderTouch: 1000,
    ltTokenTtlMinutes: 30,
    precedence: 'PROVIDER_FIRST',
    allowOfflineEvidence: false,
  },
  SEO: {
    canonicalHost: 'https://kiorex.com',
    locales: ['ar', 'en'],
    defaultLocale: 'ar',
    minLiveProviders: 3,
    minUniqueBlocks: 3,
    maxSiblingSimilarityPercent: 70,
    sitemapShardSize: 10000,
    edgeCacheSeconds: 300,
    staleWhileRevalidateSeconds: 3600,
    delistedGoneAfterDays: 30,
    reviewMarkupEnabled: true,
    districtPagesEnabled: true,
  },
  WIDGET_POLICY: {
    maxOriginsPerOrg: 10,
    allowLocalhostOrigins: false,
    sessionTokenTtlSeconds: 900,
    maxActiveHoldsPerPhone: 3,
    maxActiveHoldsPerIpHash: 5,
    embedHost: 'https://book.kiorex.com',
    sdkCacheSeconds: 31536000,
  },
  CONSENT_DEFAULTS: {
    regimeId: 'pdpl-eg-v0',
    quietHoursStart: '21:00',
    quietHoursEnd: '09:00',
    quietHoursTimezone: 'Africa/Cairo',
    maxMarketingPerDay: 1,
    maxMarketingPerWeek: 3,
    withdrawalPropagationSeconds: 60,
    bannerEqualWeight: true,
    textVersionIds: { analytics: 'TODO_NEEDS_HUMAN_v0', marketing: 'TODO_NEEDS_HUMAN_v0' },
  },
  MARKET_GROWTH: {
    market: 'EG',
    currency: 'EGP',
    phoneCode: '+20',
    locales: ['ar', 'en'],
    canonicalSegment: 'eg',
    bookingLinkBaseUrl: 'https://kiorly.link',
    qrEnabled: true,
    marketingLicenceConfirmed: false,
    integrations: {},
    whatsappPhoneNumberIdRef: null,
    dataCell: 'frankfurt',
  },
};

/** Retention parameters the retention job passes to growth_purge_expired (taken from ATTRIBUTION_POLICY at run time). */
export const DEFAULT_RETENTION = { linkedMonths: 25, unlinkedMonths: 13 } as const;
