import { CORPORATE_POLICY_DEFAULTS, mergeCorporatePolicy, validateCorporatePolicy } from './corporate-config';

describe('CORPORATE_POLICY (GRW-P4-C)', () => {
  it('the defaults validate, hold no price and keep the floor', () => {
    const d = CORPORATE_POLICY_DEFAULTS();
    expect(validateCorporatePolicy(d).errors).toEqual([]);
    expect(d.minAggregateK).toBe(10);
    expect(JSON.stringify(d)).not.toMatch(/minor|ceiling|price|amount|discount/i);
  });
  it('rejects unknown keys, a floor below 10, bad enums and out-of-range values', () => {
    for (const bad of [{ x: 1 }, { minAggregateK: 9 }, { minAggregateK: 5000 }, { fundingMode: 'WALLET' }, { codeFormat: { length: 4 } }, { codeFormat: { groupSize: 9 } }, { hrList: { matchWindowDays: 0 } }, { hrList: { matchWindowDays: 91 } }, { hrList: { maxRows: 0 } }, { eligibility: { openCode: 'yes' } }, { eligibility: { extra: true } }, [], 'x', null])
      expect(validateCorporatePolicy(bad).errors.length).toBeGreaterThan(0);
  });
  it('merge keeps the defaults for anything not given, never lets k fall below 10 and ignores an invalid override entirely', () => {
    const d = CORPORATE_POLICY_DEFAULTS();
    expect(mergeCorporatePolicy(d, { hrList: { matchWindowDays: 14 } }).hrList).toEqual({ matchWindowDays: 14, maxRows: d.hrList.maxRows });
    expect(mergeCorporatePolicy(d, { minAggregateK: 20 }).minAggregateK).toBe(20);
    expect(mergeCorporatePolicy(d, { minAggregateK: 3 })).toEqual(d);
    expect(mergeCorporatePolicy(d, { eligibility: { hrList: false } }).eligibility).toEqual({ openCode: true, domainEmail: true, hrList: false });
  });
});
