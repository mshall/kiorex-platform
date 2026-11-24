import type { RewardRules } from '../rewards/reward-rules';

/**
 * Referral qualification (GRW-P2-B1): a pure function of facts, so every boundary is a unit test. The service gathers the facts from the tables; nothing here reads a clock but `now`.
 * A check that cannot be evaluated yet is PENDING, never a pass. Any hard failure rejects (reject beats pending); all passes qualify. The result never touches attribution or commission.
 */
export interface ReferralRulesView {
  enabled: boolean;
  qualification: { requireAttended: boolean; holdDays: number; requirePhoneVerified: boolean; lookbackDays: number };
  caps: { perReferrer30Days: number; perReferrerYear: number };
  repeatBonus: { count: number; windowDays: number };
  eligibleCareTypes: string[];
  signals: { deviceSignal: boolean; paymentFingerprint: boolean };
}

export type CheckState = 'PASS' | 'FAIL' | 'PENDING';
export interface QualCheck { key: string; state: CheckState; reason?: string; detail?: Record<string, string | number | boolean | null> }
export interface QualFacts {
  now: Date;
  relationship: { createdAt: Date; status: string; reviewState: string };
  referee: { phoneVerified: boolean; existingPatientBeforeClaim: boolean; phoneSeenOnOtherAccount: boolean };
  booking: { status: string; careType: string; completedAt: Date | null; refundedOrDisputed: boolean; providerLedByReferrerLink: boolean; firstBookingAt: Date | null } | null;
  referrer: { suspended: boolean; accountAgeDays: number; completedBookings: number; qualified30d: number; qualifiedYear: number };
  campaignCapReached: boolean;
  budgetExhausted: boolean;
  /** Result of the fraud rules at qualification: ALLOW, HOLD (wait for a reviewer) or REJECT. Shadow mode passes ALLOW. */
  fraudAction: 'ALLOW' | 'HOLD' | 'REJECT';
}
export interface QualResult { result: 'QUALIFIED' | 'PENDING' | 'REJECTED'; reason?: string; qualifyAfter?: Date; checks: QualCheck[] }

export const MIN_REFERRER_AGE_DAYS = 7;
const DAY = 86_400_000;

export function qualify(f: QualFacts, rules: ReferralRulesView): QualResult {
  const checks: QualCheck[] = [];
  const add = (key: string, state: CheckState, reason?: string, detail?: QualCheck['detail']) => checks.push({ key, state, ...(reason ? { reason } : {}), ...(detail ? { detail } : {}) });
  const q = rules.qualification;

  add('RULES_ENABLED', rules.enabled ? 'PASS' : 'FAIL', 'RULES_DISABLED');
  add('CODE_ACTIVE', f.referrer.suspended ? 'FAIL' : 'PASS', 'CODE_SUSPENDED');
  const windowEnd = f.relationship.createdAt.getTime() + q.lookbackDays * DAY;
  const bookedAt = f.booking?.firstBookingAt?.getTime();
  const inWindow = bookedAt !== undefined ? bookedAt <= windowEnd : f.now.getTime() <= windowEnd;
  add('WITHIN_CLAIM_WINDOW', inWindow ? 'PASS' : 'FAIL', 'EXPIRED', { lookbackDays: q.lookbackDays });
  add('REFEREE_NEW_PATIENT', f.referee.existingPatientBeforeClaim ? 'FAIL' : 'PASS', 'ALREADY_PATIENT');
  add('REFEREE_IDENTITY_UNIQUE', f.referee.phoneSeenOnOtherAccount ? 'FAIL' : 'PASS', 'DUPLICATE_IDENTITY');
  add('REFEREE_PHONE_VERIFIED', !q.requirePhoneVerified || f.referee.phoneVerified ? 'PASS' : 'FAIL', 'PHONE_NOT_VERIFIED');
  const refAgeOk = f.referrer.accountAgeDays >= MIN_REFERRER_AGE_DAYS && f.referrer.completedBookings >= 1;
  add('REFERRER_EARNED', refAgeOk ? 'PASS' : 'PENDING', undefined, { ageDays: f.referrer.accountAgeDays, completed: f.referrer.completedBookings });
  add('CARE_TYPE_ELIGIBLE', !f.booking ? 'PENDING' : rules.eligibleCareTypes.includes(f.booking.careType) ? 'PASS' : 'FAIL', 'CARE_TYPE_NOT_ELIGIBLE');

  // attendance: only a COMPLETED visit counts; a NO_SHOW never does
  if (!f.booking) add('BOOKING_COMPLETED', 'PENDING');
  else if (f.booking.status === 'COMPLETED' || (!q.requireAttended && f.booking.status === 'CONFIRMED')) add('BOOKING_COMPLETED', 'PASS');
  else if (['NO_SHOW', 'CANCELLED', 'EXPIRED'].includes(f.booking.status)) add('BOOKING_COMPLETED', 'FAIL', 'NOT_ATTENDED', { status: f.booking.status });
  else add('BOOKING_COMPLETED', 'PENDING', undefined, { status: f.booking.status });

  add('NOT_REFUNDED', !f.booking ? 'PENDING' : f.booking.refundedOrDisputed ? 'FAIL' : 'PASS', 'REFUNDED_OR_DISPUTED');
  add('NOT_PROVIDER_LED', !f.booking ? 'PENDING' : f.booking.providerLedByReferrerLink ? 'FAIL' : 'PASS', 'PROVIDER_LED_BOOKING');

  // hold period after completion (cancellation, refund and fraud window)
  if (!f.booking?.completedAt) add('HOLD_PERIOD', 'PENDING');
  else {
    const until = f.booking.completedAt.getTime() + q.holdDays * DAY;
    add('HOLD_PERIOD', f.now.getTime() >= until ? 'PASS' : 'PENDING', undefined, { holdDays: q.holdDays });
  }

  add('VELOCITY_30D', f.referrer.qualified30d < rules.caps.perReferrer30Days ? 'PASS' : 'FAIL', 'CAP_REACHED', { cap: rules.caps.perReferrer30Days });
  add('VELOCITY_YEAR', f.referrer.qualifiedYear < rules.caps.perReferrerYear ? 'PASS' : 'FAIL', 'CAP_REACHED', { cap: rules.caps.perReferrerYear });
  add('CAMPAIGN_CAP', f.campaignCapReached ? 'FAIL' : 'PASS', 'CAP_REACHED');
  add('RULE_BUDGET', f.budgetExhausted ? 'PENDING' : 'PASS', undefined, f.budgetExhausted ? { budget: 'EXHAUSTED' } : undefined);
  add('FRAUD', f.fraudAction === 'ALLOW' ? 'PASS' : f.fraudAction === 'HOLD' ? 'PENDING' : 'FAIL', 'FRAUD_HOLD', { action: f.fraudAction });

  const fail = checks.find((c) => c.state === 'FAIL');
  if (fail) return { result: 'REJECTED', reason: fail.reason ?? 'REJECTED', checks };
  if (checks.some((c) => c.state === 'PENDING')) {
    const hold = checks.find((c) => c.key === 'HOLD_PERIOD' && c.state === 'PENDING');
    return { result: 'PENDING', ...(hold && f.booking?.completedAt ? { qualifyAfter: new Date(f.booking.completedAt.getTime() + q.holdDays * DAY) } : {}), checks };
  }
  return { result: 'QUALIFIED', checks };
}

/** Repeat bookings (off by default: count 0): the n-th further completed booking of the referee inside the window earns one smaller referrer lot, same checks, capped by `count`. */
export function repeatEligible(rules: ReferralRulesView, o: { completedAfterFirst: number; firstCompletedAt: Date | null; bookingCompletedAt: Date | null }): boolean {
  if (rules.repeatBonus.count <= 0 || !o.firstCompletedAt || !o.bookingCompletedAt) return false;
  if (o.completedAfterFirst >= rules.repeatBonus.count) return false;
  return o.bookingCompletedAt.getTime() <= o.firstCompletedAt.getTime() + rules.repeatBonus.windowDays * DAY;
}
export type { RewardRules };
