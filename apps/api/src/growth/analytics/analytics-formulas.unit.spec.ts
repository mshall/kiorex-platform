import { anpFeeBearing, anpTotal, blendedCac, bookingToAttended, campaignVerdict, feeRevenue, kiorexRevenue, ltvMinor, ltvToCac, mer, pct, providerLedShare, roas } from './formulas';
import { applyKAnonymity, K_MIN, maskCount, maskTotal } from './kanon';

describe('KX-32 formulas: worked examples of section 08 (arithmetic on stated assumptions, not forecasts)', () => {
  it('month 6: 341 tenants, 20% listed, 1.5 per tenant, 4 ANP each, p 50% => 409, 205 fee bearing, EGP 7,872', () => {
    const anp = anpTotal({ tenants: 341, listedShare: 0.2, listedPerTenant: 1.5, anpPerListed: 4 });
    expect(anp).toBe(409);
    expect(anpFeeBearing(anp, 0.5)).toBe(205);
    expect(feeRevenue(205, 4000, 0.04)).toBe(787_200); // EGP 7,872.00 in piastres
  });
  it('month 12: 857 tenants, 45%, 8 ANP, p 40% => 4,628, 2,777 fee bearing, EGP 106,637', () => {
    const anp = anpTotal({ tenants: 857, listedShare: 0.45, listedPerTenant: 1.5, anpPerListed: 8 });
    expect(anp).toBe(4628);
    expect(anpFeeBearing(anp, 0.4)).toBe(2777);
    expect(Math.round(feeRevenue(2777, 4000, 0.04) / 100)).toBe(106_637);
  });
  it('LTV on the fee alone is about EGP 38 (40 * 96%); a paid CAC at or below it pays back; guardrails 3 / 1', () => {
    expect(ltvMinor(4000, 0.04)).toBe(3840);
    expect(ltvMinor(4000, 0.04, 500)).toBe(4340); // Pay margin only once measured
    expect(ltvToCac(3840, 1280)).toBe(3); expect(campaignVerdict(3)).toBe('SCALE');
    expect(campaignVerdict(1.2)).toBe('SUSTAIN'); expect(campaignVerdict(0.5)).toBe('REVIEW'); expect(campaignVerdict(ltvToCac(3840, 0))).toBe('NO_DATA');
  });
  it('CAC, ROAS and MER use spend and Kiorex revenue, never GBV; zero denominators are null', () => {
    expect(blendedCac(15_000_000, 409)).toBeCloseTo(36_674.8, 1); // EGP 150,000 over 409 ANP = EGP 366.7: above one fee (KX-32 risk box)
    expect(roas(787_200, 1_500_000)).toBeCloseTo(0.5248, 4);
    expect(mer(787_200, 15_000_000)).toBeCloseTo(0.0525, 4);
    expect(blendedCac(100, 0)).toBeNull(); expect(blendedCac(0, 409)).toBeNull(); expect(roas(100, 0)).toBeNull(); expect(mer(0, 0)).toBeNull();
  });
  it('provider-led share is over all three origins; conversion helpers', () => {
    expect(providerLedShare({ providerLed: 35, marketplace: 55, unattributed: 10 })).toBe(0.35);
    expect(providerLedShare({ providerLed: 0, marketplace: 0, unattributed: 0 })).toBeNull();
    expect(bookingToAttended(75, 100)).toBe(0.75); expect(pct(8, 100)).toBe(8);
  });
});

describe('Kiorex revenue is charges net of reversals: GBV, credits, taxes and settlements can never be counted', () => {
  it('counts CONFIRMED and BILLED only, subtracts reversals, reports PENDING separately, ignores WAIVED and DISPUTED', () => {
    const r = kiorexRevenue([
      { kind: 'CHARGE', status: 'CONFIRMED', amountMinor: 4000 }, { kind: 'CHARGE', status: 'BILLED', amountMinor: 4000 }, { kind: 'CHARGE', status: 'PENDING', amountMinor: 4000 },
      { kind: 'CHARGE', status: 'WAIVED', amountMinor: 4000 }, { kind: 'CHARGE', status: 'DISPUTED', amountMinor: 4000 }, { kind: 'REVERSAL', status: 'REVERSED', amountMinor: 4000 },
    ]);
    expect(r).toEqual({ revenueMinor: 4000, chargedMinor: 8000, reversedMinor: 4000, pendingMinor: 4000 });
  });
  it('the revenue function takes charge facts only: a booking value has no way in (type and shape)', () => {
    // @ts-expect-error a booking fee is not a ChargeFact
    kiorexRevenue([{ feeMinor: 50_000, status: 'CONFIRMED' }]);
    expect(kiorexRevenue([]).revenueMinor).toBe(0);
  });
});

describe('k-anonymity (k >= 10)', () => {
  it('masks counts of 1..9, keeps 0 and >= 10', () => {
    expect([0, 1, 9, 10, 11].map(maskCount)).toEqual([0, '<10', '<10', 10, 11]);
    expect(K_MIN).toBe(10);
  });
  it('a masked cell carries no value; a ratio or money figure of a masked cell is masked too', () => {
    const [a, b] = applyKAnonymity([{ key: 'a', count: 4, values: { revenue: 160_00 } }, { key: 'b', count: 25, values: { revenue: 1000_00 } }, { key: 'c', count: 40 }], { totalShown: false });
    expect(a).toMatchObject({ count: '<10', masked: true, values: { revenue: '<10' } });
    expect(b).toMatchObject({ count: 25, masked: false, values: { revenue: 100_000 } });
  });
  it('differencing: with one small cell and a total, the smallest visible cell is masked too; two small cells need no extra', () => {
    const one = applyKAnonymity([{ key: 'a', count: 3 }, { key: 'b', count: 12 }, { key: 'c', count: 30 }]);
    expect(one.map((c) => c.masked)).toEqual([true, true, false]);
    const two = applyKAnonymity([{ key: 'a', count: 3 }, { key: 'b', count: 2 }, { key: 'c', count: 30 }]);
    expect(two.map((c) => c.masked)).toEqual([true, true, false]);
    const none = applyKAnonymity([{ key: 'a', count: 10 }, { key: 'b', count: 12 }]);
    expect(none.every((c) => !c.masked)).toBe(true);
  });
  it('a single aggregate under 10 is masked with its money and ratios', () => {
    expect(maskTotal(9, { revenue: 4000, cac: 1.5 })).toEqual({ count: '<10', masked: true, values: { revenue: '<10', cac: '<10' } });
    expect(maskTotal(10, { revenue: 4000, cac: null })).toEqual({ count: 10, masked: false, values: { revenue: 4000, cac: null } });
    expect(maskTotal(0)).toMatchObject({ count: 0, masked: false });
  });
});
