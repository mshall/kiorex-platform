import { claimRateFinding, reconcileClaimRates, NOT_SET, computeCommissionMinor, orderFeeMinor, snapshotOf, effectiveFromAtApproval, effectiveFromProblem, expectedCommissionMinor, parseRate, rateProblems, resolveRate, type RateRowLite } from './commission-rate';

/** COM-2 pure domain. Every number below is a TEST placeholder, never a shipped rate. */
const D = (s: string) => new Date(s);
const row = (o: Partial<RateRowLite> & { id: string; effectiveFrom: Date }): RateRowLite => ({ scope: 'DEFAULT', kind: 'RATE', version: 1, status: 'ACTIVE', spec: { feeType: 'PERCENT', percentBps: 1000 }, reason: null, ...o });

describe('commission rate validation', () => {
  it('accepts a percent and a flat rate with floor, cap and mode', () => {
    expect(rateProblems({ feeType: 'PERCENT', percentBps: 1250, minMinor: 500, maxMinor: 5000, mode: 'NET_FROM_PAYOUT' })).toEqual([]);
    expect(rateProblems({ feeType: 'FLAT', flatMinor: 3000, mode: 'INVOICE_AND_COLLECT' })).toEqual([]);
    expect(rateProblems({ feeType: 'PERCENT', percentBps: 0 })).toEqual([]); // an explicit 0 % is a decision, unlike "not set"
  });
  it('rejects every malformed shape', () => {
    expect(rateProblems(null)).toHaveLength(1);
    expect(rateProblems({ feeType: 'TIERED' })).toContain('feeType must be PERCENT or FLAT');
    expect(rateProblems({ feeType: 'PERCENT' })).toContain('percentBps must be an integer 0..10000');
    expect(rateProblems({ feeType: 'PERCENT', percentBps: 10_001 })).toHaveLength(1);
    expect(rateProblems({ feeType: 'PERCENT', percentBps: 12.5 })).toHaveLength(1);
    expect(rateProblems({ feeType: 'PERCENT', percentBps: 100, flatMinor: 5 })).toContain('flatMinor is not allowed for PERCENT');
    expect(rateProblems({ feeType: 'FLAT', flatMinor: -1 })).toHaveLength(1);
    expect(rateProblems({ feeType: 'FLAT', flatMinor: 100, percentBps: 5 })).toContain('percentBps is not allowed for FLAT');
    expect(rateProblems({ feeType: 'FLAT', flatMinor: 100, minMinor: 900, maxMinor: 100 })).toContain('minMinor must not exceed maxMinor');
    expect(rateProblems({ feeType: 'FLAT', flatMinor: 100, mode: 'CASH' })).toContain('mode is not a collection mode');
    expect(rateProblems({ feeType: 'FLAT', flatMinor: 100, surprise: 1 })).toContain('unknown field surprise');
  });
  it('parseRate drops unknown keys and the field of the other fee type', () => {
    expect(parseRate({ feeType: 'FLAT', flatMinor: 700, percentBps: 5, junk: 1 })).toMatchObject({ feeType: 'FLAT', percentBps: null, flatMinor: 700, minMinor: null, maxMinor: null, mode: null, currency: null, rounding: null, retryDays: null, savedMethodChargeAllowed: null });
  });
});

describe('commission amount', () => {
  const pct = (bps: number, min: number | null = null, max: number | null = null) => parseRate({ feeType: 'PERCENT', percentBps: bps, minMinor: min, maxMinor: max });
  it('rounds half up on exact integers (no float drift)', () => {
    expect(computeCommissionMinor(10_050, pct(1000))).toBe(1005);
    expect(computeCommissionMinor(10_005, pct(1000))).toBe(1001); // 1000.5 -> 1001
    expect(computeCommissionMinor(333, pct(3333))).toBe(111); // 110.99... -> 111
    expect(computeCommissionMinor(0, pct(1000))).toBe(0);
  });
  it('applies the floor and the cap, and a flat amount ignores the basis', () => {
    expect(computeCommissionMinor(1000, pct(1000, 500))).toBe(500);
    expect(computeCommissionMinor(1_000_000, pct(1000, null, 5000))).toBe(5000);
    expect(computeCommissionMinor(999_999, parseRate({ feeType: 'FLAT', flatMinor: 2500 }))).toBe(2500);
  });
});

describe('effective rate resolution (effective-dated, inheritance, override)', () => {
  const def1 = row({ id: 'd1', version: 1, effectiveFrom: D('2026-01-01T00:00:00Z'), spec: { feeType: 'PERCENT', percentBps: 1000 } });
  const def2 = row({ id: 'd2', version: 2, effectiveFrom: D('2026-06-01T00:00:00Z'), spec: { feeType: 'PERCENT', percentBps: 1500 } });
  const ov = row({ id: 'o1', scope: 'ORG', version: 1, effectiveFrom: D('2026-03-01T00:00:00Z'), spec: { feeType: 'FLAT', flatMinor: 4000 }, reason: 'negotiated' });
  const back = row({ id: 'o2', scope: 'ORG', kind: 'INHERIT', version: 2, effectiveFrom: D('2026-09-01T00:00:00Z'), spec: null, reason: 'contract ended' });

  it('nothing set -> NOT_SET (no charge), never an invented value', () => {
    expect(resolveRate([], [], D('2026-05-01T00:00:00Z'))).toEqual(NOT_SET);
    expect(expectedCommissionMinor(10_000, NOT_SET)).toBeNull();
  });
  it('a default that starts later does not apply before it starts', () => {
    expect(resolveRate([def1], [], D('2025-12-31T23:59:59Z')).state).toBe('NOT_SET');
    expect(resolveRate([def1], [], D('2026-01-01T00:00:00Z'))).toMatchObject({ state: 'SET', source: 'DEFAULT', policyId: 'd1' });
  });
  it('an old instant keeps the old rate after the default changed (past charges keep their rate)', () => {
    expect(resolveRate([def1, def2], [], D('2026-05-31T23:59:59Z')).policyId).toBe('d1');
    expect(resolveRate([def1, def2], [], D('2026-06-01T00:00:00Z')).policyId).toBe('d2');
  });
  it('the override wins from its start, survives later default changes, and INHERIT returns to the default', () => {
    expect(resolveRate([def1, def2], [ov], D('2026-02-01T00:00:00Z')).source).toBe('DEFAULT');
    expect(resolveRate([def1, def2], [ov], D('2026-07-01T00:00:00Z'))).toMatchObject({ source: 'OVERRIDE', policyId: 'o1', reason: 'negotiated' });
    expect(resolveRate([def1, def2], [ov, back], D('2026-09-01T00:00:00Z'))).toMatchObject({ source: 'DEFAULT', policyId: 'd2' });
    expect(resolveRate([def1, def2], [ov, back], D('2026-08-31T23:59:59Z')).source).toBe('OVERRIDE');
  });
  it('only ACTIVE rows count; ties on the start take the higher version', () => {
    const pending = row({ id: 'p', version: 3, status: 'PENDING', effectiveFrom: D('2026-01-01T00:00:00Z') });
    const rejected = row({ id: 'r', version: 4, status: 'REJECTED', effectiveFrom: D('2026-01-01T00:00:00Z') });
    expect(resolveRate([pending, rejected], [], D('2027-01-01T00:00:00Z')).state).toBe('NOT_SET');
    const a = row({ id: 'a', version: 1, effectiveFrom: D('2026-01-01T00:00:00Z') });
    const b = row({ id: 'b', version: 2, effectiveFrom: D('2026-01-01T00:00:00Z') });
    expect(resolveRate([a, b], [], D('2026-02-01T00:00:00Z')).policyId).toBe('b');
  });
  it('an organisation INHERIT row with no default stays NOT_SET', () => {
    expect(resolveRate([], [back], D('2026-10-01T00:00:00Z')).state).toBe('NOT_SET');
  });
});

describe('effective-from rules', () => {
  const now = D('2026-05-01T12:00:00Z');
  it('rejects the past beyond one minute of clock skew and bad dates', () => {
    expect(effectiveFromProblem(D('2026-05-01T11:58:00Z'), now)).toBe('effectiveFrom must not be in the past');
    expect(effectiveFromProblem(D('2026-05-01T11:59:30Z'), now)).toBeNull();
    expect(effectiveFromProblem(new Date('nope'), now)).toBe('effectiveFrom is not a date');
  });
  it('approval never moves the start earlier than the approval time', () => {
    expect(effectiveFromAtApproval(D('2026-05-01T12:00:00Z'), D('2026-05-02T09:00:00Z')).toISOString()).toBe('2026-05-02T09:00:00.000Z');
    expect(effectiveFromAtApproval(D('2026-06-01T00:00:00Z'), D('2026-05-02T09:00:00Z')).toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });
});

describe('order fee (pharmacy order, lab booking) from the snapshot', () => {
  const snap = (spec: object) => ({ source: 'DEFAULT', policyId: 'crp_1', version: 1, effectiveFrom: '2026-01-01T00:00:00.000Z', spec: { feeType: 'PERCENT', percentBps: null, flatMinor: null, minMinor: null, maxMinor: null, mode: null, ...spec } });
  it('the snapshot decides: percent, flat, floor and cap', () => {
    expect(orderFeeMinor(5000, snap({ percentBps: 1000 }), 0)).toBe(500);
    expect(orderFeeMinor(5000, snap({ feeType: 'FLAT', flatMinor: 150 }), 400)).toBe(150); // the legacy rate is ignored once a rate is snapshotted
    expect(orderFeeMinor(1000, snap({ percentBps: 1000, minMinor: 300 }), 0)).toBe(300);
    expect(orderFeeMinor(15000, snap({ percentBps: 500, maxMinor: 500 }), 0)).toBe(500);
  });
  it('without a snapshot the legacy take rate applies, and 0 while it is unset (nothing is invented)', () => {
    expect(orderFeeMinor(5000, null, 400)).toBe(200);
    expect(orderFeeMinor(5000, null, 0)).toBe(0);
    expect(orderFeeMinor(5000, { spec: { feeType: 'TIERED' } }, 400)).toBe(200); // a malformed snapshot never charges a made-up amount
  });
  it('snapshotOf keeps only a SET rate', () => {
    expect(snapshotOf(NOT_SET)).toBeNull();
    const eff = resolveRate([{ id: 'd1', scope: 'DEFAULT', kind: 'RATE', version: 1, status: 'ACTIVE', spec: { feeType: 'FLAT', flatMinor: 100 }, effectiveFrom: new Date('2026-01-01T00:00:00Z'), reason: null }], [], new Date('2026-02-01T00:00:00Z'));
    expect(snapshotOf(eff)).toMatchObject({ source: 'DEFAULT', policyId: 'd1', version: 1, spec: { feeType: 'FLAT', flatMinor: 100 } });
  });
});

describe('COM-3 rate parameters: every numeric is configurable, none is shipped', () => {
  const base = { feeType: 'PERCENT', percentBps: 1000 };
  it('a rate without the new fields stays valid and parses them as "not set" (follow the collection settings)', () => {
    expect(rateProblems(base)).toEqual([]);
    expect(parseRate(base)).toMatchObject({ currency: null, rounding: null, minCollectMinor: null, graceDays: null, retryDays: null, invoiceDueDays: null, reminderDays: null, disputeWindowDays: null, savedMethodChargeAllowed: null });
  });
  it('accepts and parses the timeline, dispute window, currency, rounding and token permission', () => {
    const full = { ...base, currency: 'EGP', rounding: 'DOWN', minCollectMinor: 5000, graceDays: 3, retryDays: [2, 5], invoiceDueDays: 14, reminderDays: [-3, 0, 7], disputeWindowDays: 10, savedMethodChargeAllowed: false };
    expect(rateProblems(full)).toEqual([]);
    expect(parseRate(full)).toMatchObject(full);
  });
  it('rejects out-of-range or malformed values', () => {
    for (const bad of [{ currency: 'egp' }, { rounding: 'BANKERS' }, { graceDays: 31 }, { retryDays: [5, 2] }, { retryDays: [1, 2, 3, 4, 5, 6, 7] }, { reminderDays: [0, 0] }, { reminderDays: [-31] }, { invoiceDueDays: 0 }, { disputeWindowDays: 366 }, { minCollectMinor: -1 }, { savedMethodChargeAllowed: 'yes' }, { junk: 1 }])
      expect(rateProblems({ ...base, ...bad }).length).toBeGreaterThan(0);
  });
  it('rounding: unset = half up (what shipped), DOWN and UP follow the setting', () => {
    const at = (rounding: 'HALF_UP' | 'DOWN' | 'UP' | null) => computeCommissionMinor(1005, { ...parseRate(base), percentBps: 150, rounding }); // 15.075
    expect([at(null), at('HALF_UP'), at('DOWN'), at('UP')]).toEqual([15, 15, 15, 16]);
    const half = (rounding: 'HALF_UP' | 'DOWN' | 'UP' | null) => computeCommissionMinor(1050, { ...parseRate(base), percentBps: 150, rounding }); // 15.75
    expect([half(null), half('DOWN'), half('UP')]).toEqual([16, 15, 16]);
  });
});

describe('reconciliation: claim differs from the rate (CLAIM_NE_RATE)', () => {
  const spec = { feeType: 'PERCENT', percentBps: 1000 }; // TEST placeholder
  const snap = { source: 'DEFAULT', policyId: 'crp_1', version: 2, effectiveFrom: '2026-01-01T00:00:00.000Z', spec, expectedMinor: 3000 };
  const claim = (o: Record<string, unknown> = {}) => ({ id: 'ccl_1', orgRef: 'org_a', amountMinor: 3000, chargeStatus: 'CONFIRMED', feeBasisMinor: 30000, rateSnapshot: snap, ...o }) as Parameters<typeof claimRateFinding>[0];
  it('no finding when the charge equals the rate on the fee basis', () => expect(claimRateFinding(claim())).toBeNull());
  it('a charge that differs from the rate is a finding with expected and actual', () => {
    expect(claimRateFinding(claim({ amountMinor: 3500 }))).toMatchObject({ code: 'CLAIM_NE_RATE', ref: 'ccl_1', orgRef: 'org_a', expectedMinor: 3000, actualMinor: 3500 });
  });
  it('is recomputed from the stored spec, so a stale or damaged expectedMinor cannot hide it', () => {
    expect(claimRateFinding(claim({ amountMinor: 2500, rateSnapshot: { ...snap, expectedMinor: 2500 } }))).toMatchObject({ expectedMinor: 3000, actualMinor: 2500 });
  });
  it('floor, cap and flat rates are honoured', () => {
    expect(claimRateFinding(claim({ amountMinor: 5000, rateSnapshot: { ...snap, spec: { feeType: 'PERCENT', percentBps: 1000, minMinor: 5000 } } }))).toBeNull();
    expect(claimRateFinding(claim({ amountMinor: 1000, rateSnapshot: { ...snap, spec: { feeType: 'FLAT', flatMinor: 1200 } } }))).toMatchObject({ expectedMinor: 1200 });
  });
  it('falls back to the stored expectedMinor without a fee basis; nothing to compare = no finding', () => {
    expect(claimRateFinding(claim({ feeBasisMinor: null, amountMinor: 100 }))).toMatchObject({ expectedMinor: 3000 });
    expect(claimRateFinding(claim({ feeBasisMinor: null, rateSnapshot: { ...snap, expectedMinor: null }, amountMinor: 100 }))).toBeNull();
  });
  it('claims reported while no rate was set (no snapshot) and reversed or waived claims are not findings', () => {
    expect(claimRateFinding(claim({ rateSnapshot: null, amountMinor: 1 }))).toBeNull();
    expect(claimRateFinding(claim({ chargeStatus: 'REVERSED', amountMinor: 1 }))).toBeNull();
    expect(claimRateFinding(claim({ chargeStatus: 'WAIVED', amountMinor: 1 }))).toBeNull();
  });
  it('an invalid stored spec is ignored (falls back), never throws', () => {
    expect(() => claimRateFinding(claim({ rateSnapshot: { ...snap, spec: { feeType: 'NOPE' } } }))).not.toThrow();
    expect(reconcileClaimRates([claim(), claim({ id: 'ccl_2', amountMinor: 1 })]).map((f) => f.ref)).toEqual(['ccl_2']);
  });
});
