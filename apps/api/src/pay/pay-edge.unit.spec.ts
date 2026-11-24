import { assertPayableAmount, assertPayableCurrency, MAX_AMOUNT_MINOR, PAYABLE_CURRENCIES } from './pay.service';

/** EDGE 40 regression: amounts and currencies are validated at the money boundary (a 400, never a database overflow 500). */
describe('pay amount and currency guards', () => {
  it.each([[1], [10_001], [MAX_AMOUNT_MINOR]])('accepts %s', (n) => expect(() => assertPayableAmount(n)).not.toThrow());
  it.each([[0], [-1], [1.5], [NaN], [Infinity], [MAX_AMOUNT_MINOR + 1], [Number.MAX_SAFE_INTEGER], [Number.MAX_SAFE_INTEGER + 2], ['100'], [null], [undefined]])('rejects %p', (n) => expect(() => assertPayableAmount(n)).toThrow());
  it('accepts only uppercase ISO currencies of known markets', () => {
    expect(PAYABLE_CURRENCIES).toContain('EGP');
    for (const c of PAYABLE_CURRENCIES) expect(() => assertPayableCurrency(c)).not.toThrow();
    for (const c of ['egp', 'ZZZ', 'USD', '', 'EGPX', ' EGP', '🙂', undefined, 7]) expect(() => assertPayableCurrency(c)).toThrow();
  });
});
