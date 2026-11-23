import { computePartialSettlement, depositFromPolicy, majorToMinor, minorExponent } from './policy.calc';
import { DEPOSIT_DEFAULT, PARTIAL_FULFILMENT, PROPOSED_DEFAULT_NOTE } from './policy.defaults';

describe('PROPOSED_DEFAULT policies (founder-delegated 23 Nov 2026)', () => {
  it('are marked and carry the agreed values', () => {
    expect(PROPOSED_DEFAULT_NOTE).toBe('PROPOSED_DEFAULT delegated by founder 23 Nov 2026');
    expect(DEPOSIT_DEFAULT.defaults).toEqual({ enabled: true, percentBps: 1000, capMajor: 200 });
    expect(PARTIAL_FULFILMENT.defaults).toEqual({ mode: 'PRO_RATA_REFUND', refundDeliveryFeeIfNotDelivered: true, releaseFulfilledToPharmacy: true });
  });
  it('validators reject malformed overrides', () => {
    expect(() => DEPOSIT_DEFAULT.validate({ enabled: true, percentBps: 10001, capMajor: 10 })).toThrow();
    expect(() => DEPOSIT_DEFAULT.validate({ enabled: 'yes', percentBps: 10, capMajor: 10 })).toThrow();
    expect(() => PARTIAL_FULFILMENT.validate({ mode: 'EVERYTHING', refundDeliveryFeeIfNotDelivered: true, releaseFulfilledToPharmacy: true })).toThrow();
    expect(DEPOSIT_DEFAULT.validate({ enabled: false, percentBps: 500, capMajor: 0 })).toEqual({ enabled: false, percentBps: 500, capMajor: 0 });
  });
});

describe('depositFromPolicy (percent of the fee, cap in major units, minor-unit correct)', () => {
  const p = { enabled: true, percentBps: 1000, capMajor: 200 };
  it('EGP: 10% of 300 EGP = 3000 piastres; capped at 200 EGP = 20000 piastres', () => {
    expect(depositFromPolicy(30000, 'EGP', p)).toBe(3000);
    expect(depositFromPolicy(300000, 'EGP', p)).toBe(20000);
    expect(depositFromPolicy(200000, 'EGP', p)).toBe(20000); // exactly at the cap
  });
  it('currency exponents: KWD (3) cap = 200000 fils, JPY (0) cap = 200 yen', () => {
    expect(minorExponent('KWD')).toBe(3); expect(minorExponent('JPY')).toBe(0); expect(minorExponent('XXX')).toBe(2);
    expect(majorToMinor(200, 'KWD')).toBe(200000);
    expect(depositFromPolicy(5_000_000, 'KWD', p)).toBe(200000);
    expect(depositFromPolicy(10_000, 'JPY', p)).toBe(200);
  });
  it('0 when disabled, no fee, or no percentage; never above the fee; rounds to the nearest minor unit', () => {
    expect(depositFromPolicy(30000, 'EGP', { ...p, enabled: false })).toBe(0);
    expect(depositFromPolicy(null, 'EGP', p)).toBe(0); expect(depositFromPolicy(0, 'EGP', p)).toBe(0);
    expect(depositFromPolicy(30000, 'EGP', { ...p, percentBps: 0 })).toBe(0);
    expect(depositFromPolicy(1000, 'EGP', { enabled: true, percentBps: 10000, capMajor: 0 })).toBe(1000); // capMajor 0 = no cap, still <= fee
    expect(depositFromPolicy(12345, 'EGP', p)).toBe(1235); // 1234.5 -> 1235
  });
});

describe('computePartialSettlement (pro-rata refund of rejected / unavailable lines)', () => {
  const items = [{ sku: 'A', name: 'Panadol', nameAr: 'بنادول', qty: 3, unitPriceMinor: 2500 }, { sku: 'B', name: 'Amoxil', qty: 1, unitPriceMinor: 8000 }];
  const pol = { refundDeliveryFeeIfNotDelivered: true };
  it('refunds the price of the undispensed quantity, keeps fulfilled goods and the delivery fee when delivered', () => {
    const r = computePartialSettlement({ items, deliveryMethod: 'DELIVERY', deliveryFeeMinor: 3000, dispensed: [{ sku: 'A', quantityDispensed: 1 }, { sku: 'B', quantityDispensed: 1 }] }, pol);
    expect(r.lines[0]).toMatchObject({ sku: 'A', qtyOrdered: 3, qtyFulfilled: 1, qtyRefunded: 2, refundMinor: 5000, nameAr: 'بنادول' });
    expect(r).toMatchObject({ goodsRefundMinor: 5000, deliveryFeeRefundMinor: 0, refundTotalMinor: 5000, fulfilledGoodsMinor: 10500, keptMinor: 13500, nothingFulfilled: false });
  });
  it('a sku the pharmacy did not report counts as not dispensed; quantities are clamped to 0..ordered', () => {
    const r = computePartialSettlement({ items, deliveryMethod: 'PICKUP', deliveryFeeMinor: 0, dispensed: [{ sku: 'A', quantityDispensed: 99 }] }, pol);
    expect(r.lines.map((l) => [l.qtyFulfilled, l.qtyRefunded])).toEqual([[3, 0], [0, 1]]);
    expect(r.refundTotalMinor).toBe(8000);
  });
  it('delivery fee is refunded when the delivery is not made (deliveryMade=false) or nothing was dispensed, only for DELIVERY and only if the policy says so', () => {
    const d = { items, deliveryMethod: 'DELIVERY', deliveryFeeMinor: 3000, dispensed: [{ sku: 'A', quantityDispensed: 3 }] };
    expect(computePartialSettlement({ ...d, deliveryMade: false }, pol)).toMatchObject({ deliveryFeeRefundMinor: 3000, refundTotalMinor: 8000 + 3000, keptMinor: 7500 });
    expect(computePartialSettlement({ ...d, deliveryMade: false }, { refundDeliveryFeeIfNotDelivered: false }).deliveryFeeRefundMinor).toBe(0);
    expect(computePartialSettlement({ ...d, deliveryMethod: 'PICKUP', deliveryMade: false }, pol).deliveryFeeRefundMinor).toBe(0);
    const none = computePartialSettlement({ items, deliveryMethod: 'DELIVERY', deliveryFeeMinor: 3000, dispensed: [] }, pol);
    expect(none).toMatchObject({ nothingFulfilled: true, refundTotalMinor: 7500 + 8000 + 3000, keptMinor: 0 });
  });
  it('refund + kept always equals what was charged (no minor unit lost or invented)', () => {
    for (const a of [0, 1, 2, 3]) for (const b of [0, 1]) {
      const r = computePartialSettlement({ items, deliveryMethod: 'DELIVERY', deliveryFeeMinor: 3000, dispensed: [{ sku: 'A', quantityDispensed: a }, { sku: 'B', quantityDispensed: b }] }, pol);
      expect(r.refundTotalMinor + r.keptMinor).toBe(3 * 2500 + 8000 + 3000);
    }
  });
});
