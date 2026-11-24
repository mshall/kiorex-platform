import { ENTRY_META, evaluateContinuity, lagBucket, lagHoursBetween, pickParent, entryKindOfProduct, isEntryKind, type ParentCandidate } from './continuity-rules';
import { factRef } from './continuity-refs';

const at = new Date('2027-02-01T12:00:00Z');
const H = 3_600_000; const D = 24 * H;
const c = (o: Partial<ParentCandidate> & { id: string }): ParentCandidate => ({ clinicId: 'clin_1', startsAt: new Date(at.getTime() - 2 * H), status: 'COMPLETED', dependantId: null, ...o });

describe('continuity rules (ADR-056 proposed): rule vectors', () => {
  it('rule 2: through an entry point with a parent, a non-provider downstream fact is CROSS_PRODUCT and the link is recorded', () => {
    for (const own of ['MARKETPLACE', 'UNATTRIBUTED']) expect(evaluateContinuity({ flagOn: true, consent: true, hasParent: true, ownOrigin: own, parentOrigin: 'MARKETPLACE' })).toMatchObject({ linked: true, origin: 'CROSS_PRODUCT', reason: 'CONTINUITY_ENTRY_POINT' });
  });
  it('rule 1: own PROVIDER_LED evidence still wins (the origin stays PROVIDER_LED) and the link is still recorded for the funnel', () => {
    expect(evaluateContinuity({ flagOn: true, consent: true, hasParent: true, ownOrigin: 'PROVIDER_LED', parentOrigin: 'UNATTRIBUTED' })).toMatchObject({ linked: true, origin: 'PROVIDER_LED', reason: 'OWN_PROVIDER_EVIDENCE' });
  });
  it('rule 3: a PROVIDER_LED first booking is remembered as the parent origin (a future rate may exempt it); no charge is computed here', () => {
    const v = evaluateContinuity({ flagOn: true, consent: true, hasParent: true, ownOrigin: 'UNATTRIBUTED', parentOrigin: 'PROVIDER_LED' });
    expect(v).toMatchObject({ parentOrigin: 'PROVIDER_LED', providerLedProtected: true });
    expect(Object.keys(v).sort()).toEqual(['linked', 'origin', 'parentOrigin', 'providerLedProtected', 'reason']); // no amount, rate or charge field
  });
  it('no flag, no consent, or no parent: independent decision, no link (the order is attributed on its own evidence)', () => {
    expect(evaluateContinuity({ flagOn: false, consent: true, hasParent: true, ownOrigin: 'MARKETPLACE', parentOrigin: 'MARKETPLACE' })).toMatchObject({ linked: false, origin: 'MARKETPLACE', reason: 'FLAG_OFF' });
    expect(evaluateContinuity({ flagOn: true, consent: false, hasParent: true, ownOrigin: 'MARKETPLACE', parentOrigin: 'MARKETPLACE' })).toMatchObject({ linked: false, reason: 'NO_CONSENT' });
    expect(evaluateContinuity({ flagOn: true, consent: true, hasParent: false, ownOrigin: 'UNATTRIBUTED', parentOrigin: null })).toMatchObject({ linked: false, origin: 'UNATTRIBUTED', reason: 'NO_PARENT' });
  });
  it('an unknown parent origin never leaks into the link', () => {
    expect(evaluateContinuity({ flagOn: true, consent: true, hasParent: true, ownOrigin: 'MARKETPLACE', parentOrigin: 'CROSS_PRODUCT' }).parentOrigin).toBeNull();
  });
});

describe('parent booking choice', () => {
  it('the latest attended booking of the same clinic within the look-back window, never a dependant, a cancelled or a no-show booking', () => {
    const rows = [c({ id: 'a', startsAt: new Date(at.getTime() - 3 * D) }), c({ id: 'b', startsAt: new Date(at.getTime() - 1 * D) }), c({ id: 'dep', startsAt: new Date(at.getTime() - H), dependantId: 'd1' }), c({ id: 'x', startsAt: new Date(at.getTime() - H), status: 'CANCELLED' }), c({ id: 'ns', startsAt: new Date(at.getTime() - H), status: 'NO_SHOW' }), c({ id: 'other', clinicId: 'clin_2', startsAt: new Date(at.getTime() - H) })];
    expect(pickParent(rows, { at, lookbackDays: 7, clinicId: 'clin_1' })?.id).toBe('b');
    expect(pickParent(rows, { at, lookbackDays: 7 })?.id).toBe('other'); // clinic unknown: the latest attended booking of the person
    expect(pickParent(rows, { at, lookbackDays: 0.5, clinicId: 'clin_1' })).toBeNull();
  });
  it('a booking more than a day after the share is not its parent; ties break on id', () => {
    expect(pickParent([c({ id: 'late', startsAt: new Date(at.getTime() + 2 * D) })], { at, lookbackDays: 7 })).toBeNull();
    expect(pickParent([c({ id: 'z', startsAt: at }), c({ id: 'a', startsAt: at })], { at, lookbackDays: 7 })?.id).toBe('a');
  });
});

describe('lag, entry kinds and hashed references', () => {
  it('lag is whole hours, never negative, bucketed', () => {
    expect(lagHoursBetween(at, new Date(at.getTime() + 5 * H + 59_000))).toBe(5);
    expect(lagHoursBetween(at, new Date(at.getTime() - H))).toBe(0);
    expect([23, 24, 71, 72, 167, 168].map(lagBucket)).toEqual(['LT_24H', 'D1_3', 'D1_3', 'D3_7', 'D3_7', 'GT_7D']);
  });
  it('every entry kind maps to exactly one product and fact kind; the home visit needs both home flags', () => {
    expect(Object.values(ENTRY_META).map((m) => m.toProduct).sort()).toEqual(['LAB', 'NURSE', 'PHARMACY']);
    expect(entryKindOfProduct('NURSE')).toBe('CARE_PLAN_TO_HOME_VISIT');
    expect(ENTRY_META.CARE_PLAN_TO_HOME_VISIT.gateFlags).toEqual(['kiorex.home_visits', 'nurse.care_plans']);
    expect(isEntryKind('RX_TO_PHARMACY')).toBe(true); expect(isEntryKind('x')).toBe(false);
  });
  it('a reference hash is 32 hex, stable, kind-separated and does not contain the id', () => {
    const r = factRef('RX', 'enc_123');
    expect(r).toMatch(/^[a-f0-9]{32}$/); expect(factRef('RX', 'enc_123')).toBe(r);
    expect(factRef('LAB_ORDER', 'enc_123')).not.toBe(r); expect(r).not.toContain('enc');
  });
});
