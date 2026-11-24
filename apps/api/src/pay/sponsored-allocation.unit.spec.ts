import { A, LedgerBook, capture, identityHolds, rewardTender, sponsorTender, sponsorVoid, release, payout } from './ledger';
import { allocateRefund, sponsoredVoidedByRefund } from './refund-allocation';

describe('GRW-P2-S sponsored share of a refund (KX-30 14.2, D 500, S 100, C 150, K 250)', () => {
  const base = { sponsoredMinor: 10000, cardMinor: 25000, alreadyVoidedMinor: 0 };
  it('a full refund of the card voids the whole sponsored discount, exactly', () => {
    expect(sponsoredVoidedByRefund({ ...base, cardRefundedAfterMinor: 25000 })).toBe(10000);
  });
  it('agrees with allocateRefund for a single refund of any fraction of the price', () => {
    for (const refundable of [0, 1, 777, 12500 * 2, 33333, 49999, 50000]) {
      const a = allocateRefund({ priceMinor: 50000, sponsoredMinor: 10000, creditMinor: 15000, cardMinor: 25000, heldDepositMinor: 0, refundableMinor: refundable });
      const byCard = sponsoredVoidedByRefund({ ...base, cardRefundedAfterMinor: a.cardRefundMinor });
      expect(Math.abs(byCard - a.sponsoredVoidedMinor)).toBeLessThanOrEqual(1); // rounding basis differs by at most one minor unit
      expect(a.creditRestoredMinor + a.cardRefundMinor).toBe(a.patientPaidRefundableMinor); // RC-4
    }
  });
  it('is cumulative: any split of a full refund voids exactly S in total and never a negative share', () => {
    for (let seed = 1; seed <= 200; seed++) {
      let after = 0, voided = 0; let r = seed * 7919;
      while (after < 25000) { r = (r * 1103515245 + 12345) % 2147483648; const step = Math.min(25000 - after, 1 + (r % 9000)); after += step; const d = sponsoredVoidedByRefund({ ...base, cardRefundedAfterMinor: after, alreadyVoidedMinor: voided }); expect(d).toBeGreaterThanOrEqual(0); voided += d; }
      expect(voided).toBe(10000);
    }
  });
  it('nothing sponsored, nothing voided; bad input is refused', () => {
    expect(sponsoredVoidedByRefund({ sponsoredMinor: 0, cardMinor: 25000, cardRefundedAfterMinor: 25000, alreadyVoidedMinor: 0 })).toBe(0);
    expect(() => sponsoredVoidedByRefund({ ...base, cardRefundedAfterMinor: -1 })).toThrow(RangeError);
  });
});

describe('GRW-P2-S ledger postings keep the accounting identity', () => {
  it('capture + credit tender + sponsor tender, release and payout of 500 leave every account consistent; a void is the exact reverse', () => {
    const b = new LedgerBook();
    b.post({ key: 'cap', kind: 'CAPTURE', postings: capture('cl', 25000) });
    b.post({ key: 'rw', kind: 'REWARD_TENDER', postings: rewardTender('cl', 0, 15000) });
    b.post({ key: 'sp', kind: 'SPONSOR_FUNDED', postings: sponsorTender('cl', 10000) });
    expect(b.balance(A.held('cl'))).toBe(50000); expect(identityHolds(b)).toBe(true);
    b.post({ key: 'rel', kind: 'RELEASE', postings: release('cl', 50000) }); b.post({ key: 'po', kind: 'PAYOUT', postings: payout('cl', 50000) });
    expect(b.balance(A.sponsorFunded)).toBe(10000); expect(identityHolds(b)).toBe(true);
    const v = new LedgerBook(); v.post({ key: 'sp', kind: 'S', postings: sponsorTender('cl', 10000) }); v.post({ key: 'v', kind: 'V', postings: sponsorVoid(A.held('cl'), 10000) });
    expect(v.balance(A.sponsorFunded)).toBe(0); expect(v.balance(A.held('cl'))).toBe(0); expect(identityHolds(v)).toBe(true);
  });
});
