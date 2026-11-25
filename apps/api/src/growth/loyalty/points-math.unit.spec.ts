import { addMonthsUtc, balanceOf, expirablePoints, nextExpiry, type PointsEntry } from './points-math';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
let n = 0;
const credit = (at: string, points: number, months = 12, type: 'ACCRUE' | 'TIER_BONUS' = 'ACCRUE'): PointsEntry => ({ id: `e${++n}`, type, points, createdAt: d(at), expiresAt: addMonthsUtc(d(at), months) });
const debit = (at: string, type: 'CONVERT' | 'REVERSE' | 'EXPIRE', points: number): PointsEntry => ({ id: `e${++n}`, type, points, createdAt: d(at) });

describe('points arithmetic and FIFO expiry (GRW-P4-D)', () => {
  it('nothing expires before the 12-month mark and everything unspent expires at it', () => {
    const e = [credit('2026-01-01', 100)];
    expect(expirablePoints(e, d('2026-12-31'))).toBe(0); expect(expirablePoints(e, d('2027-01-01'))).toBe(100);
  });
  it('spent points consume the OLDEST credit first, so the newer credit is what is left to expire later', () => {
    const e = [credit('2026-01-01', 100), credit('2026-06-01', 100), debit('2026-07-01', 'CONVERT', 60)];
    expect(expirablePoints(e, d('2027-01-01'))).toBe(40); expect(expirablePoints(e, d('2027-06-01'))).toBe(140);
  });
  it('an EXPIRE entry is not expired twice', () => {
    const e = [credit('2026-01-01', 100), debit('2027-01-01', 'EXPIRE', 100)];
    expect(expirablePoints(e, d('2027-02-01'))).toBe(0); expect(balanceOf(e)).toBe(0);
  });
  it('a conversion after the expiry run still leaves exactly the right amount for the next credit', () => {
    const e = [credit('2026-01-01', 100), credit('2026-06-01', 100), debit('2027-01-01', 'EXPIRE', 100), debit('2027-02-01', 'CONVERT', 40)];
    expect(balanceOf(e)).toBe(60); expect(expirablePoints(e, d('2027-03-01'))).toBe(0); expect(expirablePoints(e, d('2027-06-01'))).toBe(60);
  });
  it('a reversal consumes like a spend; tier bonuses expire like any credit', () => {
    const e = [credit('2026-01-01', 10), credit('2026-01-01', 50, 12, 'TIER_BONUS'), debit('2026-02-01', 'REVERSE', 10)];
    expect(expirablePoints(e, d('2027-01-01'))).toBe(50); expect(balanceOf(e)).toBe(50);
  });
  it('never negative and never more than the balance', () => { const e = [credit('2026-01-01', 5), debit('2026-02-01', 'CONVERT', 5)]; expect(expirablePoints(e, d('2030-01-01'))).toBe(0); });
  it('next expiry names the soonest date and the points that will have lapsed by then', () => {
    const e = [credit('2026-01-01', 30), credit('2026-03-01', 20)];
    expect(nextExpiry(e, d('2026-06-01'))).toEqual({ at: d('2027-01-01'), points: 30 }); expect(nextExpiry(e, d('2028-01-01'))).toBeNull();
  });
  it('month arithmetic is UTC and clamps nothing surprising', () => { expect(addMonthsUtc(d('2026-01-31'), 12).toISOString().slice(0, 10)).toBe('2027-01-31'); });

  // The service always runs the expiry before it spends: simulate that discipline with a deterministic pseudo-random timeline and compare against a brute-force lot-by-lot model.
  it('matches a brute-force lot model over 300 random timelines (expiry always runs before a spend)', () => {
    let seed = 20270218; const rnd = (k: number) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed % k; };
    for (let run = 0; run < 300; run++) {
      const entries: PointsEntry[] = []; const lots: Array<{ exp: number; left: number }> = []; let t = d('2026-01-01').getTime();
      for (let step = 0; step < 24; step++) {
        t += (1 + rnd(40)) * 86_400_000; const now = new Date(t);
        // run expiry first (service discipline): the model drops expired lots, the ledger gets an EXPIRE entry of the same size
        const model = lots.filter((l) => l.exp <= t).reduce((s, l) => s + l.left, 0);
        const x = expirablePoints(entries, now); expect(x).toBe(model);
        if (x > 0) { entries.push(debit(now.toISOString().slice(0, 10), 'EXPIRE', x)); for (const l of lots) if (l.exp <= t) l.left = 0; }
        const op = rnd(3);
        if (op === 0) { const p = 1 + rnd(50); const e = credit(now.toISOString().slice(0, 10), p, 1 + rnd(5)); entries.push(e); lots.push({ exp: e.expiresAt!.getTime(), left: p }); } // creation order is the FIFO order
        else if (op === 1 && balanceOf(entries) > 0) { let p = 1 + rnd(balanceOf(entries)); entries.push(debit(now.toISOString().slice(0, 10), rnd(2) ? 'CONVERT' : 'REVERSE', p)); for (const l of lots) { const k = Math.min(l.left, p); l.left -= k; p -= k; if (!p) break; } }
        expect(balanceOf(entries)).toBe(lots.reduce((s, l) => s + l.left, 0)); expect(balanceOf(entries)).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
