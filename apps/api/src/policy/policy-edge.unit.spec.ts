import { computePartialSettlement, depositFromPolicy } from './policy.calc';

/** EDGE 44: untrusted partner quantities and money rounding in the pro-rata refund. */
const order = { items: [{ sku: 'A', qty: 3, unitPriceMinor: 3333 }, { sku: 'B', qty: 1, unitPriceMinor: 1 }], deliveryMethod: 'PICKUP', deliveryFeeMinor: 0 };
const pol = { refundDeliveryFeeIfNotDelivered: true };

describe('computePartialSettlement with hostile partner input', () => {
  it.each([[NaN], [-5], [Infinity], [1.9], ['2' as unknown as number], [null as unknown as number], [undefined as unknown as number]])('quantityDispensed %p never yields a NaN, negative or over-refunded amount', (q) => {
    const r = computePartialSettlement({ ...order, dispensed: [{ sku: 'A', quantityDispensed: q }] }, pol);
    for (const n of [r.goodsRefundMinor, r.refundTotalMinor, r.fulfilledGoodsMinor, r.keptMinor]) expect(Number.isInteger(n)).toBe(true);
    expect(r.refundTotalMinor).toBeGreaterThanOrEqual(0);
    expect(r.refundTotalMinor + r.fulfilledGoodsMinor).toBe(3 * 3333 + 1); // refunded + fulfilled always equals what was paid
    for (const l of r.lines) { expect(l.qtyFulfilled).toBeGreaterThanOrEqual(0); expect(l.qtyFulfilled).toBeLessThanOrEqual(l.qtyOrdered); }
  });
  it('a repeated and an unknown sku never inflate the fulfilled quantity', () => {
    const r = computePartialSettlement({ ...order, dispensed: [{ sku: 'A', quantityDispensed: 2 }, { sku: 'A', quantityDispensed: 2 }, { sku: 'ZZ', quantityDispensed: 99 }] }, pol);
    expect(r.lines.find((l) => l.sku === 'A')!.qtyFulfilled).toBe(3);
    expect(r.refundTotalMinor + r.fulfilledGoodsMinor).toBe(3 * 3333 + 1);
  });
  it('the delivery fee is refunded when nothing was dispensed even if the partner says deliveryMade', () => {
    const r = computePartialSettlement({ ...order, deliveryMethod: 'DELIVERY', deliveryFeeMinor: 2500, dispensed: [], deliveryMade: true }, pol);
    expect(r.nothingFulfilled).toBe(true); expect(r.deliveryFeeRefundMinor).toBe(2500);
  });
});

describe('depositFromPolicy rounding edges', () => {
  const p = { enabled: true, percentBps: 3333, capMajor: 0 } as never;
  it('rounds half up on integer minor units and never exceeds the fee', () => {
    expect(depositFromPolicy(15_000, 'EGP', p)).toBe(5000); // 33.33 % of 150.00 = 49.995 -> 50.00
    expect(depositFromPolicy(1, 'EGP', p)).toBe(0);
    expect(depositFromPolicy(3, 'EGP', { enabled: true, percentBps: 10_000, capMajor: 0 } as never)).toBe(3);
    expect(depositFromPolicy(10_000, 'EGP', { enabled: true, percentBps: 20_000, capMajor: 0 } as never)).toBe(10_000);
  });
  it('the cap converts per currency exponent (KWD has 3 decimals, JPY none)', () => {
    expect(depositFromPolicy(1_000_000, 'KWD', { enabled: true, percentBps: 5000, capMajor: 10 } as never)).toBe(10_000);
    expect(depositFromPolicy(1_000_000, 'JPY', { enabled: true, percentBps: 5000, capMajor: 10 } as never)).toBe(10);
  });
  it('disabled, zero percent, unknown or negative fees are zero', () => {
    for (const [fee, pol] of [[15_000, { enabled: false, percentBps: 5000, capMajor: 0 }], [15_000, { enabled: true, percentBps: 0, capMajor: 0 }], [null, { enabled: true, percentBps: 5000, capMajor: 0 }], [-1, { enabled: true, percentBps: 5000, capMajor: 0 }]] as const) expect(depositFromPolicy(fee as never, 'EGP', pol as never)).toBe(0);
  });
});
