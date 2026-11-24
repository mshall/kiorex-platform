"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FRAUD_THRESHOLDS = exports.REFERRAL_FRAUD_RULE_IDS = void 0;
exports.evaluateReferralRule = evaluateReferralRule;
exports.evaluateFraud = evaluateFraud;
exports.REFERRAL_FRAUD_RULE_IDS = ['RF_SELF', 'RF_DUP_ACCOUNT', 'RF_BOT_SIGNUP', 'RF_FARM', 'RF_FAKE_BOOKING', 'RF_PROVIDER_COLLUSION', 'RF_CANCEL_ABUSE', 'RF_REDEEM_ABUSE'];
exports.FRAUD_THRESHOLDS = {
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
};
const eq = (p) => !!p?.referrer && !!p?.referee && p.referrer === p.referee;
const RULES = [
    { id: 'RF_SELF', stages: ['CLAIM', 'BOOKING', 'QUALIFICATION'], eval: (f, o) => {
            const same = !!f.referrerSub && f.referrerSub === f.refereeSub;
            const hit = same ? 'sub' : eq(f.phoneHash) ? 'phone' : eq(f.emailHash) ? 'email' : o.paymentFingerprint && eq(f.paymentFingerprint) ? 'payment' : o.deviceSignal && eq(f.deviceHash) ? 'device' : eq(f.householdToken) ? 'household' : null;
            return hit ? { score: 100, action: 'REJECT', reason: `same ${hit}` } : null;
        } },
    { id: 'RF_DUP_ACCOUNT', stages: ['CLAIM', 'QUALIFICATION'], eval: (f) => {
            if (f.refereePhoneSeenOnOtherSub)
                return { score: 90, action: 'REJECT', reason: 'phone seen on another account' };
            if (f.linkedAccounts)
                return { score: 80, action: 'REJECT', reason: 'linked accounts' };
            if ((f.signupsFromIpPrefix24h ?? 0) > exports.FRAUD_THRESHOLDS.signupsPerIpPrefix24h)
                return { score: 55, action: 'HOLD', reason: 'many sign-ups from one network prefix' };
            return null;
        } },
    { id: 'RF_BOT_SIGNUP', stages: ['CLAIM'], eval: (f) => {
            if (f.touchFlaggedBot)
                return { score: 85, action: 'REJECT', reason: 'touch flagged as automated' };
            if (f.secondsClaimToSignup !== undefined && f.secondsClaimToSignup < exports.FRAUD_THRESHOLDS.minSecondsClaimToSignup)
                return { score: 70, action: 'REJECT', reason: 'sign-up faster than a person' };
            if ((f.otpFailures ?? 0) >= exports.FRAUD_THRESHOLDS.otpFailuresBot)
                return { score: 60, action: 'REJECT', reason: 'OTP failure pattern' };
            return null;
        } },
    { id: 'RF_FARM', stages: ['BOOKING', 'QUALIFICATION'], eval: (f) => {
            if ((f.refereesInWindow ?? 0) > exports.FRAUD_THRESHOLDS.refereesPerReferrerWindow)
                return { score: 65, action: 'HOLD', reason: 'referrer velocity' };
            if ((f.refereesWithSameProvider ?? 0) >= exports.FRAUD_THRESHOLDS.refereesWithOneProvider)
                return { score: 60, action: 'HOLD', reason: 'many referees with one provider' };
            const t = [...(f.firstBookingTimesMinutes ?? [])].sort((a, b) => a - b);
            for (let i = 0; i + exports.FRAUD_THRESHOLDS.firstBookingsClusterSize - 1 < t.length; i++)
                if (t[i + exports.FRAUD_THRESHOLDS.firstBookingsClusterSize - 1] - t[i] <= exports.FRAUD_THRESHOLDS.firstBookingsWithinMinutes)
                    return { score: 60, action: 'HOLD', reason: 'first bookings within minutes of each other' };
            if ((f.refereesSharingPaymentFingerprint ?? 0) >= exports.FRAUD_THRESHOLDS.paymentFingerprintCluster)
                return { score: 70, action: 'HOLD', reason: 'referees share a payment fingerprint' };
            if ((f.refereesTotalWithOutcome ?? 0) >= exports.FRAUD_THRESHOLDS.neverBookedTwiceMinReferees && (f.refereesNeverBookedTwice ?? 0) / (f.refereesTotalWithOutcome ?? 1) >= exports.FRAUD_THRESHOLDS.neverBookedTwiceShare)
                return { score: 50, action: 'HOLD', reason: 'referees never book twice' };
            return null;
        } },
    { id: 'RF_FAKE_BOOKING', stages: ['QUALIFICATION'], eval: (f) => {
            if (f.providerLinkedToReferrer)
                return { score: 75, action: 'HOLD', reason: 'provider linked to the referrer' };
            if (f.completionWithoutCheckIn)
                return { score: 70, action: 'HOLD', reason: 'completion without check-in evidence' };
            if (f.visitMinutes !== undefined && f.visitMinutes < exports.FRAUD_THRESHOLDS.minVisitMinutes)
                return { score: 55, action: 'HOLD', reason: 'very short visit' };
            if (f.depositRefundedAfterReward)
                return { score: 80, action: 'HOLD', reason: 'deposit refunded after the reward' };
            if (f.repeatedSlotCancelRebook)
                return { score: 55, action: 'HOLD', reason: 'repeated cancel and rebook of one slot' };
            return null;
        } },
    { id: 'RF_PROVIDER_COLLUSION', stages: ['BOOKING', 'QUALIFICATION'], eval: (f) => {
            if (f.staffPhoneMatch)
                return { score: 85, action: 'HOLD', reason: 'patient phone matches a staff phone of the booked provider' };
            if ((f.topProviderShare ?? 0) >= exports.FRAUD_THRESHOLDS.providerShareOfReferees)
                return { score: 60, action: 'HOLD', reason: 'one provider takes most of the referees' };
            if (f.providerLedTouchForReferee)
                return { score: 65, action: 'HOLD', reason: 'provider-led link touch for the same person' };
            return null;
        } },
    { id: 'RF_CANCEL_ABUSE', stages: ['QUALIFICATION', 'REDEMPTION'], eval: (f) => {
            if (f.cancelledAfterRewardInWindow)
                return { score: 80, action: 'REVERSE', reason: 'cancelled after the reward inside the reversal window' };
            if (f.refereeCancelledInHold)
                return { score: 75, action: 'REJECT', reason: 'cancelled or refunded inside the hold window' };
            if (f.noShowThenQualifyingRebook)
                return { score: 55, action: 'HOLD', reason: 'no-show then a qualifying rebook' };
            return null;
        } },
    { id: 'RF_REDEEM_ABUSE', stages: ['REDEMPTION'], eval: (f) => {
            if (f.codeUsedByOtherAccount)
                return { score: 90, action: 'BLOCK_REDEMPTION', reason: 'a code is used by another account' };
            if ((f.recentRedemptionsCancelled ?? 0) >= exports.FRAUD_THRESHOLDS.cancelledRedemptionsRecent)
                return { score: 75, action: 'BLOCK_REDEMPTION', reason: 'many redemptions on bookings that were then cancelled' };
            if (f.redeemingAcrossSameFingerprint)
                return { score: 70, action: 'BLOCK_REDEMPTION', reason: 'redeeming across accounts with one fingerprint' };
            return null;
        } },
];
function evaluateReferralRule(id, f, o = {}) {
    const r = RULES.find((x) => x.id === id);
    const s = r?.eval(f, { paymentFingerprint: o.paymentFingerprint ?? true, deviceSignal: o.deviceSignal ?? false });
    return s ? { ruleId: id, ...s } : null;
}
const PRECEDENCE = ['ALLOW', 'BLOCK_REDEMPTION', 'HOLD', 'REVERSE', 'REJECT'];
function evaluateFraud(stage, f, o = { enforce: false }) {
    const opts = { paymentFingerprint: o.paymentFingerprint ?? true, deviceSignal: o.deviceSignal ?? false };
    const signals = [];
    for (const r of RULES) {
        if (!r.stages.includes(stage))
            continue;
        const s = r.eval(f, opts);
        if (s)
            signals.push({ ruleId: r.id, ...s });
    }
    const strongest = signals.reduce((a, s) => (PRECEDENCE.indexOf(s.action) > PRECEDENCE.indexOf(a) ? s.action : a), 'ALLOW');
    const score = signals.length ? Math.min(100, Math.max(...signals.map((s) => s.score)) + 5 * (signals.length - 1)) : 0;
    return { signals, action: o.enforce ? strongest : 'ALLOW', score, shadow: !o.enforce && signals.length > 0 };
}
//# sourceMappingURL=referral-fraud.rules.js.map