import { POLICY_SCHEMAS } from './policy-schemas';
import { schemaDefaults } from './schema-validate';

/**
 * Code defaults of the three kinds that existed as code constants before the sweep (EXPERIMENT_POLICY, AUTOMATION_POLICY, ATTRIBUTION_MODELS). The six newer kinds carry their
 * defaults in their JSON Schema (`default`). Every value equals what shipped; `policy-parity.unit.spec.ts` proves it against the old constants and the schemas.
 */
export const EXPERIMENT_POLICY_DEFAULTS = {
  minRunDays: 7, srmAlpha: 0.001, maxConcurrentPerSurface: 1, maxVariants: 5, kAnonymity: 10, assignmentTtlSeconds: 600, maxRunFactor: 2, guardrailMinEvents: 20, conversionWindowDays: 7, maxCookieExperiments: 3,
} as const;
export const AUTOMATION_POLICY_DEFAULTS = {
  maxNodes: 12, minWaitMinutes: 15, maxWaitMinutes: 90 * 24 * 60, cycleMinWaitMinutes: 24 * 60, maxSendsPerJourney: 3, maxSendsPer30Days: 4, maxCompiledSteps: 24, maxBranchArms: 3,
} as const;
export const ATTRIBUTION_MODELS_DEFAULTS = {
  windows: { webAppDays: 30, campaignDays: 7, providerLinkDays: 30 }, halfLifeDays: 7, positionFirstBp: 4000, positionLastBp: 4000, dataDriven: { minConversions: 1000, minNodeK: 10 },
} as const;

export const POLICY_DEFAULTS: Record<string, Record<string, unknown>> = {
  EXPERIMENT_POLICY: { ...EXPERIMENT_POLICY_DEFAULTS },
  AUTOMATION_POLICY: { ...AUTOMATION_POLICY_DEFAULTS },
  ATTRIBUTION_MODELS: JSON.parse(JSON.stringify(ATTRIBUTION_MODELS_DEFAULTS)),
  RECOMMENDATION_POLICY: schemaDefaults(POLICY_SCHEMAS.RECOMMENDATION_POLICY),
  REWARD_GUARDS: schemaDefaults(POLICY_SCHEMAS.REWARD_GUARDS),
  LIFECYCLE_STAGES: schemaDefaults(POLICY_SCHEMAS.LIFECYCLE_STAGES),
  CROSS_PRODUCT_POLICY: schemaDefaults(POLICY_SCHEMAS.CROSS_PRODUCT_POLICY),
  REFERRAL_FRAUD_THRESHOLDS: schemaDefaults(POLICY_SCHEMAS.REFERRAL_FRAUD_THRESHOLDS),
  INTEGRATION_RUNTIME: schemaDefaults(POLICY_SCHEMAS.INTEGRATION_RUNTIME),
  INTEGRATION_MODES: { modes: {} },
  PAY_FRAUD_THRESHOLDS: schemaDefaults(POLICY_SCHEMAS.PAY_FRAUD_THRESHOLDS),
  PAY_MATCHING_POLICY: schemaDefaults(POLICY_SCHEMAS.PAY_MATCHING_POLICY),
  PAY_ROUTING_POLICY: schemaDefaults(POLICY_SCHEMAS.PAY_ROUTING_POLICY),
};
