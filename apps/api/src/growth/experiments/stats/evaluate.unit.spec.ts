import { evaluateExperiment, type DayRow } from './evaluate';

const START = new Date('2027-02-01T00:00:00Z');
const at = (d: number) => new Date(START.getTime() + (d - 1) * 86_400_000 + 3_600_000);
const V = [{ key: 'control', weightBp: 5000 }, { key: 'b', weightBp: 5000 }];
/** `perDay` exposures per arm per day for `days` days at the given conversion rates. */
const rows = (days: number, perDay: number, rc: number, rb: number, gc = 0.03, gb = 0.03): DayRow[] => Array.from({ length: days }, (_, d) => {
  const day = new Date(START.getTime() + d * 86_400_000).toISOString().slice(0, 10);
  return [{ day, variant: 'control', exposures: perDay, conversions: Math.round(perDay * rc), guardrails: { message_opt_out: Math.round(perDay * gc) } }, { day, variant: 'b', exposures: perDay, conversions: Math.round(perDay * rb), guardrails: { message_opt_out: Math.round(perDay * gb) } }];
}).flat();
const base = { variants: V, allocationBp: 10000, mode: 'FIXED' as const, alphaBp: 500, minSample: 1000, plannedDays: 14, guardrails: [{ metric: 'message_opt_out', marginAbs: 0.01 }], startedAt: START };

describe('evaluateExperiment (time-travelled clock)', () => {
  it('collecting: before the minimum days nothing is shown, even with a huge effect', () => {
    const r = evaluateExperiment({ ...base, now: at(5), rows: rows(5, 400, 0.1, 0.2) });
    expect(r.verdict).toBe('COLLECTING'); expect(r.hidden).toBe(true); expect(r.winner).toBeNull(); expect(r.blockers).toContain('MIN_DAYS');
  });
  it('a fixed-horizon run names the winner only after the planned days and the minimum sample', () => {
    expect(evaluateExperiment({ ...base, now: at(10), rows: rows(10, 400, 0.1, 0.14) }).blockers).toContain('FIXED_HORIZON_NOT_REACHED');
    const r = evaluateExperiment({ ...base, now: at(14), rows: rows(14, 400, 0.1, 0.14) });
    expect(r.verdict).toBe('WINNER'); expect(r.winner).toBe('b'); expect(r.srm.detected).toBe(false); expect(r.treatments[0]!.ci.low).toBeGreaterThan(0);
  });
  it('sequential mode may conclude at the minimum days', () => {
    const r = evaluateExperiment({ ...base, mode: 'SEQUENTIAL', now: at(7), rows: rows(7, 600, 0.1, 0.15) });
    expect(r.verdict).toBe('WINNER'); expect(r.treatments[0]!.pAlwaysValid).toBeLessThan(0.05);
  });
  it('no difference concludes NO_WINNER, a worse variant is never a winner', () => {
    expect(evaluateExperiment({ ...base, now: at(14), rows: rows(14, 400, 0.1, 0.1) }).verdict).toBe('NO_WINNER');
    const worse = evaluateExperiment({ ...base, now: at(14), rows: rows(14, 400, 0.14, 0.1) });
    expect(worse.verdict).toBe('NO_WINNER'); expect(worse.treatments[0]!.direction).toBe('DOWN');
  });
  it('SRM hides the results and stops', () => {
    const r = evaluateExperiment({ ...base, now: at(14), rows: [...rows(14, 400, 0.1, 0.14)].map((x) => (x.variant === 'b' ? { ...x, exposures: Math.round(x.exposures * 0.8) } : x)) });
    expect(r.verdict).toBe('SRM_DETECTED'); expect(r.hidden).toBe(true); expect(r.stopReason).toBe('SRM'); expect(r.winner).toBeNull(); expect(r.treatments).toHaveLength(0);
  });
  it('auto-stop simulation: a synthetic harmful variant (opt-out 9% vs 3%) breaches within 3 days of data', () => {
    const r = evaluateExperiment({ ...base, now: at(3), rows: rows(3, 400, 0.1, 0.1, 0.03, 0.09) });
    expect(r.verdict).toBe('GUARDRAIL_BREACH'); expect(r.stopReason).toBe('GUARDRAIL');
  });
  it('a harmless variant is not stopped; minimum sample keeps small tests collecting; far past the end with too few units is inconclusive', () => {
    expect(evaluateExperiment({ ...base, now: at(14), rows: rows(14, 400, 0.1, 0.1, 0.03, 0.032) }).stopReason).toBeUndefined();
    expect(evaluateExperiment({ ...base, minSample: 100000, now: at(14), rows: rows(14, 400, 0.1, 0.14) }).blockers).toContain('MIN_SAMPLE');
    const late = evaluateExperiment({ ...base, minSample: 100000, now: at(30), rows: rows(30, 400, 0.1, 0.14) });
    expect(late.verdict).toBe('INCONCLUSIVE'); expect(late.stopReason).toBe('END_DATE_INSUFFICIENT_SAMPLE');
  });
  it('three variants: Holm adjusts, the best significant positive arm wins', () => {
    const V3 = [{ key: 'control', weightBp: 3334 }, { key: 'b', weightBp: 3333 }, { key: 'c', weightBp: 3333 }];
    const rs: DayRow[] = Array.from({ length: 14 }, (_, d) => { const day = new Date(START.getTime() + d * 86_400_000).toISOString().slice(0, 10); return [['control', 0.1], ['b', 0.11], ['c', 0.15]].map(([v, r]) => ({ day, variant: v as string, exposures: 400, conversions: Math.round(400 * (r as number)), guardrails: {} })); }).flat();
    const r = evaluateExperiment({ ...base, variants: V3, guardrails: [], now: at(14), rows: rs });
    expect(r.winner).toBe('c'); expect(r.treatments[1]!.pAdjusted).toBeGreaterThanOrEqual(r.treatments[1]!.pValue);
  });
});
