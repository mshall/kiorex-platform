import { GOODWILL_REASONS, checkGoodwill } from './goodwill-limits';
import { toRewardRules } from './reward-rules';

const g = toRewardRules(undefined).credit.goodwill; // PROPOSED defaults: daily 50,000, per patient 90d 20,000, per reason 10,000, approval above 5,000
const ok = { actorGrantedTodayMinor: 0, patientGranted90dMinor: 0, actorIsTarget: false };
const req = { reason: 'LONG_WAIT', amountMinor: 3000, ticketRef: 'T-1' };

describe('goodwill limits (pure)', () => {
  it('accepts a small grant with a reference and says whether a second approver is needed', () => {
    expect(checkGoodwill(g, req, ok)).toEqual({ ok: true, needsSecondApprover: false });
    expect(checkGoodwill(g, { ...req, amountMinor: 5000 }, ok)).toEqual({ ok: true, needsSecondApprover: false }); // the threshold itself needs none
    expect(checkGoodwill(g, { ...req, amountMinor: 5001 }, ok)).toEqual({ ok: true, needsSecondApprover: true });
  });
  it.each([
    ['a reason outside the closed list', { ...req, reason: 'OTHER' }, ok, 'REASON_NOT_ALLOWED'],
    ['no booking or ticket reference', { reason: 'LONG_WAIT', amountMinor: 3000 }, ok, 'REFERENCE_REQUIRED'],
    ['zero', { ...req, amountMinor: 0 }, ok, 'AMOUNT_INVALID'], ['a fraction', { ...req, amountMinor: 10.5 }, ok, 'AMOUNT_INVALID'], ['a negative amount', { ...req, amountMinor: -1 }, ok, 'AMOUNT_INVALID'],
    ['above the per-reason maximum', { ...req, amountMinor: 10_001 }, ok, 'REASON_MAX_EXCEEDED'],
    ['the agent daily cap', req, { ...ok, actorGrantedTodayMinor: 47_001 }, 'AGENT_DAILY_CAP'],
    ['the patient 90-day cap', req, { ...ok, patientGranted90dMinor: 17_001 }, 'PATIENT_90D_CAP'],
    ['a grant to the agent\'s own or a related account', req, { ...ok, actorIsTarget: true }, 'SELF_GRANT'],
  ])('refuses %s', (_n, r, f, code) => { expect(checkGoodwill(g, r as any, f)).toEqual({ ok: false, code }); });
  it('boundaries: exactly at the caps is allowed, one more is not', () => {
    expect(checkGoodwill(g, { ...req, amountMinor: 3000 }, { ...ok, actorGrantedTodayMinor: 47_000 }).ok).toBe(true);
    expect(checkGoodwill(g, { ...req, amountMinor: 3000 }, { ...ok, patientGranted90dMinor: 17_000 }).ok).toBe(true);
    expect(checkGoodwill(g, { ...req, amountMinor: 10_000 }, ok).ok).toBe(true);
  });
  it('a reason removed from the rules is refused even if it is in the closed list', () => {
    expect(checkGoodwill({ ...g, reasons: ['LONG_WAIT'] }, { ...req, reason: 'FAILED_BOOKING' }, ok)).toEqual({ ok: false, code: 'REASON_NOT_ALLOWED' });
  });
  it('the closed list matches the contract reasons', () => { expect([...GOODWILL_REASONS]).toEqual(['PROVIDER_LATE_CANCEL', 'LONG_WAIT', 'FAILED_BOOKING', 'PAYMENT_ISSUE', 'OTHER_APPROVED']); });
  it('the support checks run in the stated order: self grant first, then reason, reference, amount, caps', () => {
    expect(checkGoodwill(g, { reason: 'X', amountMinor: -5 }, { ...ok, actorIsTarget: true })).toEqual({ ok: false, code: 'SELF_GRANT' });
    expect(checkGoodwill(g, { reason: 'X', amountMinor: -5 }, ok)).toEqual({ ok: false, code: 'REASON_NOT_ALLOWED' });
    expect(checkGoodwill(g, { reason: 'LONG_WAIT', amountMinor: -5 }, ok)).toEqual({ ok: false, code: 'REFERENCE_REQUIRED' });
  });
});
