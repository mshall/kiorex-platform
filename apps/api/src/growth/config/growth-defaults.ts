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
  // ── contracts 1.12.0 (GRW-P2-X1): every value PROPOSED_DEFAULT. Phase 2 defaults mirror the vectors of kiorex-contracts test/growth-1.12.test.ts.
  CAMPAIGN_POLICY: {
    approvalAboveMinor: 2_000_000, budgetIncreaseApprovalPercent: 20, monthlyCeilingMinor: 50_000_000, dailyDefaultCapMinor: 1_000_000, budgetAlertThresholdsBp: [5000, 8000, 10000],
    allowedChannels: ['ORGANIC_SEARCH', 'EMAIL', 'SMS', 'WHATSAPP', 'PUSH', 'IN_APP', 'PARTNER', 'PAID_SEARCH', 'PAID_SOCIAL', 'PAID_VIDEO', 'OFFLINE', 'REFERRAL'], sensitiveChannels: ['WHATSAPP', 'SMS'],
    utmNaming: { maxTokenLength: 40, campaignPrefixMarket: true }, creativeRules: { maxCreatives: 30, allowedHttpsHosts: ['cdn.kiorex.com'], assetKeyPrefix: 'growth/creatives/' }, autoExpiryGraceHours: 0, requireReasonOnPause: true,
  },
  REFERRAL_RULES: {
    enabled: true, qualification: { requireAttended: true, holdDays: 7, requirePhoneVerified: true, lookbackDays: 30 }, caps: { perReferrer30Days: 5, perReferrerYear: 20 },
    repeatBonus: { count: 0, windowDays: 90 }, eligibleCareTypes: ['IN_CLINIC', 'VIDEO', 'HOME_VISIT'], signals: { deviceSignal: false, paymentFingerprint: true },
  },
  // all amounts 0 until KX-12 pricing sets a deposit or a Kiorex fee (AD-4); COUPON is the lower-exposure mode (AD-2)
  REWARD_RULES: {
    mode: 'COUPON', currency: 'EGP', amounts: { referrerMinor: 0, refereeMinor: 0, repeatMinor: 0, promoMinor: 0 }, expiryMonths: 12, perUserAnnualCapMinor: 0, perCampaignCapMinor: 0, ruleBudgetCeilingMinor: 0,
    redemptionMaxBp: 10_000, minPayableMinor: 0, postToPayLedger: false, reversalWindowDays: 30, holdMaxDays: 14, manualApprovalAboveMinor: 20_000, manualDailyCapPerActorMinor: 50_000, issueOn: ['COMPLETED_VISIT'],
    // Rev 2.6 patient credit block: every switch OFF (the launch-locked flags growth.patient_credit, growth.refund_as_credit and growth.family_credit gate it too); amounts are placeholders for counsel and the founder (H-23, H-27)
    credit: {
      maxOpenBalanceMinor: 200_000,
      refundAsCredit: { enabled: false, refundCreditExpiryMonths: 12, refundCreditOnExpiry: 'REFUND_TO_ORIGINAL', restoredLotMinDays: 90 }, family: { enabled: false },
      goodwill: { reasons: ['PROVIDER_LATE_CANCEL', 'LONG_WAIT', 'FAILED_BOOKING', 'PAYMENT_ISSUE', 'OTHER_APPROVED'], perAgentDailyCapMinor: 50_000, perPatient90dCapMinor: 20_000, perReasonMaxMinor: 10_000, approvalAboveMinor: 5_000 },
      campaignScope: { serviceKinds: ['IN_CLINIC', 'VIDEO', 'HOME_VISIT'], specialtyAllowlist: [] },
    },
  },
  SPONSORED_PROMOTION_POLICY: {
    commissionBasis: 'GROSS_BEFORE_SPONSORED', highValueBudgetMinor: 5_000_000, highValuePerBookingMinor: 50_000, maxDiscountBp: 3000, allowedCareTypes: ['IN_CLINIC', 'VIDEO', 'HOME_VISIT'],
    defaultFundingMode: 'WALLET_THEN_INVOICE', postToPayLedger: false, reservationTtlGraceMinutes: 15, reviewRequired: true,
  },
  LIFECYCLE_POLICY: {
    messageClasses: ['TRANSACTIONAL', 'SECURITY', 'CLINICAL', 'MARKETING'], frequencyCaps: { marketingPerDay: 1, marketingPerWeek: 3 }, quietHours: { start: '21:00', end: '09:00', timezone: 'Africa/Cairo' },
    journeys: { welcome: { enabled: true, messageClass: 'TRANSACTIONAL', maxSteps: 3 } }, segments: { new_users: { attributes: ['stage', 'platform', 'language'] } }, holdoutBps: 0,
  },
  ASSISTANT_POLICY: {
    languages: ['ar', 'en'], toolsByState: { SEARCH: ['search_providers', 'get_slots', 'get_next_available', 'handoff_to_human'], CONFIRM: ['prepare_confirmation', 'confirm_booking', 'handoff_to_human'] },
    budgets: { tokensPerTurn: 1500, tokensPerConversation: 8000, turnsPerConversation: 40, tokensPerSubjectDay: 30_000, costPerMarketDayMinor: 200_000 },
    rateLimits: { messagesPerNumberPerHour: 30, globalConcurrency: 50 }, retentionDays: 30, escalationSlaMinutes: 30, model: { mode: 'mock', providerLabel: 'mock' },
  },
  INTEGRATION: {
    integrations: Object.fromEntries(['googleads', 'searchconsole', 'ga4', 'playconsole', 'appstoreconnect', 'metaads', 'tiktok', 'whatsappcloud', 'fcmapns', 'crux'].map((k) => [k, { mode: 'mock', secretRef: null, accountLabel: '', pullSchedule: 'daily', rateBudgetPerHour: 60, retentionDays: 395 }])),
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
