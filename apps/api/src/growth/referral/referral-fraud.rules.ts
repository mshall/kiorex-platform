/**
 * Referral fraud rules (GRW-P2-B1). Pure: facts in, signals out. The service gathers the facts (hashes only, never an identifier) and writes one GrowthFraudSignal per triggered rule.
 * In SHADOW mode (flag growth.referral_fraud_enforce switched OFF; the catalogue ships it ON like every flag, so enforcement is the default) the signals are recorded but the action is always ALLOW; in ENFORCE mode REJECT and HOLD take effect.
 * Weights and thresholds are code constants (REFERRAL_RULES has no fraud block in contracts 1.12.0; P3-D takes scoring over). A signal NEVER changes an attribution decision, a commission or a booking.
 */
export type FraudAction = 'ALLOW' | 'HOLD' | 'REJECT' | 'REVERSE' | 'BLOCK_REDEMPTION';
export type FraudStage = 'CLAIM' | 'BOOKING' | 'QUALIFICATION' | 'REDEMPTION';
export const REFERRAL_FRAUD_RULE_IDS = ['RF_SELF', 'RF_DUP_ACCOUNT', 'RF_BOT_SIGNUP', 'RF_FARM', 'RF_FAKE_BOOKING', 'RF_PROVIDER_COLLUSION', 'RF_CANCEL_ABUSE', 'RF_REDEEM_ABUSE'] as const;
export type ReferralFraudRuleId = (typeof REFERRAL_FRAUD_RULE_IDS)[number];

export const FRAUD_THRESHOLDS = {
  signupsPerIpPrefix24h: 5,
  minSecondsClaimToSignup: 3,
  otpFailuresBot: 5,
  refereesPerReferrerWindow: 6,
  refereesWithOneProvider: 3,
  firstBookingsWithinMinutes: 10,
  firstBookingsClusterSize: 3,
  paymentFingerprintCluster: 2,
  neverBookedTwiceShare: 0.8,
  neverBookedTwiceMinReferees: 5,
  minVisitMinutes: 5,
  providerShareOfReferees: 0.6,
  providerShareMinReferees: 4,
  cancelledRedemptionsRecent: 3,
} as const;

/** One bag of facts; every field is optional so each stage supplies what it knows. Hashes are keyed hashes, never identifiers. */
export interface FraudFacts {
  referrerSub?: string; refereeSub?: string;
  phoneHash?: { referrer?: string; referee?: string };
  emailHash?: { referrer?: string; referee?: string };
  paymentFingerprint?: { referrer?: string; referee?: string };
  deviceHash?: { referrer?: string; referee?: string };
  householdToken?: { referrer?: string; referee?: string };
  refereePhoneSeenOnOtherSub?: boolean;
  linkedAccounts?: boolean;
  signupsFromIpPrefix24h?: number;
  touchFlaggedBot?: boolean;
  secondsClaimToSignup?: number;
  otpFailures?: number;
  /** FARM */
  refereesInWindow?: number;
  refereesWithSameProvider?: number;
  firstBookingTimesMinutes?: number[];
  refereesSharingPaymentFingerprint?: number;
  refereesTotalWithOutcome?: number;
  refereesNeverBookedTwice?: number;
  /** FAKE BOOKING */
  providerLinkedToReferrer?: boolean;
  completionWithoutCheckIn?: boolean;
  visitMinutes?: number;
  depositRefundedAfterReward?: boolean;
  repeatedSlotCancelRebook?: boolean;
  /** COLLUSION */
  staffPhoneMatch?: boolean;
  topProviderShare?: number;
  providerLedTouchForReferee?: boolean;
  /** CANCEL ABUSE */
  refereeCancelledInHold?: boolean;
  noShowThenQualifyingRebook?: boolean;
  cancelledAfterRewardInWindow?: boolean;
  /** REDEEM ABUSE */
  recentRedemptionsCancelled?: number;
  redeemingAcrossSameFingerprint?: boolean;
  codeUsedByOtherAccount?: boolean;
}

export interface FraudSignal { ruleId: ReferralFraudRuleId; score: number; action: FraudAction; reason: string }
const eq = (p?: { referrer?: string; referee?: string }) => !!p?.referrer && !!p?.referee && p.referrer === p.referee;

const RULES: Array<{ id: ReferralFraudRuleId; stages: FraudStage[]; eval: (f: FraudFacts, opts: { paymentFingerprint: boolean; deviceSignal: boolean }) => Omit<FraudSignal, 'ruleId'> | null }> = [
  { id: 'RF_SELF', stages: ['CLAIM', 'BOOKING', 'QUALIFICATION'], eval: (f, o) => {
    const same = !!f.referrerSub && f.referrerSub === f.refereeSub;
    const hit = same ? 'sub' : eq(f.phoneHash) ? 'phone' : eq(f.emailHash) ? 'email' : o.paymentFingerprint && eq(f.paymentFingerprint) ? 'payment' : o.deviceSignal && eq(f.deviceHash) ? 'device' : eq(f.householdToken) ? 'household' : null;
    return hit ? { score: 100, action: 'REJECT', reason: `same ${hit}` } : null;
  } },
  { id: 'RF_DUP_ACCOUNT', stages: ['CLAIM', 'QUALIFICATION'], eval: (f) => {
    if (f.refereePhoneSeenOnOtherSub) return { score: 90, action: 'REJECT', reason: 'phone seen on another account' };
    if (f.linkedAccounts) return { score: 80, action: 'REJECT', reason: 'linked accounts' };
    if ((f.signupsFromIpPrefix24h ?? 0) > FRAUD_THRESHOLDS.signupsPerIpPrefix24h) return { score: 55, action: 'HOLD', reason: 'many sign-ups from one network prefix' };
    return null;
  } },
  { id: 'RF_BOT_SIGNUP', stages: ['CLAIM'], eval: (f) => {
    if (f.touchFlaggedBot) return { score: 85, action: 'REJECT', reason: 'touch flagged as automated' };
    if (f.secondsClaimToSignup !== undefined && f.secondsClaimToSignup < FRAUD_THRESHOLDS.minSecondsClaimToSignup) return { score: 70, action: 'REJECT', reason: 'sign-up faster than a person' };
    if ((f.otpFailures ?? 0) >= FRAUD_THRESHOLDS.otpFailuresBot) return { score: 60, action: 'REJECT', reason: 'OTP failure pattern' };
    return null;
  } },
  { id: 'RF_FARM', stages: ['BOOKING', 'QUALIFICATION'], eval: (f) => {
    if ((f.refereesInWindow ?? 0) > FRAUD_THRESHOLDS.refereesPerReferrerWindow) return { score: 65, action: 'HOLD', reason: 'referrer velocity' };
    if ((f.refereesWithSameProvider ?? 0) >= FRAUD_THRESHOLDS.refereesWithOneProvider) return { score: 60, action: 'HOLD', reason: 'many referees with one provider' };
    const t = [...(f.firstBookingTimesMinutes ?? [])].sort((a, b) => a - b);
    for (let i = 0; i + FRAUD_THRESHOLDS.firstBookingsClusterSize - 1 < t.length; i++) if (t[i + FRAUD_THRESHOLDS.firstBookingsClusterSize - 1] - t[i] <= FRAUD_THRESHOLDS.firstBookingsWithinMinutes) return { score: 60, action: 'HOLD', reason: 'first bookings within minutes of each other' };
    if ((f.refereesSharingPaymentFingerprint ?? 0) >= FRAUD_THRESHOLDS.paymentFingerprintCluster) return { score: 70, action: 'HOLD', reason: 'referees share a payment fingerprint' };
    if ((f.refereesTotalWithOutcome ?? 0) >= FRAUD_THRESHOLDS.neverBookedTwiceMinReferees && (f.refereesNeverBookedTwice ?? 0) / (f.refereesTotalWithOutcome ?? 1) >= FRAUD_THRESHOLDS.neverBookedTwiceShare) return { score: 50, action: 'HOLD', reason: 'referees never book twice' };
    return null;
  } },
  { id: 'RF_FAKE_BOOKING', stages: ['QUALIFICATION'], eval: (f) => {
    if (f.providerLinkedToReferrer) return { score: 75, action: 'HOLD', reason: 'provider linked to the referrer' };
    if (f.completionWithoutCheckIn) return { score: 70, action: 'HOLD', reason: 'completion without check-in evidence' };
    if (f.visitMinutes !== undefined && f.visitMinutes < FRAUD_THRESHOLDS.minVisitMinutes) return { score: 55, action: 'HOLD', reason: 'very short visit' };
    if (f.depositRefundedAfterReward) return { score: 80, action: 'HOLD', reason: 'deposit refunded after the reward' };
    if (f.repeatedSlotCancelRebook) return { score: 55, action: 'HOLD', reason: 'repeated cancel and rebook of one slot' };
    return null;
  } },
  { id: 'RF_PROVIDER_COLLUSION', stages: ['BOOKING', 'QUALIFICATION'], eval: (f) => {
    if (f.staffPhoneMatch) return { score: 85, action: 'HOLD', reason: 'patient phone matches a staff phone of the booked provider' };
    if ((f.topProviderShare ?? 0) >= FRAUD_THRESHOLDS.providerShareOfReferees) return { score: 60, action: 'HOLD', reason: 'one provider takes most of the referees' };
    if (f.providerLedTouchForReferee) return { score: 65, action: 'HOLD', reason: 'provider-led link touch for the same person' };
    return null;
  } },
  { id: 'RF_CANCEL_ABUSE', stages: ['QUALIFICATION', 'REDEMPTION'], eval: (f) => {
    if (f.cancelledAfterRewardInWindow) return { score: 80, action: 'REVERSE', reason: 'cancelled after the reward inside the reversal window' };
    if (f.refereeCancelledInHold) return { score: 75, action: 'REJECT', reason: 'cancelled or refunded inside the hold window' };
    if (f.noShowThenQualifyingRebook) return { score: 55, action: 'HOLD', reason: 'no-show then a qualifying rebook' };
    return null;
  } },
  { id: 'RF_REDEEM_ABUSE', stages: ['REDEMPTION'], eval: (f) => {
    if (f.codeUsedByOtherAccount) return { score: 90, action: 'BLOCK_REDEMPTION', reason: 'a code is used by another account' };
    if ((f.recentRedemptionsCancelled ?? 0) >= FRAUD_THRESHOLDS.cancelledRedemptionsRecent) return { score: 75, action: 'BLOCK_REDEMPTION', reason: 'many redemptions on bookings that were then cancelled' };
    if (f.redeemingAcrossSameFingerprint) return { score: 70, action: 'BLOCK_REDEMPTION', reason: 'redeeming across accounts with one fingerprint' };
    return null;
  } },
];

/** One referral rule by id, whatever the stage (GRW-P3-D wraps these as scored signals; the stage table above stays the P2-B1 contract). */
export function evaluateReferralRule(id: ReferralFraudRuleId, f: FraudFacts, o: { paymentFingerprint?: boolean; deviceSignal?: boolean } = {}): FraudSignal | null {
  const r = RULES.find((x) => x.id === id);
  const s = r?.eval(f, { paymentFingerprint: o.paymentFingerprint ?? true, deviceSignal: o.deviceSignal ?? false });
  return s ? { ruleId: id, ...s } : null;
}

const PRECEDENCE: FraudAction[] = ['ALLOW', 'BLOCK_REDEMPTION', 'HOLD', 'REVERSE', 'REJECT'];

/** Every rule of the stage that fires, with the combined action (the strongest) and a score (max, plus 5 per extra rule, capped at 100). `enforce=false` keeps the signals and returns ALLOW. */
export function evaluateFraud(stage: FraudStage, f: FraudFacts, o: { enforce: boolean; paymentFingerprint?: boolean; deviceSignal?: boolean } = { enforce: false }): { signals: FraudSignal[]; action: FraudAction; score: number; shadow: boolean } {
  const opts = { paymentFingerprint: o.paymentFingerprint ?? true, deviceSignal: o.deviceSignal ?? false };
  const signals: FraudSignal[] = [];
  for (const r of RULES) {
    if (!r.stages.includes(stage)) continue;
    const s = r.eval(f, opts);
    if (s) signals.push({ ruleId: r.id, ...s });
  }
  const strongest = signals.reduce<FraudAction>((a, s) => (PRECEDENCE.indexOf(s.action) > PRECEDENCE.indexOf(a) ? s.action : a), 'ALLOW');
  const score = signals.length ? Math.min(100, Math.max(...signals.map((s) => s.score)) + 5 * (signals.length - 1)) : 0;
  return { signals, action: o.enforce ? strongest : 'ALLOW', score, shadow: !o.enforce && signals.length > 0 };
}
