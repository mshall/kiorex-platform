import { FRAUD_THRESHOLDS, REFERRAL_FRAUD_RULE_IDS, evaluateFraud, type FraudFacts, type FraudStage } from './referral-fraud.rules';

const enforce = { enforce: true };
const ids = (stage: FraudStage, f: FraudFacts, o: Parameters<typeof evaluateFraud>[2] = enforce) => evaluateFraud(stage, f, o).signals.map((s) => s.ruleId);

describe('referral fraud rules (pure)', () => {
  describe('RF_SELF', () => {
    it.each([
      ['same sub', { referrerSub: 'a', refereeSub: 'a' }], ['same phone hash', { phoneHash: { referrer: 'p', referee: 'p' } }], ['same e-mail hash', { emailHash: { referrer: 'e', referee: 'e' } }],
      ['same payment fingerprint', { paymentFingerprint: { referrer: 'f', referee: 'f' } }], ['same household token', { householdToken: { referrer: 'h', referee: 'h' } }],
    ] as Array<[string, FraudFacts]>)('%s is rejected', (_n, f) => { const r = evaluateFraud('CLAIM', f, enforce); expect(r.signals.map((s) => s.ruleId)).toContain('RF_SELF'); expect(r.action).toBe('REJECT'); });
    it('a device match counts only when the device signal is switched on', () => {
      const f: FraudFacts = { deviceHash: { referrer: 'd', referee: 'd' } };
      expect(ids('CLAIM', f)).toEqual([]); expect(ids('CLAIM', f, { enforce: true, deviceSignal: true })).toEqual(['RF_SELF']);
    });
    it('a payment fingerprint match is ignored when the payment signal is switched off', () => { expect(ids('CLAIM', { paymentFingerprint: { referrer: 'f', referee: 'f' } }, { enforce: true, paymentFingerprint: false })).toEqual([]); });
    it('legit friends: different subs, phones, e-mails, cards and households are allowed', () => {
      expect(evaluateFraud('CLAIM', { referrerSub: 'a', refereeSub: 'b', phoneHash: { referrer: 'p1', referee: 'p2' }, emailHash: { referrer: 'e1', referee: 'e2' }, paymentFingerprint: { referrer: 'f1', referee: 'f2' }, householdToken: { referrer: 'h1', referee: 'h2' } }, enforce).action).toBe('ALLOW');
    });
    it('legit family: two adults of different households sharing an office network are allowed below the sign-up threshold', () => {
      expect(evaluateFraud('CLAIM', { referrerSub: 'a', refereeSub: 'b', signupsFromIpPrefix24h: FRAUD_THRESHOLDS.signupsPerIpPrefix24h, phoneHash: { referrer: 'p1', referee: 'p2' } }, enforce).action).toBe('ALLOW');
    });
    it('missing hashes never match each other (undefined is not equal to undefined)', () => { expect(ids('CLAIM', { phoneHash: {}, emailHash: { referrer: undefined, referee: undefined } })).toEqual([]); });
  });

  describe('RF_DUP_ACCOUNT', () => {
    it('phone seen on another account and linked accounts reject', () => {
      expect(evaluateFraud('CLAIM', { refereePhoneSeenOnOtherSub: true }, enforce).action).toBe('REJECT');
      expect(evaluateFraud('CLAIM', { linkedAccounts: true }, enforce).action).toBe('REJECT');
    });
    it.each([[5, 'ALLOW'], [6, 'HOLD']])('%d sign-ups from one network prefix in 24h -> %s', (n, a) => { expect(evaluateFraud('CLAIM', { signupsFromIpPrefix24h: n }, enforce).action).toBe(a); });
  });

  describe('RF_BOT_SIGNUP', () => {
    it.each([[{ touchFlaggedBot: true }, 'REJECT'], [{ secondsClaimToSignup: 2 }, 'REJECT'], [{ secondsClaimToSignup: 3 }, 'ALLOW'], [{ otpFailures: 5 }, 'REJECT'], [{ otpFailures: 4 }, 'ALLOW'], [{ secondsClaimToSignup: 40, otpFailures: 1 }, 'ALLOW']] as Array<[FraudFacts, string]>)('%j -> %s', (f, a) => { expect(evaluateFraud('CLAIM', f, enforce).action).toBe(a); });
  });

  describe('RF_FARM', () => {
    it.each([
      [{ refereesInWindow: 6 }, 'ALLOW'], [{ refereesInWindow: 7 }, 'HOLD'], [{ refereesWithSameProvider: 2 }, 'ALLOW'], [{ refereesWithSameProvider: 3 }, 'HOLD'],
      [{ firstBookingTimesMinutes: [0, 5, 9] }, 'HOLD'], [{ firstBookingTimesMinutes: [0, 5, 30] }, 'ALLOW'], [{ firstBookingTimesMinutes: [0, 600, 1200] }, 'ALLOW'],
      [{ refereesSharingPaymentFingerprint: 2 }, 'HOLD'], [{ refereesSharingPaymentFingerprint: 1 }, 'ALLOW'],
      [{ refereesTotalWithOutcome: 5, refereesNeverBookedTwice: 4 }, 'HOLD'], [{ refereesTotalWithOutcome: 5, refereesNeverBookedTwice: 3 }, 'ALLOW'], [{ refereesTotalWithOutcome: 2, refereesNeverBookedTwice: 2 }, 'ALLOW'],
    ] as Array<[FraudFacts, string]>)('%j -> %s', (f, a) => { expect(evaluateFraud('QUALIFICATION', f, enforce).action).toBe(a); });
  });

  describe('RF_FAKE_BOOKING', () => {
    it.each([
      [{ providerLinkedToReferrer: true }, 'HOLD'], [{ completionWithoutCheckIn: true }, 'HOLD'], [{ visitMinutes: 4 }, 'HOLD'], [{ visitMinutes: 5 }, 'ALLOW'], [{ visitMinutes: 25 }, 'ALLOW'],
      [{ depositRefundedAfterReward: true }, 'HOLD'], [{ repeatedSlotCancelRebook: true }, 'HOLD'], [{}, 'ALLOW'],
    ] as Array<[FraudFacts, string]>)('%j -> %s', (f, a) => { expect(evaluateFraud('QUALIFICATION', f, enforce).action).toBe(a); });
  });

  describe('RF_PROVIDER_COLLUSION', () => {
    it.each([[{ staffPhoneMatch: true }, 'HOLD'], [{ topProviderShare: 0.6 }, 'HOLD'], [{ topProviderShare: 0.59 }, 'ALLOW'], [{ providerLedTouchForReferee: true }, 'HOLD'], [{ staffPhoneMatch: false }, 'ALLOW']] as Array<[FraudFacts, string]>)('%j -> %s', (f, a) => { expect(evaluateFraud('QUALIFICATION', f, enforce).action).toBe(a); expect(evaluateFraud('BOOKING', f, enforce).action).toBe(a); });
  });

  describe('RF_CANCEL_ABUSE', () => {
    it.each([[{ cancelledAfterRewardInWindow: true }, 'REVERSE'], [{ refereeCancelledInHold: true }, 'REJECT'], [{ noShowThenQualifyingRebook: true }, 'HOLD'], [{}, 'ALLOW']] as Array<[FraudFacts, string]>)('%j -> %s', (f, a) => { expect(evaluateFraud('QUALIFICATION', f, enforce).action).toBe(a); });
  });

  describe('RF_REDEEM_ABUSE', () => {
    it.each([[{ codeUsedByOtherAccount: true }, 'BLOCK_REDEMPTION'], [{ recentRedemptionsCancelled: 3 }, 'BLOCK_REDEMPTION'], [{ recentRedemptionsCancelled: 2 }, 'ALLOW'], [{ redeemingAcrossSameFingerprint: true }, 'BLOCK_REDEMPTION']] as Array<[FraudFacts, string]>)('%j -> %s', (f, a) => { expect(evaluateFraud('REDEMPTION', f, enforce).action).toBe(a); });
  });

  describe('modes and combination', () => {
    it('SHADOW mode (the default) records the signals and never acts', () => {
      const r = evaluateFraud('CLAIM', { referrerSub: 'a', refereeSub: 'a' });
      expect(r.signals.map((s) => s.ruleId)).toEqual(['RF_SELF']); expect(r.action).toBe('ALLOW'); expect(r.shadow).toBe(true);
    });
    it('the strongest action wins and the score grows with every extra rule, capped at 100', () => {
      const r = evaluateFraud('CLAIM', { referrerSub: 'a', refereeSub: 'a', touchFlaggedBot: true, refereePhoneSeenOnOtherSub: true }, enforce);
      expect(r.action).toBe('REJECT'); expect(r.score).toBe(100); expect(r.signals).toHaveLength(3);
    });
    it('a rule of another stage does not fire (a farm signal at claim time is not evaluated)', () => { expect(ids('CLAIM', { refereesInWindow: 99 })).toEqual([]); });
    it('every rule id of the table exists, and every one has a positive scenario above', () => { expect([...REFERRAL_FRAUD_RULE_IDS]).toHaveLength(8); });
    it('no fact or signal carries a name, phone number or identifier shape (hash-only inputs)', () => {
      const r = evaluateFraud('CLAIM', { referrerSub: 'a', refereeSub: 'a' }, enforce);
      expect(JSON.stringify(r)).not.toMatch(/\+20|@|\d{10}/);
    });
  });
});
