import fc from 'fast-check';
import { A, assertValid, capture, identityHolds, LedgerBook, LedgerError, payout, pspFee, refundRequest, refundSettle, release } from './ledger';

/** Money-path property tests (fast-check) — KXM-PAY-05 ledger invariants. */
type Op =
  | { t: 'capture'; pay: number; clinic: number; amt: number; fee: number }
  | { t: 'refund'; pay: number; amt: number }
  | { t: 'settle'; idx: number }
  | { t: 'release'; pay: number }
  | { t: 'payout'; clinic: number };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ t: fc.constant('capture' as const), pay: fc.integer({ min: 0, max: 9 }), clinic: fc.integer({ min: 0, max: 2 }), amt: fc.integer({ min: 100, max: 500_000 }), fee: fc.integer({ min: 0, max: 5_000 }) }),
  fc.record({ t: fc.constant('refund' as const), pay: fc.integer({ min: 0, max: 9 }), amt: fc.integer({ min: 1, max: 500_000 }) }),
  fc.record({ t: fc.constant('settle' as const), idx: fc.integer({ min: 0, max: 30 }) }),
  fc.record({ t: fc.constant('release' as const), pay: fc.integer({ min: 0, max: 9 }) }),
  fc.record({ t: fc.constant('payout' as const), clinic: fc.integer({ min: 0, max: 2 }) }),
);

/** Reference model of PayService rules driving the pure ledger. */
function run(ops: Op[]) {
  const book = new LedgerBook();
  const pays = new Map<number, { clinic: number; amt: number; refunded: number; released: boolean; paid: boolean }>();
  const refunds: { pay: number; amt: number; settled: boolean }[] = [];
  const payable = new Map<number, number>();
  let captured = 0, refundedTotal = 0, settledTotal = 0, paidOut = 0, fees = 0;
  const cl = (n: number) => `c${n}`;
  for (const o of ops) {
    if (o.t === 'capture') {
      if (pays.has(o.pay)) { expect(book.post({ key: `capture:${o.pay}`, kind: 'CAPTURE', postings: capture(cl(o.clinic), o.amt) })).toBe(false); continue; } // replay is a no-op
      book.post({ key: `capture:${o.pay}`, kind: 'CAPTURE', postings: capture(cl(o.clinic), o.amt) });
      if (o.fee) book.post({ key: `fee:${o.pay}`, kind: 'FEE', postings: pspFee(o.fee) });
      pays.set(o.pay, { clinic: o.clinic, amt: o.amt, refunded: 0, released: false, paid: false });
      captured += o.amt; fees += o.fee;
    } else if (o.t === 'refund') {
      const p = pays.get(o.pay);
      if (!p || p.released || o.amt > p.amt - p.refunded) continue; // service rejects over-refund / refund after release
      book.post({ key: `refund-req:${refunds.length}`, kind: 'REFUND_REQUEST', postings: refundRequest(cl(p.clinic), o.amt) });
      p.refunded += o.amt; refundedTotal += o.amt;
      refunds.push({ pay: o.pay, amt: o.amt, settled: false });
    } else if (o.t === 'settle') {
      const r = refunds[o.idx % Math.max(1, refunds.length)];
      if (!r || r.settled) continue;
      book.post({ key: `refund-settle:${refunds.indexOf(r)}`, kind: 'REFUND_SETTLED', postings: refundSettle(r.amt) });
      r.settled = true; settledTotal += r.amt;
    } else if (o.t === 'release') {
      const p = pays.get(o.pay);
      if (!p || p.released) continue;
      const n = p.amt - p.refunded;
      if (n > 0) book.post({ key: `release:${o.pay}`, kind: 'RELEASE', postings: release(cl(p.clinic), n) });
      p.released = true; payable.set(p.clinic, (payable.get(p.clinic) ?? 0) + n);
    } else {
      const n = payable.get(o.clinic) ?? 0;
      if (n <= 0) continue;
      book.post({ key: `payout:${paidOut}:${o.clinic}:${n}:${Math.random()}`, kind: 'PAYOUT', postings: payout(cl(o.clinic), n) });
      payable.set(o.clinic, 0); paidOut += n;
    }
  }
  return { book, captured, refundedTotal, settledTotal, paidOut, fees, pays };
}

describe('ledger invariants (property-based)', () => {
  it('every transaction balances: Σdebit = Σcredit, always', () => {
    fc.assert(fc.property(fc.array(opArb, { maxLength: 80 }), (ops) => {
      const { book } = run(ops);
      const t = book.totals();
      expect(t.debit).toBe(t.credit);
    }), { numRuns: 300 });
  });

  it('accounting identity: clearing + fees = Σ liabilities; no liability ever negative', () => {
    fc.assert(fc.property(fc.array(opArb, { maxLength: 80 }), (ops) => {
      const { book } = run(ops);
      expect(identityHolds(book)).toBe(true);
      for (const a of book.accounts()) if (a.startsWith('HELD:') || a.startsWith('PAYABLE:') || a === A.refundPayable) expect(book.balance(a)).toBeGreaterThanOrEqual(0);
    }), { numRuns: 300 });
  });

  it('conservation: held + payable + refundPayable = captured − settled refunds − payouts (refund can never exceed capture)', () => {
    fc.assert(fc.property(fc.array(opArb, { maxLength: 80 }), (ops) => {
      const r = run(ops);
      const liabilities = r.book.liabilities();
      expect(liabilities).toBe(r.captured - r.settledTotal - r.paidOut);
      expect(r.refundedTotal).toBeLessThanOrEqual(r.captured);
      expect(r.book.balance(A.clearing)).toBe(r.captured - r.fees - r.settledTotal - r.paidOut);
    }), { numRuns: 300 });
  });

  it('idempotency: replaying any transaction key changes nothing', () => {
    fc.assert(fc.property(fc.array(opArb, { maxLength: 40 }), (ops) => {
      const a = run([...ops, { t: 'capture', pay: 0, clinic: 0, amt: 123, fee: 0 }]);
      const before = a.book.totals();
      const again = a.book.post({ key: 'capture:0', kind: 'CAPTURE', postings: capture('c0', 123) });
      expect(again).toBe(false);
      expect(a.book.totals()).toEqual(before);
    }), { numRuns: 100 });
  });

  it('rejects malformed postings: unbalanced, double-sided, negative, fractional, empty', () => {
    expect(() => assertValid([{ account: 'a', debit: 5, credit: 0 }, { account: 'b', debit: 0, credit: 4 }])).toThrow(LedgerError);
    expect(() => assertValid([{ account: 'a', debit: 5, credit: 5 }])).toThrow(LedgerError);
    expect(() => assertValid([{ account: 'a', debit: -1, credit: 0 }, { account: 'b', debit: 0, credit: -1 }])).toThrow(LedgerError);
    expect(() => assertValid([{ account: 'a', debit: 1.5, credit: 0 }, { account: 'b', debit: 0, credit: 1.5 }])).toThrow(LedgerError);
    expect(() => assertValid([])).toThrow(LedgerError);
    fc.assert(fc.property(fc.integer({ min: 1, max: 1e9 }), (n) => { assertValid(capture('c', n)); assertValid(release('c', n)); assertValid(payout('c', n)); }));
  });

  it('a payout larger than the payable balance is refused (cannot pay out money not owed)', () => {
    const b = new LedgerBook();
    b.post({ key: 'c', kind: 'CAPTURE', postings: capture('c1', 1000) });
    b.post({ key: 'r', kind: 'RELEASE', postings: release('c1', 1000) });
    expect(() => b.post({ key: 'p', kind: 'PAYOUT', postings: payout('c1', 1001) })).toThrow(LedgerError);
    expect(b.post({ key: 'p2', kind: 'PAYOUT', postings: payout('c1', 1000) })).toBe(true);
  });
});
