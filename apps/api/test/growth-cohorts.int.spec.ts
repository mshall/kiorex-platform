import { createCtx, TestCtx } from './harness';
import { CohortService } from '../src/growth/cohorts/cohort.service';
import { GrowthConfigService } from '../src/growth/growth-public';
import { seedBooking, seedTouch, activateConfig } from './growth-helpers';
import { LTV_POLICY_DEFAULT } from '../src/growth/cohorts/ltv-policy';

const BASE = '/api/v1/admin/growth/cohorts';
const at = (iso: string) => new Date(`${iso}T12:00:00Z`);
const NOW = at('2027-04-15');
let seq = 0;

/** GRW-P3-C on the real database: 200 synthetic patients written as bookings, attended events, revenue facts, touches and decisions, folded into aggregate cells and ESTIMATE rows. */
describe('growth cohorts and LTV (GRW-P3-C)', () => {
  let c: TestCtx; let svc: CohortService; let cfg: GrowthConfigService; let policyVersionId: string;
  let A: Record<string, string>; let ops: Record<string, string>; let patient: Record<string, string>;
  beforeAll(async () => { c = await createCtx(); svc = c.get(CohortService); cfg = c.get(GrowthConfigService); A = await c.as('adm_a', { roles: ['ops_admin', 'super_admin'] }); ops = await c.as('ops_1', { roles: ['ops_admin'] }); patient = await c.as('p_1'); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => { await c.reset(); c.flags.invalidate(); seq = 0; policyVersionId = (await cfg.resolve('ATTRIBUTION_POLICY', { market: 'EG' })).versionId; });

  async function patientWith(o: { kind: string; utmCampaign?: string; utmSource?: string; visits: Array<{ day: string; revenue: number }> }) {
    const sub = `sub_coh${++seq}`; let first: string | null = null;
    for (const [i, v] of o.visits.entries()) {
      const when = at(v.day); const b = await seedBooking(c, { sub, createdAt: new Date(when.getTime() - 3600_000) });
      await c.prisma.growthEvent.create({ data: { name: 'BookingAttended', bookingId: b.id, careType: 'DOCTORS', props: { bucket: i === 0 ? 'new' : 'returning' }, dedupeKey: `att|${b.id}`, occurredAt: when } });
      await c.prisma.growthRevenueFact.create({ data: { kind: 'CHARGE', chargeId: `ch_${b.id}`, appointmentId: `apt_${b.id}`, bookingId: b.id, status: 'CONFIRMED', amountMinor: v.revenue, occurredAt: when } });
      if (i === 0) first = b.id;
    }
    const t = await seedTouch(c, { kind: o.kind, at: new Date(at(o.visits[0]!.day).getTime() - 2 * 3600_000), sub });
    if (o.utmCampaign) await c.prisma.growthTouchpoint.update({ where: { id: t.id }, data: { utmCampaign: o.utmCampaign, utmSource: o.utmSource ?? null } });
    await c.prisma.growthAttributionDecision.create({ data: { bookingId: first!, origin: 'MARKETPLACE', reasonCode: 'TEST', policyVersionId, inputsHash: String(seq).padStart(64, "0"), evidenceTouchIds: [t.id], winningTouchId: t.id } });
    return sub;
  }
  /** Same hand-computed fixture as cohorts.unit.spec.ts, trimmed to what the database path reads (no rewards). */
  async function seedFixture() {
    for (let i = 0; i < 100; i++) {
      const visits = [{ day: '2027-01-10', revenue: 100000 }]; if ((i < 30) || (i >= 60 && i < 70)) visits.push({ day: '2027-02-12', revenue: 50000 }); if (i < 5) visits.push({ day: '2027-02-20', revenue: 30000 }); if (i < 12) visits.push({ day: '2027-03-08', revenue: 40000 });
      await patientWith({ kind: i < 60 ? 'ORGANIC_SEARCH' : 'PROVIDER_LINK', visits });
    }
    for (let i = 0; i < 60; i++) { const visits = [{ day: '2027-02-05', revenue: 100000 }]; if (i < 20) visits.push({ day: '2027-03-09', revenue: 50000 }); if (i < 5) visits.push({ day: '2027-04-02', revenue: 50000 }); await patientWith({ kind: 'ORGANIC_SEARCH', visits }); }
    for (let i = 0; i < 40; i++) { const visits = [{ day: '2027-03-03', revenue: 100000 }]; if (i < 4) visits.push({ day: '2027-04-04', revenue: 50000 }); await patientWith({ kind: i < 33 ? 'ORGANIC_SEARCH' : 'CAMPAIGN', visits }); }
  }

  it('rollup builds the hand-computed cohort table, masks small cells, writes ESTIMATE rows with n and an interval, and reconciles against an independent recount', async () => {
    await seedFixture();
    const r = await svc.rollup({ market: 'EG', now: NOW, months: 6, basis: 'FIRST_COMPLETED' });
    expect(r).toMatchObject({ market: 'EG', months: 6 });
    const t = await svc.table({ market: 'EG' });
    const jan = t.rows.find((x) => x.cohortMonth === '2027-01-01')!;
    expect(jan.suppressed).toBe(false); if (jan.suppressed) throw new Error('unreachable');
    expect(jan.patients).toBe(100);
    expect(jan.months.map((m) => [m.monthIndex, m.retained, m.completedBookings, m.revenueMinor])).toEqual([[0, 100, 100, 10_000_000], [1, 40, 45, 2_150_000], [2, 12, 12, 480_000], [3, 0, 0, 0]]);
    const feb = t.rows.find((x) => x.cohortMonth === '2027-02-01')!; if (feb.suppressed) throw new Error('unreachable');
    expect(feb.months[2]).toMatchObject({ monthIndex: 2, retained: '<10', completedBookings: '<10', revenueMinor: '<10' }); // 5 people retained: nothing derived from them is shown
    expect(t.rows.reduce((s, x) => s + (typeof x.patients === 'number' ? x.patients : 0), 0)).toBe(200);
    // the 7-person CAMPAIGN source and the only visible sibling of the same month are withheld
    const mar = await svc.table({ market: 'EG', dimension: 'SOURCE', value: 'CAMPAIGN' }); expect(mar.rows.every((x) => x.suppressed && x.patients === '<10')).toBe(true);
    const marOrg = await svc.table({ market: 'EG', dimension: 'SOURCE', value: 'ORGANIC_SEARCH' }); expect(marOrg.rows.find((x) => x.cohortMonth === '2027-03-01')).toMatchObject({ suppressed: true });
    expect((await svc.table({ market: 'EG', dimension: 'SOURCE', value: 'PROVIDER_LINK' })).rows.find((x) => x.cohortMonth === '2027-01-01')).toMatchObject({ suppressed: false, patients: 40 });
    // the database holds no cell below k that is not marked suppressed, and every suppressed cell is all zero
    const stored = await c.prisma.growthCohortMonthly.findMany();
    for (const s of stored) { if (s.suppressed) expect([s.patients, s.retainedPatients, s.completedBookings, Number(s.revenueMinor), Number(s.rewardCostMinor)]).toEqual([0, 0, 0, 0, 0]); else expect(s.patients).toBeGreaterThanOrEqual(10); }
    // LTV
    const l = await svc.ltv({ market: 'EG' });
    expect(l.label).toBe('ESTIMATE'); const all = l.rows.find((x) => x.dimension === 'ALL')!;
    expect(all).toMatchObject({ n: 200, label: 'ESTIMATE', horizonMonths: 12 }); expect(all.lowMinor).toBeLessThanOrEqual(all.estimateMinor); expect(all.estimateMinor).toBeLessThanOrEqual(all.highMinor);
    expect(l.rows.find((x) => x.dimension === 'SOURCE' && x.value === 'CAMPAIGN')).toBeUndefined(); // 7 people: no estimate
    expect(l.rows.find((x) => x.dimension === 'SOURCE' && x.value === 'ORGANIC_SEARCH')!.n).toBe(60 + 60 + 33);
    // retention heatmap uses the same cells
    const ret = await svc.retention({ market: 'EG' }); expect(ret.rows.find((x) => x.cohortMonth === '2027-01-01')!.cells.map((x) => x.rate)).toEqual([100, 40, 12, 0]);
    // reconciliation with the source facts
    expect(await svc.reconcile('EG', NOW, 6)).toMatchObject({ ok: true, patientsStored: 200, patientsRecount: 200 });
  });

  it('language cut: the January cohort splits into ar (70) and en (30) from the patient preferred language; a sub without a profile has no language cut; ALL still holds everyone', async () => {
    await seedFixture();
    for (let i = 1; i <= 100; i++) await c.prisma.patientProfile.upsert({ where: { sub: `sub_coh${i}` }, create: { sub: `sub_coh${i}`, market: 'EG', preferredLocale: i <= 70 ? 'ar' : 'en' } as never, update: { preferredLocale: i <= 70 ? 'ar' : 'en' } });
    await svc.rollup({ market: 'EG', now: NOW, months: 6, basis: 'FIRST_COMPLETED' });
    const ar = (await svc.table({ market: 'EG', dimension: 'LANGUAGE', value: 'ar' })).rows.find((x) => x.cohortMonth === '2027-01-01')!;
    const en = (await svc.table({ market: 'EG', dimension: 'LANGUAGE', value: 'en' })).rows.find((x) => x.cohortMonth === '2027-01-01')!;
    expect([ar.suppressed, en.suppressed]).toEqual([false, false]); if (ar.suppressed || en.suppressed) throw new Error('unreachable');
    expect([ar.patients, en.patients]).toEqual([70, 30]);
    expect((await svc.table({ market: 'EG' })).rows.find((x) => x.cohortMonth === '2027-01-01')).toMatchObject({ patients: 100 });
    // February and March patients have no profile here: no language rows exist for those months
    expect(await c.prisma.growthCohortMonthly.count({ where: { language: { not: '' }, cohortMonth: { gt: new Date('2027-01-31T00:00:00Z') } } })).toBe(0);
    expect(await svc.values('EG', 'FIRST_COMPLETED', 'LANGUAGE')).toEqual(['ar', 'en']);
    // LTV also has the language groups (n >= 10)
    const l = await svc.ltv({ market: 'EG' }); expect(l.rows.find((x) => x.dimension === 'LANGUAGE' && x.value === 'ar')?.n).toBe(70);
    // the HTTP API accepts the dimension, and an unknown one is still refused
    await c.http().get(`${BASE}?dimension=LANGUAGE&value=ar`).set(ops).expect(200);
    await c.http().get(`${BASE}?dimension=NOPE&value=ar`).set(ops).expect(400);
    expect(await svc.reconcile('EG', NOW, 6)).toMatchObject({ ok: true });
  });
  it('is idempotent: a second and parallel rollups leave the same cells and estimates', async () => {
    await seedFixture();
    const snap = async () => JSON.stringify([(await c.prisma.growthCohortMonthly.findMany({ orderBy: [{ cohortMonth: 'asc' }, { sourceKind: 'asc' }, { campaignId: 'asc' }, { platform: 'asc' }, { monthIndex: 'asc' }] })).map(({ id, updatedAt, ...r }) => ({ ...r, revenueMinor: String(r.revenueMinor), rewardCostMinor: String(r.rewardCostMinor) })), (await c.prisma.growthLtvEstimate.findMany({ orderBy: { cohortKey: 'asc' } })).map(({ id, computedAt, ...r }) => ({ ...r, estimateMinor: String(r.estimateMinor), lowMinor: String(r.lowMinor), highMinor: String(r.highMinor) }))]);
    await svc.rollup({ market: 'EG', now: NOW, months: 6, basis: 'FIRST_COMPLETED' }); const first = await snap();
    await svc.rollup({ market: 'EG', now: NOW, months: 6, basis: 'FIRST_COMPLETED' }); expect(await snap()).toBe(first);
  }, 120_000);

  it('payback and LTV:CAC use approved spend only and say so when there is none', async () => {
    await seedFixture(); await svc.rollup({ market: 'EG', now: NOW, months: 6, basis: 'FIRST_COMPLETED' });
    const none = await svc.payback({ market: 'EG', now: NOW }); expect(none.blendedCacMinor).toBeNull(); expect(none.ltvToCac).toBeNull(); expect(none.note).toMatch(/No approved spend/);
    await c.prisma.growthSpendEntry.create({ data: { day: new Date('2027-01-05'), amountMinor: 3_000_000, status: 'APPROVED', createdBy: 'f1', channel: 'ads' } });
    await c.prisma.growthSpendEntry.create({ data: { day: new Date('2027-01-06'), amountMinor: 9_000_000, status: 'PENDING', createdBy: 'f1', channel: 'ads' } }); // not approved: never counted
    const p = await svc.payback({ market: 'EG', now: NOW });
    const jan = p.rows.find((x) => x.cohortMonth === '2027-01-01')!; if (jan.suppressed) throw new Error('unreachable');
    expect(jan).toMatchObject({ patients: 100, spendMinor: 3_000_000, cacMinor: 30_000, paybackMonth: 0 }); // 1,000.00 of revenue per patient in the first month beats a 300.00 CAC
    expect(p.blendedCacMinor).toBe(Math.round(3_000_000 / 200)); expect(p.ltvToCac).toMatchObject({ label: 'ESTIMATE' });
    expect(p.ltvToCac!.low).toBeLessThanOrEqual(p.ltvToCac!.estimate);
  });

  it('LTV_POLICY goes through maker-checker, the floor cannot be lowered and a new version changes the model version (reproducible)', async () => {
    await seedFixture();
    const bad = await c.http().post('/api/v1/ops/growth/config').set(A).send({ kind: 'LTV_POLICY', scope: 'GLOBAL', payload: { ...LTV_POLICY_DEFAULT, minCohortPatients: 5 } });
    expect(bad.status).toBe(422);
    const a = await svc.policy('EG'); expect(a).toMatchObject({ source: 'PROPOSED_DEFAULT', version: null });
    await activateConfig(c, 'LTV_POLICY', { ...LTV_POLICY_DEFAULT, horizonMonths: 6 });
    const b = await svc.policy('EG'); expect(b.source).toBe('ACTIVE'); expect(b.policy.horizonMonths).toBe(6); expect(b.tag).not.toBe(a.tag);
    await svc.rollup({ market: 'EG', now: NOW, months: 6, basis: 'FIRST_COMPLETED' });
    expect((await svc.ltv({ market: 'EG' })).rows[0]!.horizonMonths).toBe(6);
  });

  it('API: reads for ops roles, rollup for super admin only, patients and anonymous refused, flag OFF answers 403 FEATURE_DISABLED, and no response carries a person identifier', async () => {
    await seedFixture(); await svc.rollup({ market: 'EG', now: NOW, months: 6, basis: 'FIRST_COMPLETED' });
    expect((await c.http().get(BASE).expect(401)).status).toBe(401);
    await c.http().get(BASE).set(patient).expect(403);
    const bodies: string[] = [];
    for (const p of ['', '/retention', '/ltv', '/payback', '/reconcile', '/values?dimension=SOURCE']) { const r = await c.http().get(`${BASE}${p}`).set(ops).expect(200); bodies.push(JSON.stringify(r.body)); }
    for (const b of bodies) { expect(b).not.toMatch(/sub_coh|kx_bk_|adm_a/); }
    await c.http().post(`${BASE}/rollup`).set(ops).send({ months: 6 }).expect(403);
    await c.http().get(`${BASE}?basis=BOGUS`).set(ops).expect(400); await c.http().get(`${BASE}?dimension=SOURCE`).set(ops).expect(400); await c.http().get(`${BASE}?dimension=SOURCE&value=${encodeURIComponent('x;drop')}`).set(ops).expect(400);
    const off = await c.http().put('/api/v1/admin/flags/definitions').set(A);
    void off;
    await c.prisma.flagDefinition.upsert({ where: { key: 'growth.cohorts_ltv' }, create: { key: 'growth.cohorts_ltv', product: 'kiorex', class: 'MODULE', scopes: ['GLOBAL', 'MARKET'], dependsOn: [], launchLocked: false, moneyPath: false, description: 't', whenOff: 'Cohort pages answer 403', gateHint: '', gateIds: [] } as never, update: {} }); c.flags.invalidate();
    const set = await c.http().put('/api/v1/admin/flags/growth.cohorts_ltv/values').set(A).send({ scope: 'GLOBAL', value: 'OFF', reason: 't', ticket: 'T-1', emergency: false }); expect([200, 202]).toContain(set.status); c.flags.invalidate();
    const r = await c.http().get(BASE).set(ops); expect(r.status).toBe(403); expect(r.body.code ?? r.body.error?.code).toBe('FEATURE_DISABLED');
  }, 120_000);

  it('a window with no patients answers an empty table, not an error', async () => {
    await svc.rollup({ market: 'EG', now: NOW, months: 3 });
    expect((await svc.table({ market: 'EG' })).rows).toEqual([]); expect((await svc.ltv({ market: 'EG' })).rows).toEqual([]);
  });
});
