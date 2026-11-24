import { evaluateReferralRule, type ReferralFraudRuleId } from '../../referral/referral-fraud.rules';
import type { FraudCaseKind, FraudFeatures, FraudRuleDef, FraudRuleId, FraudSurface, RuleOutput } from '../signals';
import { clamp01 } from '../signals';

/** The P2-B1 referral rules are the detection logic (thresholds in `FRAUD_THRESHOLDS`); P3-D wraps each as a scored rule instead of rewriting it. */
export function referralRule(id: FraudRuleId, rf: ReferralFraudRuleId, kind: FraudCaseKind, surfaces: readonly FraudSurface[], guard?: (f: FraudFeatures, o: RuleOutput) => RuleOutput | null): FraudRuleDef {
  return {
    id, kind, surfaces,
    evaluate(f) {
      const hit = evaluateReferralRule(rf, f, { paymentFingerprint: true, deviceSignal: true });
      if (!hit) return null;
      const out: RuleOutput = { strength: clamp01(hit.score / 100), reason: hit.reason, evidence: [rf, hit.reason] };
      return guard ? guard(f, out) : out;
    },
  };
}
