"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.holdoutRule = holdoutRule;
const recommendation_types_1 = require("../recommendation.types");
function holdoutRule(i) {
    const out = [];
    for (const h of [...i.holdouts].sort((a, b) => (a.journey < b.journey ? -1 : 1))) {
        if (h.sent < recommendation_types_1.RECOMMENDATION_POLICY.k * 5 || h.holdout < recommendation_types_1.RECOMMENDATION_POLICY.k * 5)
            continue;
        const lift = h.sentBookedBp - h.holdoutBookedBp;
        const action = lift <= 50 ? 'DISABLE_JOURNEY' : lift >= 300 ? 'KEEP_JOURNEY' : null;
        if (!action)
            continue;
        out.push({
            kind: 'LIFECYCLE_HOLDOUT', fingerprint: `holdout:${h.journey}:${action}`,
            payload: { journey: h.journey, action, sent: h.sent, holdout: h.holdout, sentBookedBp: h.sentBookedBp, holdoutBookedBp: h.holdoutBookedBp, liftBp: lift, window: i.window },
            rationale: action === 'DISABLE_JOURNEY'
                ? { en: `Journey ${h.journey}: ${h.sentBookedBp / 100}% of messaged people booked within 30 days against ${h.holdoutBookedBp / 100}% of the holdout (lift ${lift / 100} points). Consider switching it off.`, ar: `الرحلة ${h.journey}: ${h.sentBookedBp / 100}% من اللي وصلتهم الرسائل حجزوا خلال 30 يوم مقابل ${h.holdoutBookedBp / 100}% من مجموعة القياس (فرق ${lift / 100} نقطة). فكّر توقفها.` }
                : { en: `Journey ${h.journey} works: ${h.sentBookedBp / 100}% booked against ${h.holdoutBookedBp / 100}% of the holdout (lift ${lift / 100} points). Keep it.`, ar: `الرحلة ${h.journey} شغالة: ${h.sentBookedBp / 100}% حجزوا مقابل ${h.holdoutBookedBp / 100}% من مجموعة القياس (فرق ${lift / 100} نقطة). خليها.` },
            evidenceRefs: [{ source: 'lifecycle-holdout', ref: h.journey, window: `${i.window.from}..${i.window.to}` }], confidence: Math.min(85, 50 + Math.floor(Math.min(h.sent, h.holdout) / 50)),
        });
    }
    return out;
}
//# sourceMappingURL=holdout.rule.js.map