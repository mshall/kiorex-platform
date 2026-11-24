import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { createCtx, TestCtx } from './harness';
import { testDatabaseUrl } from './db-url';

/** GRW-P3-C (cohort tables from the wave 7 migration) and GRW-P3-G (migration 20270128091000, wave 8 lane A2): constraints are database rules, not only service rules. Real Postgres. */
describe('growth schema, wave 8 lane A2', () => {
  let c: TestCtx;
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => { await c.reset(); });
  const rejects = (p: Promise<unknown>, re: RegExp) => expect(p).rejects.toThrow(re);
  const cell = (o: Record<string, unknown> = {}) => c.prisma.growthCohortMonthly.create({ data: { cohortMonth: new Date('2027-01-01'), monthIndex: 0, patients: 10, retainedPatients: 10, ...o } as never });
  const geo = (o: Record<string, unknown> = {}) => c.prisma.marketGeography.create({ data: { market: 'ZY', level: 'CITY', key: 'amman', nameAr: 'عمان', nameEn: 'Amman', slugAr: 'amman', slugEn: 'amman', ...o } });

  it('cohort cells: fewer than 10 people is only storable as a suppressed all-zero cell; retained cannot exceed patients', async () => {
    await cell();
    await rejects(cell({ cohortMonth: new Date('2027-02-01'), patients: 9, retainedPatients: 9 }), /k_check/);
    await rejects(cell({ cohortMonth: new Date('2027-02-01'), k: 5 }), /k_check/);
    await rejects(cell({ cohortMonth: new Date('2027-03-01'), suppressed: true, patients: 3 }), /suppressed_check/);
    await rejects(cell({ cohortMonth: new Date('2027-03-01'), suppressed: true, patients: 0, retainedPatients: 0, revenueMinor: 5 }), /suppressed_check/);
    await cell({ cohortMonth: new Date('2027-04-01'), suppressed: true, patients: 0, retainedPatients: 0 });
    await rejects(cell({ cohortMonth: new Date('2027-05-01'), retainedPatients: 11 }), /values_check/);
    await rejects(cell(), /Unique constraint/);
  });
  it('LTV estimates: n at least 10, ordered interval, label ESTIMATE only', async () => {
    const e = (o: Record<string, unknown> = {}) => c.prisma.growthLtvEstimate.create({ data: { cohortKey: `k${Math.random()}`, horizonMonths: 12, estimateMinor: 100n, lowMinor: 80n, highMinor: 120n, modelVersion: 'v', n: 10, ...o } as never });
    await e(); await rejects(e({ n: 9 }), /n_check/); await rejects(e({ lowMinor: 101n }), /interval_check/); await rejects(e({ label: 'FACT' }), /label_check/); await rejects(e({ horizonMonths: 61 }), /n_check/);
  });
  it('market onboarding: one plan per country, country and status formats, a published plan has its time; geography has unique slugs per locale and level', async () => {
    const p = (o: Record<string, unknown> = {}) => c.prisma.marketOnboardingPlan.create({ data: { cc: 'ZY', createdBy: 'a', ...o } });
    await p(); await rejects(p(), /Unique constraint/); await rejects(p({ cc: 'zy' }), /cc_check/); await rejects(p({ cc: 'QQ', status: 'LIVE' }), /status_check/);
    await rejects(p({ cc: 'QQ', status: 'PUBLISHED' }), /published_check/); await rejects(p({ cc: 'QQ', status: 'READY' }), /ready_check/);
    await geo(); await rejects(geo({ key: 'other' }), /Unique constraint/); await geo({ key: 'amman2', slugAr: 'amman-2', slugEn: 'amman-2' });
    await rejects(geo({ key: 'x1', slugAr: 'Bad Slug', slugEn: 'ok-slug' }), /slug_check/); await rejects(geo({ key: 'x2', level: 'TOWN', slugAr: 'a1b', slugEn: 'a1c' }), /level_check/);
    await rejects(geo({ key: 'Bad Key', slugAr: 'a1d', slugEn: 'a1e' }), /key_check/); await rejects(geo({ key: 'x3', market: 'zy', slugAr: 'a1f', slugEn: 'a1g' }), /market_check/);
    await geo({ level: 'DISTRICT', key: 'amman', slugAr: 'amman', slugEn: 'amman' }); // the same slug at another level is fine
  });
  it('the wave 8 migration is idempotent when replayed, sorts after every earlier one and shares no prefix', async () => {
    const dir = join(__dirname, '..', 'prisma', 'migrations'); const name = readdirSync(dir).find((f) => f === '20270128091000_growth_p3_market_onboarding')!;
    const cl = new Client({ connectionString: testDatabaseUrl() }); await cl.connect();
    try { const sql = readFileSync(join(dir, name, 'migration.sql'), 'utf8'); await cl.query(sql); await cl.query(sql); } finally { await cl.end(); }
    const names = readdirSync(dir).filter((f) => /^\d{14}_/.test(f)).sort(); const prefixes = names.map((n) => n.slice(0, 14)); expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(names.filter((n) => n.startsWith('20270128')).every((n) => n > '20270107096000')).toBe(true);
  });
});
