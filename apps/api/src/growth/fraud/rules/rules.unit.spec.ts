import { FRAUD_RULES_DEFAULTS } from '../fraud-config';
import { FRAUD_RULES_LIST, FRAUD_RULE_BY_ID } from './index';
import { FRAUD_RULE_IDS, type FraudFeatures, type FraudRuleId } from '../signals';

const T = FRAUD_RULES_DEFAULTS().thresholds;
const run = (id: FraudRuleId, f: FraudFeatures) => FRAUD_RULE_BY_ID.get(id)!.evaluate(f, T);

describe('fraud rules: every rule has a positive and a negative fixture', () => {
  it('registers exactly the eleven rules of the plan', () => {
    expect(FRAUD_RULES_LIST.map((r) => r.id).sort()).toEqual([...FRAUD_RULE_IDS].sort());
  });

  it('r_self: same account, phone, email fire; a clean pair does not', () => {
    expect(run('r_self', { referrerSub: 'a', refereeSub: 'a' })?.strength).toBe(1);
    expect(run('r_self', { phoneHash: { referrer: 'p', referee: 'p' } })?.reason).toBe('same phone');
    expect(run('r_self', { emailHash: { referrer: 'e', referee: 'e' } })).not.toBeNull();
    expect(run('r_self', { referrerSub: 'a', refereeSub: 'b', phoneHash: { referrer: 'p', referee: 'q' } })).toBeNull();
  });
  it('r_self legit family: siblings on one phone inside a declared household stay below the review band', () => {
    const o = run('r_self', { householdDeclared: true, phoneHash: { referrer: 'p', referee: 'p' } })!;
    expect(o.strength).toBeLessThan(0.3);
    // but a shared account is never excused by a household
    expect(run('r_self', { householdDeclared: true, referrerSub: 'a', refereeSub: 'a' })!.strength).toBe(1);
  });
  it('r_dup: phone on another account fires; household phone is excused; nothing fires on clean facts', () => {
    expect(run('r_dup', { refereePhoneSeenOnOtherSub: true })!.strength).toBeGreaterThanOrEqual(0.9);
    expect(run('r_dup', { refereePhoneSeenOnOtherSub: true, householdDeclared: true })!.strength).toBeLessThan(0.3);
    expect(run('r_dup', { signupsFromIpPrefix24h: 1 })).toBeNull();
  });
  it('r_bot: fast sign-up and OTP failures fire; a normal pace does not', () => {
    expect(run('r_bot', { secondsClaimToSignup: 1 })).not.toBeNull();
    expect(run('r_bot', { otpFailures: 6 })).not.toBeNull();
    expect(run('r_bot', { secondsClaimToSignup: 40, otpFailures: 1 })).toBeNull();
  });
  it('r_farm: velocity, clustering and a shared payment fingerprint fire; three referees over a month do not', () => {
    expect(run('r_farm', { refereesInWindow: 9 })).not.toBeNull();
    expect(run('r_farm', { firstBookingTimesMinutes: [0, 2, 4] })).not.toBeNull();
    expect(run('r_farm', { refereesSharingPaymentFingerprint: 2 })).not.toBeNull();
    expect(run('r_farm', { refereesInWindow: 3, refereesWithSameProvider: 1, firstBookingTimesMinutes: [0, 600, 4000] })).toBeNull();
  });
  it('r_fakebooking: completion without a check-in and a refunded deposit fire; a normal completed visit does not', () => {
    expect(run('r_fakebooking', { completionWithoutCheckIn: true })).not.toBeNull();
    expect(run('r_fakebooking', { depositRefundedAfterReward: true })!.strength).toBeGreaterThan(0.7);
    expect(run('r_fakebooking', { visitMinutes: 25, completionWithoutCheckIn: false })).toBeNull();
  });
  it('r_collusion: a staff phone match is a PROVIDER finding; a receptionist booking on behalf is excused', () => {
    expect(FRAUD_RULE_BY_ID.get('r_collusion')!.kind).toBe('PROVIDER');
    expect(run('r_collusion', { staffPhoneMatch: true })!.strength).toBeGreaterThan(0.8);
    expect(run('r_collusion', { staffPhoneMatch: true, bookedOnBehalfByStaff: true })!.strength).toBeLessThan(0.3);
    expect(run('r_collusion', { topProviderShare: 0.2 })).toBeNull();
  });
  it('r_cancel: cancelling after the reward fires; an ordinary cancelled booking with no reward does not', () => {
    expect(run('r_cancel', { cancelledAfterRewardInWindow: true })).not.toBeNull();
    expect(run('r_cancel', { refereeCancelledInHold: true })).not.toBeNull();
    expect(run('r_cancel', {})).toBeNull();
  });
  it('r_redeem: a code used by another account fires', () => {
    expect(run('r_redeem', { codeUsedByOtherAccount: true })!.strength).toBeGreaterThanOrEqual(0.9);
    expect(run('r_redeem', { recentRedemptionsCancelled: 1 })).toBeNull();
  });
  it('r_touch_burst: above the limit fires with a strength that grows; at the limit does not', () => {
    const a = run('r_touch_burst', { touchBurstPerMinute: 25 })!; const b = run('r_touch_burst', { touchBurstPerMinute: 60 })!;
    expect(b.strength).toBeGreaterThan(a.strength);
    expect(run('r_touch_burst', { touchBurstPerMinute: 20 })).toBeNull();
    expect(run('r_touch_burst', { clickWithoutRender: true })).not.toBeNull();
  });
  it('r_widget_abuse: origin forgery, many origins per key, flood and replays fire; a few mismatches do not', () => {
    expect(run('r_widget_abuse', { widgetOriginMismatches: 5 })).not.toBeNull();
    expect(run('r_widget_abuse', { widgetDistinctOriginsPerKey1h: 8 })).not.toBeNull();
    expect(run('r_widget_abuse', { widgetRequestsPerOrigin5m: 900 })).not.toBeNull();
    expect(run('r_widget_abuse', { widgetTokenReplays: 3 })).not.toBeNull();
    expect(run('r_widget_abuse', { widgetOriginMismatches: 1, widgetRequestsPerOrigin5m: 20 })).toBeNull();
  });
  it('r_lt_replay: an invalid signature is certain; replay across subjects fires; one normal use does not', () => {
    expect(run('r_lt_replay', { ltSignatureInvalid: true })!.strength).toBe(1);
    expect(run('r_lt_replay', { ltDistinctSubjects: 4 })).not.toBeNull();
    expect(run('r_lt_replay', { ltUseCount: 12 })).not.toBeNull();
    expect(run('r_lt_replay', { ltUsedAfterExpiry: true })).not.toBeNull();
    expect(run('r_lt_replay', { ltUseCount: 1, ltDistinctSubjects: 1 })).toBeNull();
  });
  it('every strength is in 0..1 and rules never throw on empty features', () => {
    for (const r of FRAUD_RULES_LIST) {
      expect(() => r.evaluate({}, T)).not.toThrow();
      const o = r.evaluate({ ltSignatureInvalid: true, staffPhoneMatch: true, codeUsedByOtherAccount: true, widgetOriginMismatches: 99, touchBurstPerMinute: 9999, refereesInWindow: 99, secondsClaimToSignup: 0 }, T);
      if (o) { expect(o.strength).toBeGreaterThanOrEqual(0); expect(o.strength).toBeLessThanOrEqual(1); }
    }
  });
});
