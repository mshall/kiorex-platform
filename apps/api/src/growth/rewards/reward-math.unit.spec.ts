import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REWARD_IDEMPOTENCY_KEY_PATTERN } from '@kiorex/contracts';
import { allocateRefund } from '../../pay/refund-allocation';
import { composeCheckout, linesBalance } from './checkout-lines';
import { addMonths, availableOf, consumeFifo, entryKey, expireAmount, maxRedeemable, reversalSplit } from './reward-math';

// the vectors ship with kiorex-contracts (fixtures/credit-ledger-vectors.json) but not in the 1.12.0 tarball: a verbatim copy lives next to this spec, and a parity test below compares it with the sibling repo when it is present
const LOCAL = join(__dirname, 'fixtures', 'credit-ledger-vectors.json');
const vectors = JSON.parse(readFileSync(LOCAL, 'utf8'));
const SIBLING = join(__dirname, '..', '..', '..', '..', '..', '..', 'kiorex-contracts', 'fixtures', 'credit-ledger-vectors.json');
(existsSync(SIBLING) ? it : it.skip)('the local vector file is byte-identical to kiorex-contracts (skipped when the sibling repo is absent)', () => {
  expect(readFileSync(LOCAL, 'utf8')).toBe(readFileSync(SIBLING, 'utf8'));
});

describe('shared credit ledger vectors (contracts fixtures/credit-ledger-vectors.json)', () => {
  it.each(vectors.refundAllocation.map((v: any) => [v.name, v]) as Array<[string, any]>)('refund allocation: %s', (_n, v: any) => {
    const r = allocateRefund({ priceMinor: v.priceMinor, sponsoredMinor: v.sponsoredMinor, creditMinor: v.creditMinor, cardMinor: v.cardMinor, heldDepositMinor: v.heldDepositMinor, refundableMinor: v.refundableMinor });
    expect(r).toEqual(v.expected);
    expect(r.creditRestoredMinor + r.cardRefundMinor).toBe(r.patientPaidRefundableMinor); // RC-4
  });
  it.each(vectors.fifo.map((v: any) => [v.name, v]) as Array<[string, any]>)('first-expiring-first: %s', (_n, v: any) => {
    expect(consumeFifo(v.lots, v.consumeMinor, v.now ?? '2027-01-01T00:00:00Z')).toEqual(v.expected);
  });
  it.each(vectors.expiry.map((v: any) => [v.name, v]) as Array<[string, any]>)('expiry: %s', (_n, v: any) => { expect(expireAmount(v)).toBe(v.expireMinor); });
  it.each(vectors.reversal.map((v: any) => [v.name, v]) as Array<[string, any]>)('reversal: %s', (_n, v: any) => {
    expect(reversalSplit(v)).toEqual({ reverseMinor: v.reverseMinor, recoverableLossMinor: v.recoverableLossMinor });
  });
});

describe('refund allocation edge cases', () => {
  it('rejects negative, fractional and over-price input', () => {
    expect(() => allocateRefund({ priceMinor: 100, sponsoredMinor: 0, creditMinor: 0, cardMinor: 100, heldDepositMinor: 0, refundableMinor: 101 })).toThrow();
    expect(() => allocateRefund({ priceMinor: 100, sponsoredMinor: 0, creditMinor: -1, cardMinor: 100, heldDepositMinor: 0, refundableMinor: 10 })).toThrow();
    expect(() => allocateRefund({ priceMinor: 100.5, sponsoredMinor: 0, creditMinor: 0, cardMinor: 100, heldDepositMinor: 0, refundableMinor: 10 })).toThrow();
    expect(() => allocateRefund({ priceMinor: 0, sponsoredMinor: 0, creditMinor: 0, cardMinor: 0, heldDepositMinor: 0, refundableMinor: 0 })).toThrow();
  });
  it('is exhaustive over a grid: RC-4 and no value created, for every ratio and mix', () => {
    for (const price of [700, 10001, 50000]) for (const s of [0, 100]) for (const c of [0, 150, 3333]) {
      const k = price - s - c; if (k < 0) continue;
      for (let ref = 0; ref <= price; ref += Math.max(1, Math.floor(price / 37))) {
        const a = allocateRefund({ priceMinor: price, sponsoredMinor: s, creditMinor: c, cardMinor: k, heldDepositMinor: 0, refundableMinor: ref });
        expect(a.creditRestoredMinor + a.cardRefundMinor).toBe(a.patientPaidRefundableMinor);
        expect(a.patientPaidRefundableMinor).toBeLessThanOrEqual(c + k);
        expect(a.creditRestoredMinor).toBeLessThanOrEqual(c);
        expect(a.sponsoredVoidedMinor).toBeLessThanOrEqual(s);
        expect(a.cardRefundMinor).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('composeCheckout (order of use, RC-3)', () => {
  it.each([
    [{ priceMinor: 50000, sponsoredMinor: 10000, creditMinor: 15000 }, ['PRICE', 'SPONSORED_DISCOUNT', 'PATIENT_CREDIT', 'CARD'], 25000],
    [{ priceMinor: 50000, creditMinor: 15000, heldDepositMinor: 10000 }, ['PRICE', 'PATIENT_CREDIT', 'DEPOSIT_HELD', 'CARD'], 25000],
    [{ priceMinor: 50000 }, ['PRICE', 'CARD'], 50000],
    [{ priceMinor: 5000, creditMinor: 99999 }, ['PRICE', 'PATIENT_CREDIT', 'CARD'], 1],
    [{ priceMinor: 5000, creditMinor: 99999, minCardMinor: 2000 }, ['PRICE', 'PATIENT_CREDIT', 'CARD'], 2000],
    [{ priceMinor: 1000, sponsoredMinor: 5000, creditMinor: 500 }, ['PRICE', 'SPONSORED_DISCOUNT', 'CARD'], 1],
    [{ priceMinor: 1, creditMinor: 10 }, ['PRICE', 'CARD'], 1],
  ])('%j', (inp, codes, card) => {
    const r = composeCheckout(inp as any);
    expect(r.lines.map((l) => l.code)).toEqual(codes);
    expect(r.cardMinor).toBe(card);
    expect(linesBalance(r.lines)).toBe(true);
  });
  it('property: 30 random vectors balance, never negative, card >= 1', () => {
    let seed = 7; const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    for (let i = 0; i < 300; i++) {
      const r = composeCheckout({ priceMinor: 1 + rnd(100000), sponsoredMinor: rnd(60000), creditMinor: rnd(60000), heldDepositMinor: rnd(30000), minCardMinor: rnd(500) });
      expect(r.cardMinor).toBeGreaterThanOrEqual(1);
      expect(linesBalance(r.lines)).toBe(true);
      for (const l of r.lines) if (l.code !== 'PRICE' && l.code !== 'CARD') expect(l.amountMinor).toBeLessThan(0);
    }
  });
  it('linesBalance rejects tampered snapshots', () => {
    const r = composeCheckout({ priceMinor: 1000, creditMinor: 300 });
    expect(linesBalance(r.lines.map((l) => (l.code === 'CARD' ? { ...l, amountMinor: l.amountMinor + 1 } : l)))).toBe(false);
    expect(linesBalance(r.lines.filter((l) => l.code !== 'CARD'))).toBe(false);
  });
  it('refuses bad input', () => {
    expect(() => composeCheckout({ priceMinor: 0 })).toThrow();
    expect(() => composeCheckout({ priceMinor: 100, creditMinor: -1 })).toThrow();
    expect(() => composeCheckout({ priceMinor: 100, minCardMinor: 101 })).toThrow();
  });
});

describe('reward math helpers', () => {
  it('maxRedeemable: min(available, share of the amount, amount - card minimum), never negative', () => {
    expect(maxRedeemable({ availableMinor: 5000, amountMinor: 10000, redemptionMaxBp: 10000, minPayableMinor: 0 })).toBe(5000);
    expect(maxRedeemable({ availableMinor: 50000, amountMinor: 10000, redemptionMaxBp: 10000, minPayableMinor: 0 })).toBe(9999);
    expect(maxRedeemable({ availableMinor: 50000, amountMinor: 10000, redemptionMaxBp: 5000, minPayableMinor: 0 })).toBe(5000);
    expect(maxRedeemable({ availableMinor: 50000, amountMinor: 10000, redemptionMaxBp: 10000, minPayableMinor: 3000 })).toBe(7000);
    expect(maxRedeemable({ availableMinor: 50000, amountMinor: 100, redemptionMaxBp: 0, minPayableMinor: 0 })).toBe(0);
    expect(maxRedeemable({ availableMinor: 50000, amountMinor: 1, redemptionMaxBp: 10000, minPayableMinor: 0 })).toBe(0);
  });
  it('availableOf ignores expired lots', () => {
    expect(availableOf([{ id: 'a', remainingMinor: 10, expiresAt: '2027-01-01' }, { id: 'b', remainingMinor: 5, expiresAt: '2025-01-01' }], '2026-06-01')).toBe(10);
  });
  it('entryKey is deterministic, distinct per input and matches the contract pattern', () => {
    const a = entryKey('redeem', 'pay_1', 'lot_1');
    expect(a).toBe(entryKey('redeem', 'pay_1', 'lot_1'));
    expect(a).not.toBe(entryKey('redeem', 'pay_1', 'lot_2'));
    expect(a).not.toBe(entryKey('reserve', 'pay_1', 'lot_1'));
    expect(REWARD_IDEMPOTENCY_KEY_PATTERN.test(a)).toBe(true);
    expect(() => entryKey('Bad Type', 'x')).toThrow();
  });
  it('addMonths moves by calendar months in UTC', () => { expect(addMonths(new Date('2026-01-31T00:00:00Z'), 12).getUTCFullYear()).toBe(2027); });
});
