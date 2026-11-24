"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.referralRule = referralRule;
const referral_fraud_rules_1 = require("../../referral/referral-fraud.rules");
const signals_1 = require("../signals");
function referralRule(id, rf, kind, surfaces, guard) {
    return {
        id, kind, surfaces,
        evaluate(f) {
            const hit = (0, referral_fraud_rules_1.evaluateReferralRule)(rf, f, { paymentFingerprint: true, deviceSignal: true });
            if (!hit)
                return null;
            const out = { strength: (0, signals_1.clamp01)(hit.score / 100), reason: hit.reason, evidence: [rf, hit.reason] };
            return guard ? guard(f, out) : out;
        },
    };
}
//# sourceMappingURL=wrap.js.map