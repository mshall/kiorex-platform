import { RECOMMENDATION_POLICY } from '../recommendations/recommendation.types';
import { EXPERIMENT_POLICY } from '../experiments/experiment.types';
import { AUTOMATION_POLICY } from '../automation/journey.graph';
import { DEFAULT_STAGE_THRESHOLDS } from '../lifecycle/lifecycle.stage';
import { ENTRY_META } from '../cross-product/continuity-rules';
import { BREAKER_COOLDOWN_MS, BREAKER_THRESHOLD, breakerCooldownMs, breakerThreshold, maxRunAttempts } from '../integrations/circuit';
import { MAX_ACTIVE_LOTS, RECOVERABLE_LOSS_BLOCK_DAYS, maxActiveLots, recoverableLossBlockDays } from '../rewards/reward-rules';
import { FRAUD_THRESHOLDS } from '../referral/referral-fraud.rules';
import { DEFAULT_WINDOWS } from '../attribution-models/windows';
import { DEFAULT_MODEL_OPTIONS } from '../attribution-models/models';
import { DEFAULT_DATA_DRIVEN } from '../attribution-models/data-driven';
import { modelsConfigNow } from '../attribution-models/model-config';
import { assertSurfaceAllowed } from '../experiments/surfaces';
import { POLICY_DEFAULTS } from './policy-defaults';
import { POLICY_KINDS, clearPolicyOverrides, defaultsOf, policyNow, setPolicyOverride, validatePolicy } from './policy-registry';
import { validateGrowthConfig, LOCAL_CONFIG_KINDS } from '../config/growth-config.service';

beforeEach(() => clearPolicyOverrides());
afterAll(() => clearPolicyOverrides());

describe('policy defaults equal the numbers that shipped in code (behaviour unchanged with no stored version)', () => {
  it('recommendations', () => expect({ ...RECOMMENDATION_POLICY }).toEqual({ k: 10, spendFloorMinor: 50_000, expiryDays: 14, maxPerRun: 10, maxShiftBp: 2000, minRatioBp: 15_000, maxAiSummariesPerDay: 20 }));
  it('experiments', () => expect({ ...EXPERIMENT_POLICY }).toEqual({ minRunDays: 7, srmAlpha: 0.001, maxConcurrentPerSurface: 1, maxVariants: 5, kAnonymity: 10, assignmentTtlSeconds: 600, maxRunFactor: 2, guardrailMinEvents: 20, conversionWindowDays: 7, maxCookieExperiments: 3 }));
  it('automation', () => expect({ ...AUTOMATION_POLICY }).toEqual({ maxNodes: 12, minWaitMinutes: 15, maxWaitMinutes: 129_600, cycleMinWaitMinutes: 1440, maxSendsPerJourney: 3, maxSendsPer30Days: 4, maxCompiledSteps: 24, maxBranchArms: 3 }));
  it('lifecycle stages, rewards guards, breaker, cross-product', () => {
    expect({ ...DEFAULT_STAGE_THRESHOLDS }).toEqual({ dormantDays: 180, churnedDays: 365, retainedAttendedMin: 2, retainedWindowDays: 365 });
    expect([recoverableLossBlockDays(), maxActiveLots()]).toEqual([RECOVERABLE_LOSS_BLOCK_DAYS, MAX_ACTIVE_LOTS]); expect([90, 50]).toEqual([RECOVERABLE_LOSS_BLOCK_DAYS, MAX_ACTIVE_LOTS]);
    expect([breakerThreshold(), breakerCooldownMs(), maxRunAttempts()]).toEqual([BREAKER_THRESHOLD, BREAKER_COOLDOWN_MS, 3]);
    expect(ENTRY_META.RX_TO_PHARMACY).toMatchObject({ ttlDays: 30, lookbackDays: 7 }); expect(ENTRY_META.LAB_ORDER_TO_LAB).toMatchObject({ ttlDays: 30, lookbackDays: 7 }); expect(ENTRY_META.CARE_PLAN_TO_HOME_VISIT).toMatchObject({ ttlDays: 30, lookbackDays: 30 });
  });
  it('referral fraud thresholds', () => {
    expect({ ...FRAUD_THRESHOLDS }).toEqual({ signupsPerIpPrefix24h: 5, minSecondsClaimToSignup: 3, otpFailuresBot: 5, refereesPerReferrerWindow: 6, refereesWithOneProvider: 3, firstBookingsWithinMinutes: 10, firstBookingsClusterSize: 3, paymentFingerprintCluster: 2, neverBookedTwiceShare: 0.8, neverBookedTwiceMinReferees: 5, minVisitMinutes: 5, providerShareOfReferees: 0.6, providerShareMinReferees: 4, cancelledRedemptionsRecent: 3 });
    setPolicyOverride('REFERRAL_FRAUD_THRESHOLDS', { signupsPerIpPrefix24h: 8 }); expect(FRAUD_THRESHOLDS.signupsPerIpPrefix24h).toBe(8);
    expect(setPolicyOverride('REFERRAL_FRAUD_THRESHOLDS', { signupsPerIpPrefix24h: 500 })).toBe(false);
  });
  it('attribution models defaults equal the code constants', () => {
    const d = modelsConfigNow(); expect(d.windows).toEqual(DEFAULT_WINDOWS); expect(d.options).toEqual(DEFAULT_MODEL_OPTIONS); expect(d.dataDriven).toEqual(DEFAULT_DATA_DRIVEN);
  });
  it('every kind has defaults that validate against its own schema', () => { for (const k of POLICY_KINDS) { expect(validatePolicy(k, defaultsOf(k))).toEqual([]); expect(POLICY_DEFAULTS[k]).toBeTruthy(); } });
});

describe('a stored version changes the number live, and a bad one is never half-applied', () => {
  it('applies a valid payload and ignores an invalid one', () => {
    expect(setPolicyOverride('RECOMMENDATION_POLICY', { k: 25, expiryDays: 21 }, 2)).toBe(true);
    expect(RECOMMENDATION_POLICY.k).toBe(25); expect(RECOMMENDATION_POLICY.expiryDays).toBe(21); expect(RECOMMENDATION_POLICY.maxPerRun).toBe(10);
    expect(setPolicyOverride('RECOMMENDATION_POLICY', { k: 5 }, 3)).toBe(false); expect(RECOMMENDATION_POLICY.k).toBe(25);
    setPolicyOverride('RECOMMENDATION_POLICY', null); expect(RECOMMENDATION_POLICY.k).toBe(10);
  });
  it('safety floors hold', () => {
    expect(validatePolicy('RECOMMENDATION_POLICY', { k: 9 }).length).toBeGreaterThan(0);
    expect(validatePolicy('EXPERIMENT_POLICY', { kAnonymity: 9 }).length).toBeGreaterThan(0);
    expect(validatePolicy('REWARD_GUARDS', { recoverableLossBlockDays: 29 }).length).toBeGreaterThan(0);
    expect(validatePolicy('ATTRIBUTION_MODELS', { dataDriven: { minNodeK: 9 } }).length).toBeGreaterThan(0);
    expect(validatePolicy('AUTOMATION_POLICY', { maxSendsPer30Days: 31 }).length).toBeGreaterThan(0);
    expect(validatePolicy('LIFECYCLE_STAGES', { dormantDays: 400 })).toEqual(['/churnedDays must be greater than dormantDays']);
    expect(validatePolicy('ATTRIBUTION_MODELS', { positionFirstBp: 6000, positionLastBp: 5000 }).length).toBeGreaterThan(0);
    expect(validatePolicy('INTEGRATION_MODES', { modes: { SMS: 'sandbox' } }).length).toBeGreaterThan(0);
    expect(validatePolicy('INTEGRATION_MODES', { modes: { SMS: 'real' }, apiKey: 'x' }).length).toBeGreaterThan(0);
  });
  it('live consumers follow: lifecycle, rewards, breaker, cross-product, attribution windows, automation caps', () => {
    setPolicyOverride('LIFECYCLE_STAGES', { dormantDays: 90, churnedDays: 200 }); expect(DEFAULT_STAGE_THRESHOLDS.dormantDays).toBe(90); expect(DEFAULT_STAGE_THRESHOLDS.churnedDays).toBe(200);
    setPolicyOverride('REWARD_GUARDS', { recoverableLossBlockDays: 120, maxActiveLots: 20 }); expect([recoverableLossBlockDays(), maxActiveLots()]).toEqual([120, 20]);
    setPolicyOverride('INTEGRATION_RUNTIME', { breakerThreshold: 3, breakerCooldownMinutes: 10, maxAttempts: 2 }); expect([breakerThreshold(), breakerCooldownMs(), maxRunAttempts()]).toEqual([3, 600_000, 2]);
    setPolicyOverride('CROSS_PRODUCT_POLICY', { rxToPharmacy: { lookbackDays: 14 } }); expect(ENTRY_META.RX_TO_PHARMACY.lookbackDays).toBe(14); expect(ENTRY_META.RX_TO_PHARMACY.ttlDays).toBe(30);
    setPolicyOverride('ATTRIBUTION_MODELS', { windows: { campaignDays: 14 }, halfLifeDays: 10 }); expect(modelsConfigNow().windows).toEqual({ webAppDays: 30, campaignDays: 14, providerLinkDays: 30 }); expect(modelsConfigNow().options.halfLifeDays).toBe(10);
    setPolicyOverride('AUTOMATION_POLICY', { maxSendsPerJourney: 2 }); expect(AUTOMATION_POLICY.maxSendsPerJourney).toBe(2); expect(AUTOMATION_POLICY.maxSendsPer30Days).toBe(4);
  });
  it('the experiment deny list can only grow: a stored list never removes a built-in tag', () => {
    setPolicyOverride('EXPERIMENT_POLICY', { deniedTags: ['promo-banner'] });
    expect(() => assertSurfaceAllowed('landing.home.hero_copy', ['emergency'])).toThrow();
    expect(() => assertSurfaceAllowed('landing.home.hero_copy', ['promo-banner'])).toThrow();
  });
});

describe('local maker-checker kinds', () => {
  it('every policy kind is accepted by the console and validated by validateGrowthConfig', () => {
    for (const k of POLICY_KINDS) { expect(LOCAL_CONFIG_KINDS).toContain(k); expect(validateGrowthConfig(k, {}).valid).toBe(true); }
    expect(validateGrowthConfig('RECOMMENDATION_POLICY', { k: 3 }).valid).toBe(false);
    expect(validateGrowthConfig('REWARD_GUARDS', { maxActiveLots: 80 }).valid).toBe(true);
  });
});
