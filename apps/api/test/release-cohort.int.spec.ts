import { createCtx, productHeaders, TestCtx } from './harness';

const SNAP = '/api/v1/control/v1/flags/snapshot';

describe('G-COHORT: organisation releaseCohort and cohort-targeted tenant flags', () => {
  let c: TestCtx; let admin: { Authorization: string }; let ops: { Authorization: string };
  beforeAll(async () => { c = await createCtx({ devMarketGate: false }); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset();
    admin = await c.as('admin_1', { roles: ['ops_admin', 'super_admin'] });
    ops = await c.as('ops_1', { roles: ['ops_admin'] });
  });
  const set = (body: object, key = 'clinic.ai_scribe') => c.http().put(`/api/v1/admin/flags/${key}/values`).set(admin).send({ reason: 'pilot rollback', ticket: 'T-9', ...body });
  const attr = (orgRef: string, releaseCohort: string | null) => c.prisma.organisationAttribute.create({ data: { orgRef, releaseCohort } });

  it('default: the attribute is optional and null, nothing changes for any organisation', async () => {
    await attr('org_a', null);
    expect(await c.flags.isEnabled('clinic.ai_scribe', { orgId: 'org_a' })).toBe(true);
    expect(await c.flags.isEnabled('clinic.ai_scribe', { orgId: 'org_unknown' })).toBe(true);
    const list = await c.http().get('/api/v1/admin/organisations/release-cohorts').set(ops).expect(200);
    expect(list.body).toEqual([]); // null cohorts are not listed
  });

  it('a cohort OFF applies to member organisations only, through evaluation and the signed product snapshot', async () => {
    await attr('org_pilot', 'pilot'); await attr('org_ga', 'ga'); await attr('org_none', null);
    const r = await set({ scope: 'COHORT', scopeId: 'Pilot', value: 'OFF' }).expect(200);
    expect(r.body.status).toBe('APPLIED');
    expect(await c.flags.isEnabled('clinic.ai_scribe', { orgId: 'org_pilot' })).toBe(false);
    expect((await c.flags.evaluate('clinic.ai_scribe', { orgId: 'org_pilot' })).reason).toBe('OFF_COHORT');
    expect(await c.flags.isEnabled('clinic.ai_scribe', { orgId: 'org_ga' })).toBe(true);
    expect(await c.flags.isEnabled('clinic.ai_scribe', { orgId: 'org_none' })).toBe(true);
    expect(await c.flags.isEnabled('clinic.ai_scribe', { cohort: 'pilot' })).toBe(false);
    // product snapshot keeps its wire format: the cohort is expanded to the member organisations
    const s = (await c.http().get(`${SNAP}?product=kiorly-clinic`).set(productHeaders('kiorly-clinic', SNAP)).expect(200)).body;
    const f = s.flags.find((x: any) => x.key === 'clinic.ai_scribe');
    expect(f.values.orgs).toEqual({ org_pilot: 'OFF' });
    expect(f.cohortOff).toBeUndefined();
    expect(JSON.stringify(f.values)).not.toContain('cohort');
  });

  it('moving an organisation between cohorts takes effect (cache invalidated on the next flag change or within a second)', async () => {
    await attr('org_x', 'ga');
    await set({ scope: 'COHORT', scopeId: 'pilot', value: 'OFF' }).expect(200);
    expect(await c.flags.isEnabled('clinic.ai_scribe', { orgId: 'org_x' })).toBe(true);
    await c.prisma.organisationAttribute.update({ where: { orgRef: 'org_x' }, data: { releaseCohort: 'pilot' } });
    c.flags.invalidate();
    expect(await c.flags.isEnabled('clinic.ai_scribe', { orgId: 'org_x' })).toBe(false);
  });

  it('switching the cohort value back to ON restores the flag', async () => {
    await attr('org_p', 'pilot');
    await set({ scope: 'COHORT', scopeId: 'pilot', value: 'OFF' }).expect(200);
    await set({ scope: 'COHORT', scopeId: 'pilot', value: 'ON' }).expect(200);
    expect(await c.flags.isEnabled('clinic.ai_scribe', { orgId: 'org_p' })).toBe(true);
  });

  it('cohort scope is only for tenant-level flags and needs a valid cohort token', async () => {
    const notOrg = await set({ scope: 'COHORT', scopeId: 'pilot', value: 'OFF' }, 'kiorex.family_accounts');
    expect(notOrg.status).toBe(400);
    expect(notOrg.body.code ?? notOrg.body.error?.code).toBe('SCOPE_NOT_ALLOWED');
    expect((await set({ scope: 'COHORT', scopeId: 'Not Valid!', value: 'OFF' })).status).toBe(400);
    expect((await set({ scope: 'COHORT', value: 'OFF' })).status).toBe(400);
  });

  it('Ops API is read-only: list and filter for ops, no write route, patients are refused', async () => {
    await attr('org_p1', 'pilot'); await attr('org_p2', 'pilot'); await attr('org_g1', 'ga');
    const all = (await c.http().get('/api/v1/admin/organisations/release-cohorts').set(ops).expect(200)).body;
    expect(all.map((r: any) => r.orgRef)).toEqual(['org_g1', 'org_p1', 'org_p2']);
    const pilot = (await c.http().get('/api/v1/admin/organisations/release-cohorts?cohort=PILOT').set(ops).expect(200)).body;
    expect(pilot.map((r: any) => r.orgRef)).toEqual(['org_p1', 'org_p2']);
    expect(pilot[0]).toEqual({ orgRef: 'org_p1', releaseCohort: 'pilot', updatedAt: expect.any(String) });
    for (const m of ['put', 'post', 'patch', 'delete'] as const) expect((await c.http()[m]('/api/v1/admin/organisations/release-cohorts').set(admin).send({})).status).toBe(404);
    const patient = await c.as('amira');
    await c.http().get('/api/v1/admin/organisations/release-cohorts').set(patient).expect(403);
    await c.http().get('/api/v1/admin/organisations/release-cohorts').expect(401);
  });
});
