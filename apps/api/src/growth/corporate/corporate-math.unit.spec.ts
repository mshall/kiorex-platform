import { benefitFor } from './corporate-math';

const base = { depositMinor: 20000, coverBp: 5000, perVisitMaxMinor: null, memberRemainingMinor: 100000, accountRemainingMinor: 1000000 };
describe('corporate benefit size (GRW-P4-C)', () => {
  it('is the share of the deposit when no other bound bites', () => expect(benefitFor(base)).toBe(10000));
  it('is bounded by the per-visit maximum, the member remainder and the account remainder', () => {
    expect(benefitFor({ ...base, perVisitMaxMinor: 3000 })).toBe(3000);
    expect(benefitFor({ ...base, memberRemainingMinor: 2500 })).toBe(2500);
    expect(benefitFor({ ...base, accountRemainingMinor: 1200 })).toBe(1200);
  });
  it('never covers the whole deposit: the card keeps at least one minor unit', () => { expect(benefitFor({ ...base, coverBp: 10000 })).toBe(19999); expect(benefitFor({ ...base, coverBp: 10000, minCardMinor: 500 })).toBe(19500); });
  it('rounds the share down (never above the share of the deposit)', () => expect(benefitFor({ ...base, depositMinor: 10001, coverBp: 3333 })).toBe(3333));
  it('is zero for missing terms, an empty remainder or a tiny deposit', () => {
    expect(benefitFor({ ...base, coverBp: null })).toBe(0); expect(benefitFor({ ...base, coverBp: 0 })).toBe(0); expect(benefitFor({ ...base, coverBp: 10001 })).toBe(0);
    expect(benefitFor({ ...base, memberRemainingMinor: 0 })).toBe(0); expect(benefitFor({ ...base, accountRemainingMinor: 0 })).toBe(0);
    expect(benefitFor({ ...base, depositMinor: 1 })).toBe(0); expect(benefitFor({ ...base, depositMinor: 0 })).toBe(0); expect(benefitFor({ ...base, perVisitMaxMinor: 0 })).toBe(0);
  });
  it('refuses fractional or negative amounts', () => { expect(() => benefitFor({ ...base, depositMinor: 1.5 })).toThrow(RangeError); expect(() => benefitFor({ ...base, memberRemainingMinor: -1 })).toThrow(RangeError); });
  it('property: the benefit is an integer, never above any bound and never leaves the card below one unit', () => {
    let s = 12345; const r = (n: number) => { s = (s * 1103515245 + 12345) % 2147483648; return s % n; };
    for (let i = 0; i < 2000; i++) {
      const i1 = { depositMinor: r(500000), coverBp: 1 + r(10000), perVisitMaxMinor: r(2) ? r(300000) : null, memberRemainingMinor: r(400000), accountRemainingMinor: r(900000) };
      const b = benefitFor(i1);
      expect(Number.isInteger(b)).toBe(true); expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(i1.memberRemainingMinor); expect(b).toBeLessThanOrEqual(i1.accountRemainingMinor); expect(b).toBeLessThanOrEqual(Math.floor((i1.depositMinor * i1.coverBp) / 10000));
      if (i1.perVisitMaxMinor !== null) expect(b).toBeLessThanOrEqual(i1.perVisitMaxMinor);
      if (i1.depositMinor > 0) expect(i1.depositMinor - b).toBeGreaterThanOrEqual(1);
    }
  });
});
