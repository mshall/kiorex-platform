import { qualify, repeatEligible, type QualFacts, type ReferralRulesView } from './referral-qualification';

const DAY = 86_400_000;
const NOW = new Date('2026-12-20T12:00:00Z');
const RULES: ReferralRulesView = { enabled: true, qualification: { requireAttended: true, holdDays: 7, requirePhoneVerified: true, lookbackDays: 30 }, caps: { perReferrer30Days: 5, perReferrerYear: 20 }, repeatBonus: { count: 0, windowDays: 90 }, eligibleCareTypes: ['IN_CLINIC', 'VIDEO', 'HOME_VISIT'], signals: { deviceSignal: false, paymentFingerprint: true } };
const base = (o: Partial<QualFacts> = {}, b: Partial<NonNullable<QualFacts['booking']>> | null = {}): QualFacts => ({
  now: NOW,
  relationship: { createdAt: new Date(NOW.getTime() - 20 * DAY), status: 'BOOKED', reviewState: 'NONE' },
  referee: { phoneVerified: true, existingPatientBeforeClaim: false, phoneSeenOnOtherAccount: false },
  booking: b === null ? null : { status: 'COMPLETED', careType: 'IN_CLINIC', completedAt: new Date(NOW.getTime() - 8 * DAY), refundedOrDisputed: false, providerLedByReferrerLink: false, firstBookingAt: new Date(NOW.getTime() - 10 * DAY), ...b },
  referrer: { suspended: false, accountAgeDays: 30, completedBookings: 2, qualified30d: 0, qualifiedYear: 0 },
  campaignCapReached: false, budgetExhausted: false, fraudAction: 'ALLOW', ...o,
});

describe('referral qualification (pure)', () => {
  it('QUALIFIED when every check passes, with one PASS row per check', () => {
    const r = qualify(base(), RULES);
    expect(r.result).toBe('QUALIFIED');
    expect(r.checks.every((c) => c.state === 'PASS')).toBe(true);
    expect(r.checks.map((c) => c.key)).toEqual(expect.arrayContaining(['HOLD_PERIOD', 'BOOKING_COMPLETED', 'NOT_REFUNDED', 'VELOCITY_30D', 'FRAUD', 'REFEREE_PHONE_VERIFIED']));
  });

  describe('hold period boundary (7 days after completion)', () => {
    it.each([[8 * DAY, 'QUALIFIED'], [7 * DAY, 'QUALIFIED'], [7 * DAY - 1, 'PENDING'], [1 * DAY, 'PENDING'], [0, 'PENDING']])('completed %d ms ago is %s', (ago, res) => {
      const r = qualify(base({}, { completedAt: new Date(NOW.getTime() - ago) }), RULES);
      expect(r.result).toBe(res);
      if (res === 'PENDING') expect(r.qualifyAfter?.getTime()).toBe(NOW.getTime() - ago + 7 * DAY);
    });
    it('holdDays 0 qualifies at once; 90 holds for 90 days', () => {
      expect(qualify(base({}, { completedAt: NOW }), { ...RULES, qualification: { ...RULES.qualification, holdDays: 0 } }).result).toBe('QUALIFIED');
      expect(qualify(base({}, { completedAt: new Date(NOW.getTime() - 89 * DAY) }), { ...RULES, qualification: { ...RULES.qualification, holdDays: 90 } }).result).toBe('PENDING');
    });
  });

  describe('attendance', () => {
    it.each([['COMPLETED', 'QUALIFIED'], ['CONFIRMED', 'PENDING'], ['PENDING_CLINIC', 'PENDING'], ['CHECKED_IN', 'PENDING'], ['NO_SHOW', 'REJECTED'], ['CANCELLED', 'REJECTED'], ['EXPIRED', 'REJECTED']])('booking %s is %s', (status, res) => {
      expect(qualify(base({}, { status }), RULES).result).toBe(res);
    });
    it('a NO_SHOW never counts even when attendance is not required', () => {
      const r = qualify(base({}, { status: 'NO_SHOW' }), { ...RULES, qualification: { ...RULES.qualification, requireAttended: false } });
      expect(r.result).toBe('REJECTED'); expect(r.reason).toBe('NOT_ATTENDED');
    });
    it('no booking yet is PENDING with every booking check PENDING', () => {
      const r = qualify(base({}, null), RULES);
      expect(r.result).toBe('PENDING');
      expect(r.checks.filter((c) => c.state === 'PENDING').map((c) => c.key)).toEqual(expect.arrayContaining(['BOOKING_COMPLETED', 'NOT_REFUNDED', 'HOLD_PERIOD', 'CARE_TYPE_ELIGIBLE']));
    });
  });

  describe('hard failures reject with a closed reason', () => {
    it.each([
      ['rules disabled', () => qualify(base(), { ...RULES, enabled: false }), 'RULES_DISABLED'],
      ['suspended code', () => qualify(base({ referrer: { suspended: true, accountAgeDays: 30, completedBookings: 2, qualified30d: 0, qualifiedYear: 0 } }), RULES), 'CODE_SUSPENDED'],
      ['already a patient', () => qualify(base({ referee: { phoneVerified: true, existingPatientBeforeClaim: true, phoneSeenOnOtherAccount: false } }), RULES), 'ALREADY_PATIENT'],
      ['phone on another account', () => qualify(base({ referee: { phoneVerified: true, existingPatientBeforeClaim: false, phoneSeenOnOtherAccount: true } }), RULES), 'DUPLICATE_IDENTITY'],
      ['phone not verified', () => qualify(base({ referee: { phoneVerified: false, existingPatientBeforeClaim: false, phoneSeenOnOtherAccount: false } }), RULES), 'PHONE_NOT_VERIFIED'],
      ['refunded', () => qualify(base({}, { refundedOrDisputed: true }), RULES), 'REFUNDED_OR_DISPUTED'],
      ['provider-led by the referrer link', () => qualify(base({}, { providerLedByReferrerLink: true }), RULES), 'PROVIDER_LED_BOOKING'],
      ['care type not eligible', () => qualify(base({}, { careType: 'LAB' }), RULES), 'CARE_TYPE_NOT_ELIGIBLE'],
      ['campaign cap', () => qualify(base({ campaignCapReached: true }), RULES), 'CAP_REACHED'],
      ['fraud reject', () => qualify(base({ fraudAction: 'REJECT' }), RULES), 'FRAUD_HOLD'],
    ])('%s', (_n, run, reason) => { const r = run(); expect(r.result).toBe('REJECTED'); expect(r.reason).toBe(reason); });
    it('phone verification can be switched off by the rules', () => {
      expect(qualify(base({ referee: { phoneVerified: false, existingPatientBeforeClaim: false, phoneSeenOnOtherAccount: false } }), { ...RULES, qualification: { ...RULES.qualification, requirePhoneVerified: false } }).result).toBe('QUALIFIED');
    });
  });

  describe('claim window (30 days from the claim)', () => {
    it.each([[29 * DAY, 'QUALIFIED'], [30 * DAY, 'QUALIFIED'], [30 * DAY + 1, 'REJECTED']])('first booking %d ms after the claim is %s', (after, res) => {
      const created = new Date(NOW.getTime() - 40 * DAY);
      const r = qualify(base({ relationship: { createdAt: created, status: 'BOOKED', reviewState: 'NONE' } }, { firstBookingAt: new Date(created.getTime() + after), completedAt: new Date(NOW.getTime() - 8 * DAY) }), RULES);
      expect(r.result).toBe(res); if (res === 'REJECTED') expect(r.reason).toBe('EXPIRED');
    });
    it('with no booking after the window the relationship expires', () => {
      const r = qualify(base({ relationship: { createdAt: new Date(NOW.getTime() - 31 * DAY), status: 'SIGNED_UP', reviewState: 'NONE' } }, null), RULES);
      expect(r.result).toBe('REJECTED'); expect(r.reason).toBe('EXPIRED');
    });
  });

  describe('referrer earned the right (anti-farming): 7 days and one completed booking', () => {
    it.each([[7, 1, 'QUALIFIED'], [6, 1, 'PENDING'], [7, 0, 'PENDING'], [0, 0, 'PENDING'], [400, 50, 'QUALIFIED']])('age %d days, %d completed -> %s', (age, done, res) => {
      expect(qualify(base({ referrer: { suspended: false, accountAgeDays: age, completedBookings: done, qualified30d: 0, qualifiedYear: 0 } }), RULES).result).toBe(res);
    });
  });

  describe('velocity caps', () => {
    it.each([[4, 0, 'QUALIFIED'], [5, 0, 'REJECTED'], [6, 0, 'REJECTED'], [0, 19, 'QUALIFIED'], [0, 20, 'REJECTED']])('30d %d, year %d -> %s', (d30, yr, res) => {
      const r = qualify(base({ referrer: { suspended: false, accountAgeDays: 30, completedBookings: 2, qualified30d: d30, qualifiedYear: yr } }), RULES);
      expect(r.result).toBe(res); if (res === 'REJECTED') expect(r.reason).toBe('CAP_REACHED');
    });
  });

  describe('budget and fraud', () => {
    it('an exhausted rule budget waits (PENDING), never a pass', () => { expect(qualify(base({ budgetExhausted: true }), RULES).result).toBe('PENDING'); });
    it('a fraud HOLD waits for a reviewer', () => { const r = qualify(base({ fraudAction: 'HOLD' }), RULES); expect(r.result).toBe('PENDING'); expect(r.checks.find((c) => c.key === 'FRAUD')?.state).toBe('PENDING'); });
    it('reject beats pending', () => { expect(qualify(base({ fraudAction: 'HOLD', referee: { phoneVerified: false, existingPatientBeforeClaim: false, phoneSeenOnOtherAccount: false } }, { completedAt: NOW }), RULES).result).toBe('REJECTED'); });
  });

  describe('repeat bookings (off by default)', () => {
    const on = { ...RULES, repeatBonus: { count: 2, windowDays: 90 } };
    const first = new Date('2026-10-01T00:00:00Z');
    it('count 0 never issues', () => { expect(repeatEligible(RULES, { completedAfterFirst: 0, firstCompletedAt: first, bookingCompletedAt: new Date(first.getTime() + DAY) })).toBe(false); });
    it.each([[0, 10, true], [1, 10, true], [2, 10, false], [0, 90, true], [0, 91, false]])('already %d, %d days later -> %s', (n, days, ok) => {
      expect(repeatEligible(on, { completedAfterFirst: n, firstCompletedAt: first, bookingCompletedAt: new Date(first.getTime() + days * DAY) })).toBe(ok);
    });
  });
});
