import { blendedCacWithRewards, cpc, cpm, ctrPct, guardRatio, installToRegistration, reconcileSpend, registrationToFirstBooking, SPEND_FLOOR_MINOR } from './formulas';

describe('GRW-P2-F formulas', () => {
  it('unit costs print null, not zero or infinity, without a denominator', () => { expect(cpc(10_000, 0)).toBeNull(); expect(cpc(0, 10)).toBeNull(); expect(cpc(10_000, 40)).toBe(250); expect(cpm(10_000, 2000)).toBe(5000); expect(ctrPct(5, 0)).toBeNull(); expect(ctrPct(5, 200)).toBe(2.5); });
  it('funnel percentages', () => { expect(installToRegistration(40, 200)).toBe(20); expect(registrationToFirstBooking(10, 40)).toBe(25); expect(installToRegistration(1, 0)).toBeNull(); });
  it('blended CAC with and without rewards', () => { expect(blendedCacWithRewards(100_000, 20_000, 12)).toBe(10_000); expect(blendedCacWithRewards(100_000, 0, 10)).toBe(10_000); expect(blendedCacWithRewards(0, 0, 10)).toBeNull(); expect(blendedCacWithRewards(100, 0, 0)).toBeNull(); });
  describe('guardRatio hides under k < 10, under the spend floor and without a denominator', () => {
    it.each([
      [5000, { people: 9, spendMinor: 1_000_000 }, null, 'K_ANONYMITY'], [5000, { people: 1, spendMinor: 1_000_000 }, null, 'K_ANONYMITY'], [5000, { people: 10, spendMinor: 1_000_000 }, 5000, null],
      [5000, { people: 50, spendMinor: SPEND_FLOOR_MINOR - 1 }, null, 'SPEND_FLOOR'], [5000, { people: 50, spendMinor: SPEND_FLOOR_MINOR }, 5000, null], [null, { people: 50, spendMinor: 100_000 }, null, 'NO_DENOMINATOR'], [5000, { people: 0, spendMinor: 100_000 }, null, 'NO_DENOMINATOR'],
    ])('%s %j', (v, g, value, hidden) => { expect(guardRatio(v as number | null, g)).toEqual({ value, hidden }); });
  });
  describe('spend reconciliation (adapter wins on conflict, with a note)', () => {
    it.each([
      [null, 100_000, 100_000, 'APPROVED', false, 'NOT_CONNECTED'], [0, 100_000, 100_000, 'APPROVED', false, 'NO_EXTERNAL_SPEND'], [120_000, 0, 120_000, 'ADAPTER', false, 'ADAPTER_ONLY'],
      [102_000, 100_000, 100_000, 'APPROVED', false, 'WITHIN_TOLERANCE'], [106_000, 100_000, 106_000, 'ADAPTER', true, 'ADAPTER_WINS'], [80_000, 100_000, 80_000, 'ADAPTER', true, 'ADAPTER_WINS'], [null, 0, 0, 'NONE', false, 'NOT_CONNECTED'],
    ])('external %s approved %s', (ext, appr, used, source, conflict, note) => { expect(reconcileSpend(ext as number | null, appr)).toMatchObject({ usedMinor: used, source, conflict, note }); });
    it('reports the delta in basis points', () => { expect(reconcileSpend(110_000, 100_000).deltaBp).toBe(1000); });
  });
});
