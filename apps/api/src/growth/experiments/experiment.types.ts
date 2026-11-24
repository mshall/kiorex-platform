/** GRW-P3-A shared types and the pure policy defaults. No I/O. */

export const EXPERIMENT_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'RUNNING', 'STOPPED', 'CONCLUDED', 'ARCHIVED'] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];
export type ExperimentMode = 'FIXED' | 'SEQUENTIAL';
export type UnitKind = 'VISITOR' | 'SUB';
export interface VariantSpec { key: string; weightBp: number }
export interface Eligibility { markets?: string[]; locales?: ('ar' | 'en')[]; platforms?: ('web' | 'ios' | 'android')[]; stage?: 'new' | 'returning' }
export interface GuardrailSpec { metric: string; /** absolute non-inferiority margin in rate points (0.005 = half a percentage point) */ marginAbs: number }

/**
 * EXPERIMENT_POLICY. Proposed defaults in code until contracts gains the config kind (listed in the W7 as-built "next contracts version" needs); every value is a default, not a decision.
 * `minRunDays` covers weekday cycles; `srmAlpha` is the p-value under which results are hidden.
 */
export const EXPERIMENT_POLICY = {
  minRunDays: 7,
  srmAlpha: 0.001,
  maxConcurrentPerSurface: 1,
  maxVariants: 5,
  kAnonymity: 10,
  assignmentTtlSeconds: 600,
  /** an experiment still short of its sample at 2 x plannedDays is stopped (INSUFFICIENT_SAMPLE) */
  maxRunFactor: 2,
  /** guardrails need this many events in the treatment arm before a breach can be declared */
  guardrailMinEvents: 20,
  /** conversions are attributed within this many days after the exposure */
  conversionWindowDays: 7,
  maxCookieExperiments: 3,
} as const;

/** The metric registry: primary metrics and guardrails are first-party funnel facts only (GrowthEvent names). `harmful` = a higher rate is worse. */
export interface MetricSpec { key: string; event: string; harmful: boolean; kind: 'PRIMARY' | 'GUARDRAIL' | 'BOTH'; /** facts keyed by booking resolve to a SUB unit through BookingIntent */ unit: 'VISITOR' | 'BOOKING' }
export const METRICS: readonly MetricSpec[] = [
  { key: 'booking_started', event: 'BookingInitiated', harmful: false, kind: 'PRIMARY', unit: 'VISITOR' },
  { key: 'booking_confirmed', event: 'BookingConfirmed', harmful: false, kind: 'PRIMARY', unit: 'BOOKING' },
  { key: 'booking_attended', event: 'BookingAttended', harmful: false, kind: 'PRIMARY', unit: 'BOOKING' },
  { key: 'signup_completed', event: 'PatientRegistered', harmful: false, kind: 'PRIMARY', unit: 'VISITOR' },
  { key: 'referral_invite', event: 'ReferralInviteShared', harmful: false, kind: 'PRIMARY', unit: 'VISITOR' },
  { key: 'message_opt_out', event: 'MessageOptOut', harmful: true, kind: 'GUARDRAIL', unit: 'VISITOR' },
  { key: 'complaint', event: 'ComplaintFiled', harmful: true, kind: 'GUARDRAIL', unit: 'VISITOR' },
  { key: 'page_error', event: 'PageError', harmful: true, kind: 'GUARDRAIL', unit: 'VISITOR' },
  { key: 'page_slow', event: 'PageSlow', harmful: true, kind: 'GUARDRAIL', unit: 'VISITOR' },
  { key: 'cancellation', event: 'BookingCancelled', harmful: true, kind: 'GUARDRAIL', unit: 'BOOKING' },
];
export const metricByKey = (k: string) => METRICS.find((m) => m.key === k);

export type Verdict = 'COLLECTING' | 'SRM_DETECTED' | 'GUARDRAIL_BREACH' | 'NO_WINNER' | 'WINNER' | 'INCONCLUSIVE';
