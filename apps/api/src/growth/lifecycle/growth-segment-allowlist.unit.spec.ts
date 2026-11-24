import { SEGMENT_ATTRIBUTES, isClinicalSegmentKey, inSegment, validatePolicySegments, validateSegmentRule, type SegmentFacts, type SegmentRule, type StrictSegment } from './lifecycle-segments';

const facts: SegmentFacts = { stage: 'DORMANT', platform: 'ios', language: 'ar', city: 'Cairo', district: 'Maadi', registeredDaysAgo: 400, lastBookingDaysAgo: 200, hasDependants: false, referralStatus: 'NONE' };

describe('lifecycle segment allowlist (runtime)', () => {
  it('accepts every allowlisted attribute', () => {
    const r = validateSegmentRule({ stage: ['DORMANT'], platform: ['ios', 'android'], language: ['ar'], city: ['Cairo'], district: ['Maadi'], registeredDaysAgo: { min: 30 }, lastBookingDaysAgo: { max: 365 }, hasDependants: false, referralStatus: ['NONE'] });
    expect(r.valid).toBe(true);
  });
  it.each([
    'specialty', 'doctor', 'clinician', 'provider', 'reason', 'visitReason', 'diagnosis', 'icd10', 'prescription', 'rx', 'medication', 'drug', 'labTest', 'pharmacyId', 'condition', 'symptom', 'insurer', 'gender', 'age', 'dateOfBirth', 'nationalId', 'lab', 'test',
  ])('rejects the clinical or identifying key "%s"', (key) => {
    const r = validateSegmentRule({ stage: ['DORMANT'], [key]: ['x'] });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors.join(' ')).toContain(`/${key}`);
  });
  it('rejects unknown keys, bad values and empty lists', () => {
    expect(validateSegmentRule({ shoeSize: 1 }).valid).toBe(false);
    expect(validateSegmentRule({ platform: ['windows'] }).valid).toBe(false);
    expect(validateSegmentRule({ language: [] }).valid).toBe(false);
    expect(validateSegmentRule({ registeredDaysAgo: { min: 10, max: 5 } }).valid).toBe(false);
    expect(validateSegmentRule({ registeredDaysAgo: { low: 1 } }).valid).toBe(false);
    expect(validateSegmentRule({ hasDependants: 'yes' }).valid).toBe(false);
    expect(validateSegmentRule([]).valid).toBe(false);
    expect(validateSegmentRule(null).valid).toBe(false);
  });
  it('the allowlist equals the contract enum and names no forbidden hint', () => {
    expect([...SEGMENT_ATTRIBUTES].sort()).toEqual(['city', 'district', 'hasDependants', 'language', 'lastBookingDaysAgo', 'platform', 'referralStatus', 'registeredDaysAgo', 'stage']);
    for (const a of SEGMENT_ATTRIBUTES) expect(isClinicalSegmentKey(a)).toBe(false);
  });
  it('policy segments: an attribute outside the allowlist is an error with its path', () => {
    expect(validatePolicySegments({ ok: { attributes: ['stage', 'platform'] } })).toEqual([]);
    expect(validatePolicySegments({ bad: { attributes: ['stage', 'specialty'] } })).toEqual(['/segments/bad/attributes: "specialty" is not an allowed segment attribute']);
    expect(validatePolicySegments({ bad: {} })).toEqual(['/segments/bad/attributes: list expected']);
  });
  it('evaluates one person; unknown facts fail a restriction; an empty rule matches nobody', () => {
    expect(inSegment({ stage: ['DORMANT'], language: ['ar'] }, facts)).toBe(true);
    expect(inSegment({ stage: ['BOOKED'] }, facts)).toBe(false);
    expect(inSegment({ city: ['Alexandria'] }, facts)).toBe(false);
    expect(inSegment({ city: ['Cairo'] }, { ...facts, city: null })).toBe(false);
    expect(inSegment({ lastBookingDaysAgo: { min: 100 } }, { ...facts, lastBookingDaysAgo: null })).toBe(false);
    expect(inSegment({ registeredDaysAgo: { min: 30, max: 500 }, hasDependants: false }, facts)).toBe(true);
    expect(inSegment({}, facts)).toBe(false);
  });
});

describe('lifecycle segment allowlist (type level)', () => {
  it('a typed segment only accepts allowlisted keys', () => {
    const ok: StrictSegment<{ stage: string[]; hasDependants: boolean }> = { stage: ['DORMANT'], hasDependants: true };
    const rule: SegmentRule = ok;
    expect(rule.stage).toEqual(['DORMANT']);
    // @ts-expect-error a clinical key is rejected by the compiler
    const bad: StrictSegment<{ stage: string[]; specialty: string[] }> = { stage: ['DORMANT'], specialty: ['x'] };
    expect(bad).toBeDefined();
    // @ts-expect-error unknown keys are rejected too
    const unknown: StrictSegment<{ doctor: string }> = { doctor: 'x' };
    expect(unknown).toBeDefined();
  });
});
