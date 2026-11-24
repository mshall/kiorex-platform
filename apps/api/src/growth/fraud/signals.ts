import type { FraudFacts } from '../referral/referral-fraud.rules';

/**
 * Fraud detection v2 (GRW-P3-D): shared types. Rules are PURE (facts in, a strength and a reason out); the scorer turns them into one score and a band;
 * the service decides an action per surface. Everything here works on hashes and counts: no identifier, no PHI, no health data ever enters a feature.
 */
export const FRAUD_RULE_IDS = ['r_self', 'r_dup', 'r_bot', 'r_farm', 'r_fakebooking', 'r_collusion', 'r_cancel', 'r_redeem', 'r_touch_burst', 'r_widget_abuse', 'r_lt_replay'] as const;
export type FraudRuleId = (typeof FRAUD_RULE_IDS)[number];

export const FRAUD_CASE_KINDS = ['REFERRAL', 'REWARD', 'TOUCH', 'WIDGET', 'PROVIDER'] as const;
export type FraudCaseKind = (typeof FRAUD_CASE_KINDS)[number];

export const FRAUD_SURFACES = ['REFERRAL_CLAIM', 'REWARD', 'REFERRAL_ELIGIBILITY', 'WIDGET', 'TOUCH', 'PROVIDER_REVIEW'] as const;
export type FraudSurface = (typeof FRAUD_SURFACES)[number];

export const FRAUD_BANDS = ['ALLOW', 'REVIEW', 'HOLD'] as const;
export type FraudBand = (typeof FRAUD_BANDS)[number];

export const CASE_STATUSES = ['OPEN', 'IN_REVIEW', 'CONFIRMED', 'DISMISSED', 'APPEALED', 'CLOSED'] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

/**
 * What the engine may DO. This list is closed on purpose: there is no action that changes an attribution decision, a commission, a booking or a provider's standing.
 * A provider-side finding becomes a case that only ops can act on through the existing moderation (disputes stay in the Clinic dispute workflow).
 */
export const FRAUD_ACTIONS = ['NONE', 'OPEN_CASE', 'REJECT_CLAIM', 'HOLD_REWARD', 'SUSPEND_REFERRAL', 'THROTTLE_ORIGIN', 'QUARANTINE_TOUCH', 'OPEN_PROVIDER_REVIEW'] as const;
export type FraudAction = (typeof FRAUD_ACTIONS)[number];

/** Features: the P2-B1 referral facts plus the touch, widget and link-token facts of this package. Hashes and counts only. */
export interface FraudFeatures extends FraudFacts {
  /** legit-family guards */
  householdDeclared?: boolean;
  bookedOnBehalfByStaff?: boolean;
  /** touch */
  touchBurstPerMinute?: number;
  touchBurstLimit?: number;
  clickWithoutRender?: boolean;
  /** widget */
  widgetOriginMismatches?: number;
  widgetDistinctOriginsPerKey1h?: number;
  widgetRequestsPerOrigin5m?: number;
  widgetTokenReplays?: number;
  /** lt (link token) */
  ltSignatureInvalid?: boolean;
  ltUseCount?: number;
  ltDistinctSubjects?: number;
  ltUsedAfterExpiry?: boolean;
}

export interface RuleOutput { strength: number; reason: string; /** names of check rows the evidence viewer shows (never raw values) */ evidence: string[] }
export interface FraudRuleDef {
  id: FraudRuleId;
  kind: FraudCaseKind;
  surfaces: readonly FraudSurface[];
  evaluate(f: FraudFeatures, t: FraudThresholds): RuleOutput | null;
}

export interface FraudThresholds {
  touchBurstPerMinute: number;
  widgetOriginMismatches: number;
  widgetDistinctOriginsPerKey1h: number;
  widgetRequestsPerOrigin5m: number;
  widgetTokenReplays: number;
  ltUseCountLimit: number;
  ltDistinctSubjectsLimit: number;
}

export interface FiredSignal { ruleId: FraudRuleId; kind: FraudCaseKind; strength: number; reason: string; evidence: string[] }
export const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
