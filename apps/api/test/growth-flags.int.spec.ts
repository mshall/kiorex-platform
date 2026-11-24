import { createCtx, TestCtx } from './harness';
import { GROWTH_FLAG, GROWTH_LAUNCH_LOCKED_FLAGS } from '../src/growth/growth-public';

/** GRW-P1-B0 flag registrations (ADR-023/024/025): seeded, ON by default unless counsel-gated, switchable OFF at global and market scope. */
describe('growth flags in the control plane', () => {
  let c: TestCtx;
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => { await c.reset(); });

  const all = Object.values(GROWTH_FLAG);
  it('every growth flag is a seeded definition', async () => {
    const keys = (await c.prisma.flagDefinition.findMany({ where: { key: { in: [...all] } } })).map((f) => f.key);
    expect(keys.sort()).toEqual([...all].sort());
  });

  it('non-locked growth flags are effective by default; launch-locked ones are OFF until gate evidence exists (scope GATE)', async () => {
    c.flags.invalidate();
    for (const k of all) {
      const r = await c.flags.evaluate(k, { market: 'EG' });
      if (GROWTH_LAUNCH_LOCKED_FLAGS.includes(k)) expect({ k, effective: r.effective, scope: r.scope }).toEqual({ k, effective: false, scope: 'GATE' });
      else if (r.scope === 'DEPENDENCY') expect(r.effective).toBe(false); // depends on a locked flag (growth.experiments)
      else expect({ k, effective: r.effective }).toEqual({ k, effective: true });
    }
  });

  it('OFF at global scope switches a growth capability off and ON restores it; growth.provider_links honours org scope', async () => {
    const admin = await c.as('adm1', { roles: ['super_admin', 'ops_admin'] });
    const put = (key: string, body: object) => c.http().put(`/api/v1/admin/flags/${key}/values`).set(admin).send({ reason: 'test', ticket: 'T-1', emergency: true, ...body });
    await put('growth.attribution', { scope: 'GLOBAL', value: 'OFF' }).expect(200);
    expect((await c.flags.evaluate('growth.attribution', { market: 'EG' })).effective).toBe(false);
    await put('growth.attribution', { scope: 'GLOBAL', value: 'ON', emergency: false }).expect(200);
    expect((await c.flags.evaluate('growth.attribution', { market: 'EG' })).effective).toBe(true);
    await put('growth.provider_links', { scope: 'ORG', scopeId: 'org_x', value: 'OFF' }).expect(200);
    expect((await c.flags.evaluate('growth.provider_links', { orgId: 'org_x' })).effective).toBe(false);
    expect((await c.flags.evaluate('growth.provider_links', { orgId: 'org_y' })).effective).toBe(true);
    expect((await put('growth.attribution', { scope: 'ORG', scopeId: 'org_x', value: 'OFF' })).body.code).toBe('SCOPE_NOT_ALLOWED');
  });

  it('the Kiorly Clinic snapshot carries growth.provider_links and the Kiorex snapshot the others', async () => {
    const { productHeaders } = await import('./harness');
    const path = '/api/v1/control/v1/flags/snapshot';
    const clinic = await c.http().get(`${path}?product=kiorly-clinic`).set(productHeaders('kiorly-clinic', path)).expect(200);
    expect(clinic.body.flags.map((f: any) => f.key)).toContain('growth.provider_links');
    const kx = await c.http().get(`${path}?product=kiorex`).set(productHeaders('kiorex', path)).expect(200);
    expect(kx.body.flags.map((f: any) => f.key)).toEqual(expect.arrayContaining(['growth.attribution', 'growth.widgets', 'growth.rewards']));
  });
});
