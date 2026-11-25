"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIN_REFERRER_AGE_DAYS = void 0;
exports.qualify = qualify;
exports.repeatEligible = repeatEligible;
exports.MIN_REFERRER_AGE_DAYS = 7;
const DAY = 86_400_000;
function qualify(f, rules) {
    const checks = [];
    const add = (key, state, reason, detail) => checks.push({ key, state, ...(reason ? { reason } : {}), ...(detail ? { detail } : {}) });
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
    const refAgeOk = f.referrer.accountAgeDays >= exports.MIN_REFERRER_AGE_DAYS && f.referrer.completedBookings >= 1;
    add('REFERRER_EARNED', refAgeOk ? 'PASS' : 'PENDING', undefined, { ageDays: f.referrer.accountAgeDays, completed: f.referrer.completedBookings });
    add('CARE_TYPE_ELIGIBLE', !f.booking ? 'PENDING' : rules.eligibleCareTypes.includes(f.booking.careType) ? 'PASS' : 'FAIL', 'CARE_TYPE_NOT_ELIGIBLE');
    if (!f.booking)
        add('BOOKING_COMPLETED', 'PENDING');
    else if (f.booking.status === 'COMPLETED' || (!q.requireAttended && f.booking.status === 'CONFIRMED'))
        add('BOOKING_COMPLETED', 'PASS');
    else if (['NO_SHOW', 'CANCELLED', 'EXPIRED'].includes(f.booking.status))
        add('BOOKING_COMPLETED', 'FAIL', 'NOT_ATTENDED', { status: f.booking.status });
    else
        add('BOOKING_COMPLETED', 'PENDING', undefined, { status: f.booking.status });
    add('NOT_REFUNDED', !f.booking ? 'PENDING' : f.booking.refundedOrDisputed ? 'FAIL' : 'PASS', 'REFUNDED_OR_DISPUTED');
    add('NOT_PROVIDER_LED', !f.booking ? 'PENDING' : f.booking.providerLedByReferrerLink ? 'FAIL' : 'PASS', 'PROVIDER_LED_BOOKING');
    if (!f.booking?.completedAt)
        add('HOLD_PERIOD', 'PENDING');
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
    if (fail)
        return { result: 'REJECTED', reason: fail.reason ?? 'REJECTED', checks };
    if (checks.some((c) => c.state === 'PENDING')) {
        const hold = checks.find((c) => c.key === 'HOLD_PERIOD' && c.state === 'PENDING');
        return { result: 'PENDING', ...(hold && f.booking?.completedAt ? { qualifyAfter: new Date(f.booking.completedAt.getTime() + q.holdDays * DAY) } : {}), checks };
    }
    return { result: 'QUALIFIED', checks };
}
function repeatEligible(rules, o) {
    if (rules.repeatBonus.count <= 0 || !o.firstCompletedAt || !o.bookingCompletedAt)
        return false;
    if (o.completedAfterFirst >= rules.repeatBonus.count)
        return false;
    return o.bookingCompletedAt.getTime() <= o.firstCompletedAt.getTime() + rules.repeatBonus.windowDays * DAY;
}
//# sourceMappingURL=referral-qualification.js.map