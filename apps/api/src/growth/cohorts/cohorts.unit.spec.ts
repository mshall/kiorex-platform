import { buildCohorts, monthsBetween, addMonths, type PatientRecord, type CohortCell } from './cohort-builder';
import { fitLtv } from './ltv-fit';
import { monthMeans, paybackMonth, projectCurve, type LtvPatient } from './ltv.model';
import { LTV_POLICY_DEFAULT, validateLtvPolicy, withLtvDefaults } from './ltv-policy';
import { mulberry32, percentile } from './bootstrap';
import { retentionRows, visitsPerPatient } from './retention';
import { toLtvPatient } from './cohort.service';

const ZONE = 'Africa/Cairo';
const at = (iso: string) => Date.parse(`${iso}T12:00:00Z`);
const AS_OF = at('2027-04-15');

/** 200 synthetic patients with hand-computed tables (see the comments next to each expectation). */
function fixture(): PatientRecord[] {
  const out: PatientRecord[] = [];
  // January cohort: 100 patients, 60 ORGANIC_SEARCH (i < 60) and 40 PROVIDER_LINK (i >= 60); first visit 10 Jan, EGP 1000 each
  for (let i = 0; i < 100; i++) {
    const visits = [{ at: at('2027-01-10'), revenueMinor: 100000 }];
    if ((i >= 0 && i < 30) || (i >= 60 && i < 70)) visits.push({ at: at('2027-02-12'), revenueMinor: 50000 });
    if (i < 5) visits.push({ at: at('2027-02-20'), revenueMinor: 30000 });
    if (i < 12) visits.push({ at: at('2027-03-08'), revenueMinor: 40000 });
    out.push({ acquiredAt: visits[0]!.at, sourceKind: i < 60 ? 'ORGANIC_SEARCH' : 'PROVIDER_LINK', campaignId: '', platform: '', visits, rewards: i < 10 ? [{ at: at('2027-01-10'), costMinor: 5000 }] : [] });
  }
  // February cohort: 60 ORGANIC_SEARCH patients, first visit 5 Feb
  for (let i = 0; i < 60; i++) {
    const visits = [{ at: at('2027-02-05'), revenueMinor: 100000 }];
    if (i < 20) visits.push({ at: at('2027-03-09'), revenueMinor: 50000 });
    if (i < 5) visits.push({ at: at('2027-04-02'), revenueMinor: 50000 });
    out.push({ acquiredAt: visits[0]!.at, sourceKind: 'ORGANIC_SEARCH', campaignId: '', platform: '', visits, rewards: [] });
  }
  // March cohort: 33 ORGANIC_SEARCH and 7 CAMPAIGN patients (campaign camp1 on platform metaads)
  for (let i = 0; i < 40; i++) {
    const visits = [{ at: at('2027-03-03'), revenueMinor: 100000 }];
    if (i < 4) visits.push({ at: at('2027-04-04'), revenueMinor: 50000 });
    out.push({ acquiredAt: visits[0]!.at, sourceKind: i < 33 ? 'ORGANIC_SEARCH' : 'CAMPAIGN', campaignId: i < 33 ? '' : 'camp1', platform: i < 33 ? '' : 'metaads', visits, rewards: [] });
  }
  return out;
}
const cells = () => buildCohorts(fixture(), { basis: 'FIRST_COMPLETED', zone: ZONE, asOf: AS_OF });
const pick = (all: CohortCell[], cohortMonth: string, f: Partial<CohortCell>) => all.filter((c) => c.cohortMonth === cohortMonth && Object.entries(f).every(([k, v]) => (c as unknown as Record<string, unknown>)[k] === v));

describe('month arithmetic', () => {
  it('counts calendar months across a year end and adds months back', () => { expect(monthsBetween('2026-11', '2027-02')).toBe(3); expect(addMonths('2026-11', 3)).toBe('2027-02'); expect(addMonths('2027-01', -1)).toBe('2026-12'); });
});

describe('cohort builder (hand-computed)', () => {
  it('the ALL table of the January cohort matches the hand count month by month', () => {
    const jan = pick(cells(), '2027-01-01', { sourceKind: '', campaignId: '', platform: '' });
    expect(jan.map((c) => [c.monthIndex, c.patients, c.retainedPatients, c.completedBookings, c.revenueMinor, c.rewardCostMinor])).toEqual([
      [0, 100, 100, 100, 10_000_000, 50_000],      // 100 first visits at 1000.00; 10 patients used a 50.00 reward
      [1, 100, 40, 45, 2_150_000, 0],              // 30 + 10 returned; 5 of them twice: 40 x 500.00 + 5 x 300.00 = 21,500.00
      [2, 100, 12, 12, 480_000, 0],                // March: 12 x 400.00
      [3, 100, 0, 0, 0, 0],                        // April so far: nobody (as of 15 April)
    ]);
  });
  it('February and March cohorts, each ALL row', () => {
    const feb = pick(cells(), '2027-02-01', { sourceKind: '', campaignId: '', platform: '' });
    expect(feb.map((c) => [c.monthIndex, c.patients, c.retainedPatients, c.completedBookings, c.revenueMinor])).toEqual([[0, 60, 60, 60, 6_000_000], [1, 60, 20, 20, 1_000_000], [2, 60, 5, 5, 250_000]]);
    const mar = pick(cells(), '2027-03-01', { sourceKind: '', campaignId: '', platform: '' });
    expect(mar.map((c) => [c.monthIndex, c.patients, c.retainedPatients, c.revenueMinor])).toEqual([[0, 40, 40, 4_000_000], [1, 40, 4, 200_000]]);
  });
  it('the 200 patients are all in the first-month cells of the ALL dimension', () => {
    const all = cells().filter((c) => !c.sourceKind && !c.campaignId && !c.platform && c.monthIndex === 0 && !c.suppressed);
    expect(all.reduce((s, c) => s + c.patients, 0)).toBe(200);
  });
  it('the SOURCE dimension of January partitions the cohort (60 + 40)', () => {
    const o = pick(cells(), '2027-01-01', { sourceKind: 'ORGANIC_SEARCH', monthIndex: 1 })[0]!; const p = pick(cells(), '2027-01-01', { sourceKind: 'PROVIDER_LINK', monthIndex: 1 })[0]!;
    expect([o.patients, o.retainedPatients, o.revenueMinor]).toEqual([60, 30, 30 * 50_000 + 5 * 30_000]); expect([p.patients, p.retainedPatients, p.revenueMinor]).toEqual([40, 10, 500_000]);
  });
  it('k = 10: a source with 7 people is suppressed with every measure zero, and so is the only visible sibling (no differencing)', () => {
    const mar = cells().filter((c) => c.cohortMonth === '2027-03-01' && c.sourceKind);
    expect(mar.length).toBe(2); expect(mar.every((c) => c.suppressed && c.patients === 0 && c.retainedPatients === 0 && c.revenueMinor === 0 && c.completedBookings === 0 && c.rewardCostMinor === 0)).toBe(true);
    const camp = cells().filter((c) => c.campaignId === 'camp1'); expect(camp.length).toBe(1); expect(camp[0]!.suppressed).toBe(true);
    expect(cells().filter((c) => c.platform === 'metaads')[0]!.suppressed).toBe(true);
  });
  it('no stored non-suppressed cell has fewer than 10 patients, whatever the input', () => {
    const rnd = mulberry32(7); const recs: PatientRecord[] = [];
    for (let i = 0; i < 300; i++) recs.push({ acquiredAt: at(`2027-0${1 + Math.floor(rnd() * 3)}-10`), sourceKind: ['A', 'B', 'C', 'D'][Math.floor(rnd() * 4)]!, campaignId: rnd() < 0.5 ? `c${Math.floor(rnd() * 6)}` : '', platform: '', visits: [{ at: at('2027-03-20'), revenueMinor: 1000 }], rewards: [] });
    for (const c of buildCohorts(recs, { basis: 'FIRST_COMPLETED', zone: ZONE, asOf: AS_OF })) if (!c.suppressed) expect(c.patients).toBeGreaterThanOrEqual(10);
  });
  it('a lower k in the request cannot go below 10', () => {
    const few: PatientRecord[] = Array.from({ length: 5 }, () => ({ acquiredAt: at('2027-03-03'), sourceKind: 'A', campaignId: '', platform: '', visits: [{ at: at('2027-03-03'), revenueMinor: 1 }], rewards: [] }));
    expect(buildCohorts(few, { basis: 'FIRST_COMPLETED', zone: ZONE, asOf: AS_OF, k: 1 }).every((c) => c.suppressed)).toBe(true);
  });
  it('registration basis counts a registered patient who never booked', () => {
    const recs: PatientRecord[] = Array.from({ length: 12 }, (_, i) => ({ acquiredAt: i < 3 ? at('2027-02-10') : null, registeredAt: at('2027-01-20'), sourceKind: 'X', campaignId: '', platform: '', visits: i < 3 ? [{ at: at('2027-02-10'), revenueMinor: 100 }] : [], rewards: [] }));
    const r = buildCohorts(recs, { basis: 'REGISTRATION', zone: ZONE, asOf: AS_OF }).filter((c) => !c.sourceKind && c.cohortMonth === '2027-01-01');
    expect(r.map((c) => [c.monthIndex, c.patients, c.retainedPatients])).toEqual([[0, 12, 0], [1, 12, 3], [2, 12, 0], [3, 12, 0]]);
  });
  it('the cohort month is the market calendar month, not the UTC month (Cairo is ahead of UTC)', () => {
    const recs: PatientRecord[] = Array.from({ length: 10 }, () => ({ acquiredAt: Date.parse('2027-01-31T22:30:00Z'), sourceKind: 'A', campaignId: '', platform: '', visits: [{ at: Date.parse('2027-01-31T22:30:00Z'), revenueMinor: 1 }], rewards: [] }));
    expect(buildCohorts(recs, { basis: 'FIRST_COMPLETED', zone: ZONE, asOf: AS_OF }).find((c) => !c.suppressed)!.cohortMonth).toBe('2027-02-01');
  });
});

describe('retention', () => {
  it('rates from the stored cells, masked below 10 retained, suppressed cohorts say so', () => {
    const rows = retentionRows(cells().filter((c) => !c.sourceKind && !c.campaignId && !c.platform));
    const jan = rows.find((r) => r.cohortMonth === '2027-01-01')!; expect(jan.cells.map((c) => c.rate)).toEqual([100, 40, 12, 0]);
    const feb = rows.find((r) => r.cohortMonth === '2027-02-01')!; expect(feb.cells[2]).toMatchObject({ retained: '<10', rate: '<10' });
    expect(retentionRows(cells().filter((c) => c.sourceKind === 'CAMPAIGN')).every((r) => r.suppressed && r.patients === '<10')).toBe(true);
  });
  it('visits per patient to month 1 uses only cohorts old enough', () => { expect(visitsPerPatient(cells().filter((c) => !c.sourceKind && !c.campaignId && !c.platform), 1)).toBe(Math.round(((100 + 45 + 60 + 20 + 40 + 4) / 200) * 100) / 100); });
});

describe('LTV model', () => {
  const policy = withLtvDefaults({ bootstrapResamples: 300 });
  /** Known-decay population: every patient contributes 1000 * 0.7^m in month m (m = 0 is the acquisition month), with seeded multiplicative noise of mean 1. */
  const population = (n: number, age: number, seed: number, noise: number): LtvPatient[] => { const r = mulberry32(seed); return Array.from({ length: n }, () => ({ age, contrib: Array.from({ length: age + 1 }, (_, m) => 1000 * 0.7 ** m * (1 + noise * (r() - 0.5) * 2)) })); };
  const truth = (h: number) => Array.from({ length: h }, (_, m) => 1000 * 0.7 ** m).reduce((a, b) => a + b, 0);

  it('noise-free: six observed months project to the exact twelve-month sum', () => {
    const c = projectCurve(monthMeans(population(50, 5, 1, 0), 10, 12), policy);
    expect(c.note).toBe('PROJECTED'); expect(c.observedMonths).toBe(6); expect(c.projectedMonths).toBe(6); expect(c.decay).toBeCloseTo(0.7, 10); expect(c.cumulative[11]).toBeCloseTo(truth(12), 6);
  });
  it('with noise the estimate stays within 3 percent of the truth and the interval contains it (error band)', () => {
    const f = fitLtv(population(3000, 5, 42, 0.8), policy, 'k')!;
    expect(Math.abs(f.estimateMinor - truth(12)) / truth(12)).toBeLessThan(0.03); expect(f.lowMinor).toBeLessThanOrEqual(truth(12)); expect(f.highMinor).toBeGreaterThanOrEqual(truth(12));
    expect(f.lowMinor).toBeLessThanOrEqual(f.estimateMinor); expect(f.estimateMinor).toBeLessThanOrEqual(f.highMinor); expect(f.n).toBe(3000);
  });
  it('a complete cohort is the observed sum with no projection', () => {
    const c = projectCurve(monthMeans(population(40, 11, 3, 0), 10, 12), policy); expect(c.note).toBe('OBSERVED'); expect(c.projectedMonths).toBe(0); expect(c.cumulative[11]).toBeCloseTo(truth(12), 6);
  });
  it('the tail never rises above the last observed level, even when the decay is above 1 (growth is clipped)', () => {
    const growing: LtvPatient[] = Array.from({ length: 30 }, () => ({ age: 4, contrib: [100, 150, 220, 330, 500] }));
    const c = projectCurve(monthMeans(growing, 10, 12), policy); for (let m = 5; m < 12; m++) expect(c.perMonth[m]!).toBeLessThanOrEqual(500 + 1e-9);
    expect(c.decay).toBe(1);
  });
  it('a month with fewer than the floor of patients is never used (not enough data says so)', () => {
    expect(projectCurve(monthMeans(population(9, 5, 1, 0), 10, 12), policy).note).toBe('NOT_ENOUGH_DATA');
    const mixed = [...population(30, 2, 1, 0), ...population(4, 8, 2, 0)]; expect(monthMeans(mixed, 10, 12).lastObserved).toBe(2); // months 3 and later have 4 patients
  });
  it('a cohort whose net contribution is negative (reversals) still satisfies low <= estimate <= high (database CHECK; found by the W9 full run, was a 500 on the rollup route)', () => {
    for (const seed of [1, 2, 3]) {
      const neg: LtvPatient[] = Array.from({ length: 60 }, (_, i) => ({ age: 5, contrib: Array.from({ length: 6 }, (_, m) => (m === 0 ? 100 : -300 * (1 + ((i + seed) % 3)) * 0.7 ** m)) }));
      const f = fitLtv(neg, policy, `neg${seed}`);
      if (f) { expect(f.lowMinor).toBeLessThanOrEqual(f.estimateMinor); expect(f.estimateMinor).toBeLessThanOrEqual(f.highMinor); expect(f.lowMinor).toBeGreaterThanOrEqual(0); }
    }
  });
  it('a group below the floor has no estimate at all', () => { expect(fitLtv(population(9, 5, 1, 0), policy, 'k')).toBeNull(); });
  it('discounting lowers the estimate month by month', () => { const a = projectCurve(monthMeans(population(20, 11, 1, 0), 10, 12), policy).cumulative[11]!; const b = projectCurve(monthMeans(population(20, 11, 1, 0), 10, 12), { ...policy, discountRateBp: 2000 }).cumulative[11]!; expect(b).toBeLessThan(a); });
  it('same inputs and seed give the same estimate; another seed changes only the interval', () => {
    const pop = population(400, 5, 9, 0.9); const a = fitLtv(pop, policy, 'g')!; const b = fitLtv(pop, policy, 'g')!; expect(b).toEqual(a);
    const c = fitLtv(pop, { ...policy, seed: policy.seed + 1 }, 'g')!; expect(c.estimateMinor).toBe(a.estimateMinor); expect([c.lowMinor, c.highMinor]).not.toEqual([a.lowMinor, a.highMinor]);
  });
  it('a group larger than the bootstrap cap is subsampled deterministically and says so', () => {
    const pop = population(1500, 2, 5, 0.5); const p = { ...policy, maxBootstrapPatients: 1000, bootstrapResamples: 100 }; const a = fitLtv(pop, p, 'x')!; expect(a.subsampled).toBe(true); expect(fitLtv(pop, p, 'x')).toEqual(a);
  });
  it('payback month is the first month whose cumulative contribution reaches the CAC', () => { expect(paybackMonth([100, 180, 240, 280], 200)).toBe(2); expect(paybackMonth([100, 180], 500)).toBeNull(); expect(paybackMonth([100], 0)).toBeNull(); });
  it('percentile helper is nearest-rank', () => { expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.05)).toBe(1); expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10); });
  it('person records fold into month contributions net of reward cost and nothing person-level is returned', () => {
    const p = toLtvPatient(fixture()[0]!, ZONE, AS_OF, true)!; expect(p.age).toBe(3); expect(p.contrib).toEqual([100000 - 5000, 50000 + 30000, 40000, 0]);
    expect(Object.keys(p).sort()).toEqual(['age', 'contrib']);
  });
});

describe('LTV_POLICY validation', () => {
  it('the floor cannot be lowered below 10, unknown keys and out-of-range values are rejected, the default is valid', () => {
    expect(validateLtvPolicy(LTV_POLICY_DEFAULT).errors).toEqual([]);
    expect(validateLtvPolicy({ minCohortPatients: 9 }).errors[0]).toMatch(/at least 10/);
    expect(validateLtvPolicy({ minPatientsPerObservedMonth: 3 }).errors[0]).toMatch(/at least 10/);
    expect(validateLtvPolicy({ horizonMonths: 0, perPersonLtv: true }).errors.length).toBe(2);
  });
});


describe('language cut (gap closure): ar and en partition the cohort, k applies, and nothing hides by subtraction', () => {
  const mk = (n: number, language: string): PatientRecord[] => Array.from({ length: n }, () => ({ acquiredAt: at('2027-01-10'), sourceKind: 'DIRECT', campaignId: '', platform: '', language, visits: [{ at: at('2027-01-10'), revenueMinor: 100000 }], rewards: [] }));
  const cells = (rec: PatientRecord[]) => buildCohorts(rec, { basis: 'FIRST_COMPLETED', zone: ZONE, asOf: AS_OF });
  it('a language with enough people gets its own cells; the ALL cells still hold everyone', () => {
    const c = cells([...mk(30, 'ar'), ...mk(20, 'en')]);
    const ar = c.filter((x) => x.language === 'ar' && x.monthIndex === 0)[0]!; const en = c.filter((x) => x.language === 'en' && x.monthIndex === 0)[0]!;
    expect([ar.patients, en.patients, ar.suppressed, en.suppressed]).toEqual([30, 20, false, false]);
    expect(c.filter((x) => !x.sourceKind && !x.campaignId && !x.platform && !x.language && x.monthIndex === 0)[0]!.patients).toBe(50);
    expect(c.every((x) => x.language === '' || ['ar', 'en'].includes(x.language))).toBe(true);
  });
  it('a language below k is suppressed with every measure zero, and the other language is suppressed with it (no recovery by subtraction from ALL)', () => {
    const c = cells([...mk(40, 'ar'), ...mk(6, 'en')]);
    const lang = c.filter((x) => x.language !== '');
    expect(lang.filter((x) => x.language === 'en').every((x) => x.suppressed && x.patients === 0 && x.revenueMinor === 0)).toBe(true);
    expect(lang.filter((x) => x.language === 'ar').every((x) => x.suppressed)).toBe(true);
  });
  it('patients with no known language have no language cut, only the ALL cells', () => {
    const c = cells(mk(30, ''));
    expect(c.filter((x) => x.language !== '')).toEqual([]);
    expect(c.filter((x) => x.monthIndex === 0 && !x.sourceKind).length).toBe(1);
  });
  it('a record that never set a language (the old shape) keeps working', () => {
    const rec = mk(30, '').map(({ language: _l, ...r }) => r as PatientRecord);
    expect(() => cells(rec)).not.toThrow();
  });
});
