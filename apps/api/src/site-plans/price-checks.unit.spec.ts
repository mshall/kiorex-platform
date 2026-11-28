import { catalogueWarnings, cents, priceWarnings, type PriceRow } from './price-checks';

const d = (s: string) => new Date(s);
const row = (o: Partial<PriceRow>): PriceRow => ({ product: 'CLINIC', planKey: 'LITE', planOrder: 10, market: 'EG', interval: 'MONTHLY', unit: 'PER_TENANT', amount: '100.00', currency: 'EGP', validFrom: d('2026-01-01'), validTo: null, ...o });
const cand = (o: Record<string, unknown> = {}) => ({ product: 'CLINIC' as const, planKey: 'LITE', planOrder: 10, market: 'EG', interval: 'MONTHLY' as const, unit: 'PER_TENANT', amount: '100.00', currency: 'EGP', effectiveFrom: d('2027-01-01'), ...o });
const codes = (c: ReturnType<typeof cand>, rows: PriceRow[]) => priceWarnings(c, rows).map((w) => w.code);

describe('plan price advisory checks (warn, never block)', () => {
  it('cents parses amounts exactly', () => { expect(cents('499')).toBe(49900); expect(cents('499.5')).toBe(49950); expect(cents('0.07')).toBe(7); });
  it('a first price in an empty catalogue raises nothing', () => { expect(codes(cand(), [])).toEqual([]); });
  it('annual at or below the monthly price warns (the "499 per month vs 999 per year" kind of case is caught the other way round too)', () => {
    const monthly = row({ amount: '499.00' });
    expect(codes(cand({ interval: 'ANNUAL', amount: '499.00' }), [monthly])).toEqual(['ANNUAL_NOT_ABOVE_MONTHLY']);
    expect(codes(cand({ interval: 'ANNUAL', amount: '300' }), [monthly])).toEqual(['ANNUAL_NOT_ABOVE_MONTHLY']);
    expect(codes(cand({ interval: 'ANNUAL', amount: '4990' }), [monthly])).toEqual([]);
    expect(codes(cand({ interval: 'ANNUAL', amount: '5988' }), [monthly])).toEqual([]);
    expect(codes(cand({ interval: 'ANNUAL', amount: '5988.01' }), [monthly])).toEqual(['ANNUAL_ABOVE_TWELVE_MONTHS']);
    // raising the monthly price above an existing annual price is the same inconsistency
    const annual = row({ interval: 'ANNUAL', amount: '999.00' });
    expect(codes(cand({ interval: 'MONTHLY', amount: '1299' }), [annual])).toEqual(['ANNUAL_NOT_ABOVE_MONTHLY']);
  });
  it('compares only the same plan, market, unit and currency', () => {
    const rows = [row({ amount: '499', planKey: 'PRO', planOrder: 20 }), row({ amount: '499', market: 'SA' }), row({ amount: '499', unit: 'PER_CLINICIAN' }), row({ amount: '499', currency: 'USD' })];
    expect(codes(cand({ interval: 'ANNUAL', amount: '10' }), rows)).toEqual([]);
  });
  it('a higher plan cheaper than a lower plan, and the reverse, warn', () => {
    const rows = [row({ planKey: 'PRO', planOrder: 20, amount: '500' }), row({ planKey: 'CHAIN', planOrder: 30, amount: '900' })];
    expect(codes(cand({ planKey: 'LITE', planOrder: 10, amount: '600' }), rows)).toEqual(['LOWER_PLAN_DEARER']);
    expect(codes(cand({ planKey: 'CHAIN', planOrder: 30, amount: '400' }), rows)).toEqual(['HIGHER_PLAN_CHEAPER', 'BIG_CHANGE']);
    expect(codes(cand({ planKey: 'LITE', planOrder: 10, amount: '100' }), rows)).toEqual([]);
  });
  it('a big change, a zero price, a currency change and a priced free edition warn', () => {
    const cur = [row({ amount: '100' })];
    expect(codes(cand({ amount: '151' }), cur)).toEqual(['BIG_CHANGE']);
    expect(codes(cand({ amount: '49' }), cur)).toEqual(['BIG_CHANGE']);
    expect(codes(cand({ amount: '150' }), cur)).toEqual([]);
    expect(codes(cand({ amount: '0' }), [])).toEqual(['ZERO_AMOUNT']);
    expect(codes(cand({ currency: 'USD', amount: '100' }), cur)).toEqual(['CURRENCY_CHANGED']);
    expect(codes(cand({ product: 'PHARMACY', planKey: 'LITE' }), [])).toEqual(['FREE_EDITION_PRICED']);
    expect(codes(cand({ product: 'PHARMACY', planKey: 'PRO' }), [])).toEqual([]);
  });
  it('uses the version in force at the start, or the next scheduled one when none is yet', () => {
    const scheduled = row({ validFrom: d('2028-01-01'), amount: '499' });
    expect(codes(cand({ interval: 'ANNUAL', amount: '400', effectiveFrom: d('2027-01-01') }), [scheduled])).toEqual(['ANNUAL_NOT_ABOVE_MONTHLY']);
    const ended = row({ validTo: d('2026-06-01'), amount: '499' });
    expect(codes(cand({ interval: 'ANNUAL', amount: '400' }), [ended])).toEqual([]);
  });
  it('flags an inconsistent catalogue as it stands (annual at or below monthly), cohort prices excluded', () => {
    const rows = [row({ planKey: 'PRO', amount: '1299' }), row({ planKey: 'PRO', interval: 'ANNUAL', amount: '999' }), row({ planKey: 'LITE', amount: '499' }), row({ planKey: 'LITE', interval: 'ANNUAL', amount: '4990' }), row({ planKey: 'CLINIC', interval: 'ANNUAL', amount: '1', cohortKey: 'founding' })];
    const w = catalogueWarnings(rows, d('2026-12-01'));
    expect(w.map((x) => `${x.planKey}:${x.code}`)).toEqual(['PRO:ANNUAL_NOT_ABOVE_MONTHLY']);
  });
});
