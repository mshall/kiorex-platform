import { guardTexts, normalise } from './promotion-content-guard';
import { bestOffer, discountMinor, eligibility, highValueReasons, reviewOutcome, sponsoredLabel, sponsoredPayoutHoldMinor, type PromoFacts, type QuoteFacts } from './promotion-math';

const NOW = new Date('2027-01-10T10:00:00Z');
const promo = (o: Partial<PromoFacts> = {}): PromoFacts => ({ status: 'ACTIVE', startsAt: new Date('2027-01-01T00:00:00Z'), endsAt: new Date('2027-02-01T00:00:00Z'), budgetCapMinor: 100_000, scope: { doctorIds: [], appointmentTypeIds: [], careTypes: ['IN_CLINIC'] }, discount: { kind: 'FIXED_MINOR', value: 5000 }, eligibility: { kiorexOnly: true }, ...o });
const facts = (o: Partial<QuoteFacts> = {}): QuoteFacts => ({ doctorId: 'dr1', appointmentTypeId: 't1', careType: 'IN_CLINIC', startsAt: new Date(NOW.getTime() + 48 * 3_600_000), visitFeeMinor: 30_000, isNewToClinic: true, kiorexBookingsBefore: 0, channelIsKiorex: true, ...o });

describe('discount arithmetic', () => {
  it('fixed, percent in basis points, capped by the per-booking maximum and by the visit fee', () => {
    expect(discountMinor({ kind: 'FIXED_MINOR', value: 5000 }, 30_000)).toBe(5000);
    expect(discountMinor({ kind: 'FIXED_MINOR', value: 50_000 }, 30_000)).toBe(30_000);
    expect(discountMinor({ kind: 'PERCENT_BP', value: 2000 }, 30_001)).toBe(6000);
    expect(discountMinor({ kind: 'PERCENT_BP', value: 2000, maxPerBookingMinor: 4000 }, 30_000)).toBe(4000);
    expect(discountMinor({ kind: 'PERCENT_BP', value: 10_000 }, 333)).toBe(333);
    for (const bad of [0, -5, 1.5]) expect(discountMinor({ kind: 'FIXED_MINOR', value: 100 }, bad)).toBe(0);
    expect(discountMinor({}, 1000)).toBe(0); expect(discountMinor({ kind: 'FIXED_MINOR', value: 0 }, 1000)).toBe(0);
  });
});

describe('eligibility vectors (the same table the Clinic checks at booking)', () => {
  const r = (p: Partial<PromoFacts>, f: Partial<QuoteFacts> = {}) => eligibility(promo(p), facts(f), NOW);
  it('passes a plain promotion and names every refusal', () => {
    expect(r({})).toEqual({ ok: true, amountMinor: 5000 });
    expect(r({ status: 'PAUSED' })).toEqual({ ok: false, reason: 'NOT_ACTIVE' });
    expect(r({ endsAt: new Date('2027-01-10T10:00:00Z') })).toEqual({ ok: false, reason: 'OUTSIDE_WINDOW' });
    expect(r({ startsAt: new Date('2027-01-11T00:00:00Z') })).toEqual({ ok: false, reason: 'OUTSIDE_WINDOW' });
    expect(r({ scope: { doctorIds: ['dr9'], careTypes: ['IN_CLINIC'] } })).toEqual({ ok: false, reason: 'DOCTOR' });
    expect(r({ scope: { appointmentTypeIds: ['t9'], careTypes: ['IN_CLINIC'] } })).toEqual({ ok: false, reason: 'TYPE' });
    expect(r({}, { careType: 'VIDEO' })).toEqual({ ok: false, reason: 'CARE_TYPE' });
    expect(r({}, { channelIsKiorex: false })).toEqual({ ok: false, reason: 'NOT_KIOREX' });
    expect(r({ eligibility: { newPatientsOnly: true } }, { isNewToClinic: false })).toEqual({ ok: false, reason: 'NOT_NEW_TO_CLINIC' });
    expect(r({ eligibility: { firstBookingOnly: true } }, { kiorexBookingsBefore: 1 })).toEqual({ ok: false, reason: 'NOT_FIRST_BOOKING' });
    expect(r({ eligibility: { minLeadHours: 72 } })).toEqual({ ok: false, reason: 'LEAD_TIME' });
    expect(r({}, { visitFeeMinor: 0 })).toEqual({ ok: false, reason: 'NO_FEE' });
  });
  it('one promotion per booking: the largest discount wins, ties go to the earlier end, then the lower id', () => {
    const c = (id: string, p: Partial<PromoFacts>) => ({ id, promo: promo(p) });
    expect(bestOffer([c('a', {}), c('b', { discount: { kind: 'FIXED_MINOR', value: 9000 } }), c('c', { status: 'PAUSED', discount: { kind: 'FIXED_MINOR', value: 99_000 } })], facts(), NOW)?.cand.id).toBe('b');
    expect(bestOffer([c('z', { endsAt: new Date('2027-03-01T00:00:00Z') }), c('y', { endsAt: new Date('2027-02-01T00:00:00Z') })], facts(), NOW)?.cand.id).toBe('y');
    expect(bestOffer([c('b', {}), c('a', {})], facts(), NOW)?.cand.id).toBe('a');
    expect(bestOffer([c('a', { status: 'ARCHIVED' })], facts(), NOW)).toBeNull(); expect(bestOffer([], facts(), NOW)).toBeNull();
  });
});

describe('review rules', () => {
  const P = { highValueBudgetMinor: 5_000_000, highValuePerBookingMinor: 50_000, maxDiscountBp: 3000 };
  it('high-value thresholds', () => {
    expect(highValueReasons({ budgetCapMinor: 100_000, discount: { kind: 'FIXED_MINOR', value: 5000 } }, P)).toEqual([]);
    expect(highValueReasons({ budgetCapMinor: 5_000_000, discount: { kind: 'FIXED_MINOR', value: 5000 } }, P)).toEqual(['BUDGET_AT_OR_ABOVE_THRESHOLD']);
    expect(highValueReasons({ budgetCapMinor: 100_000, discount: { kind: 'PERCENT_BP', value: 4000, maxPerBookingMinor: 1000 } }, P)).toEqual(['PERCENT_ABOVE_MAXIMUM']);
  });
  it('outcome needs every required kind, nobody approving their own request, and a different high-value approver', () => {
    const r = (kind: string, decidedBy: string | null, decision: string | null) => ({ kind, requestedBy: 'org:tn_1', decidedBy, decision });
    expect(reviewOutcome(['CONTENT', 'SCOPE'], [r('CONTENT', 'a', 'APPROVED'), r('SCOPE', 'a', 'APPROVED')])).toBe('APPROVED');
    expect(reviewOutcome(['CONTENT', 'SCOPE'], [r('CONTENT', 'a', 'APPROVED'), r('SCOPE', null, null)])).toBe('PENDING');
    expect(reviewOutcome(['CONTENT'], [r('CONTENT', 'a', 'REJECTED')])).toBe('REJECTED'); expect(reviewOutcome(['CONTENT'], [r('CONTENT', 'a', 'NEEDS_CHANGES')])).toBe('NEEDS_CHANGES');
    expect(reviewOutcome(['CONTENT'], [r('CONTENT', 'org:tn_1', 'APPROVED')])).toBe('INVALID');
    expect(reviewOutcome(['CONTENT', 'SCOPE', 'HIGH_VALUE'], [r('CONTENT', 'a', 'APPROVED'), r('SCOPE', 'a', 'APPROVED'), r('HIGH_VALUE', 'a', 'APPROVED')])).toBe('INVALID');
    expect(reviewOutcome(['CONTENT', 'SCOPE', 'HIGH_VALUE'], [r('CONTENT', 'a', 'APPROVED'), r('SCOPE', 'a', 'APPROVED'), r('HIGH_VALUE', 'b', 'APPROVED')])).toBe('APPROVED');
  });
});

describe('payout gate predicate and the patient label', () => {
  it('holds the sponsored part of a payout until the Clinic DEBIT exists; never holds a booking without a sponsored line', () => {
    expect(sponsoredPayoutHoldMinor(null)).toBe(0);
    expect(sponsoredPayoutHoldMinor({ state: 'RESERVED', amountMinor: 10_000 })).toBe(10_000); expect(sponsoredPayoutHoldMinor({ state: 'APPLIED', amountMinor: 10_000 })).toBe(10_000);
    expect(sponsoredPayoutHoldMinor({ state: 'DEBITED', amountMinor: 10_000 })).toBe(0);
    expect(sponsoredPayoutHoldMinor({ state: 'RELEASED', amountMinor: 10_000 })).toBe(0); expect(sponsoredPayoutHoldMinor({ state: 'REVERSED', amountMinor: 10_000 })).toBe(0);
  });
  it('the label says sponsored by the clinic, with the end date, in both languages', () => {
    const l = sponsoredLabel({ ar: 'عيادة النيل', en: 'Nile Clinic' }, new Date('2027-02-01T00:00:00Z'), { ar: 'x', en: 'y' });
    expect(l.en).toBe('Discount sponsored by Nile Clinic until 2027-02-01'); expect(l.ar).toBe('خصم برعاية عيادة النيل حتى 2027-02-01');
  });
});

describe('content guard (same word list as the Clinic)', () => {
  const g = (en: string, ar = 'خصم على الكشف') => guardTexts({ nameEn: en, nameAr: 'خصم', patientCopyEn: en, patientCopyAr: ar });
  it('passes plain visit-fee wording, including the Arabic word for first', () => { expect(g('A discount on the visit fee', 'خصم الزيارة الأولى برعاية العيادة').ok).toBe(true); });
  it('blocks clinical wording and outcome promises in both languages', () => {
    for (const t of ['Free treatment for new patients', 'Diabetes check discount', 'Discount on surgery', 'Best doctor in Cairo', '100% guaranteed results', 'Laser offer', 'Weight loss visit']) expect(g(t).ok).toBe(false);
    for (const a of ['علاج مجاني', 'تحاليل بخصم', 'عملية جراحية', 'نتيجه مضمونه', 'افضل دكتور', 'كشف سكر']) expect(g('Visit discount', a).ok).toBe(false);
    expect(g('Free surgery').signal).toBe('PF_CLINICAL_INDUCEMENT'); expect(g('Free booking fee').ok).toBe(true);
  });
  it('normalises Arabic spelling', () => { expect(normalise('أشعة')).toBe(normalise('اشعه')); expect(normalise('عِــلاج')).toBe(normalise('علاج')); });
});
