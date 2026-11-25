import { createCtx, TestCtx } from './harness';
import { PolicyService } from '../src/growth/policy/policy.service';
import { clearPolicyOverrides } from '../src/growth/policy/policy-registry';
import { INTEGRATIONS, INTEGRATION_KEYS } from '../src/growth/integrations-center/integration-registry';

type Auth = { Authorization: string };
const B = '/api/v1/admin/integrations-center';
const SECRET_VALUE = 'sk_live_THIS_MUST_NEVER_APPEAR_123456';

/** Integrations Control Center over the real HTTP stack and Postgres: every integration listed, names and booleans only, roles, mock-safe check, test send, maker-checker mode switch, drift. */
describe('Integrations Control Center', () => {
  let c: TestCtx; let A: Auth; let Bd: Auth; let ops: Auth; let patient: Auth;
  const saved: Record<string, string | undefined> = {};
  const setEnv = (k: string, v: string | undefined) => { if (!(k in saved)) saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } clearPolicyOverrides(); await c.close(); });
  beforeEach(async () => {
    await c.reset(); clearPolicyOverrides();
    A = await c.as('adm_a', { roles: ['ops_admin', 'super_admin'] }); Bd = await c.as('adm_b', { roles: ['ops_admin', 'super_admin'] }); ops = await c.as('ops_1', { roles: ['ops_admin'] }); patient = await c.as('pat_1', { roles: ['patient'] });
    for (const k of ['SMS_MODE', 'PAYMENT_MODE', 'PAYMENT_PROVIDER', 'PAYMENT_ENABLED_PSPS', 'SMS_API_KEY', 'SMS_API_URL', 'SMS_SENDER_ID', 'SMS_WEBHOOK_SECRET', 'PUBLIC_BASE_URL']) setEnv(k, undefined);
  });

  it('lists every integration with names and booleans only, and no secret value anywhere in the response', async () => {
    setEnv('SMS_API_KEY', SECRET_VALUE); setEnv('PAYMOB_SECRET_KEY', SECRET_VALUE);
    const r = await c.http().get(B).set(ops).expect(200);
    expect(r.body.integrations.map((i: { key: string }) => i.key).sort()).toEqual([...INTEGRATION_KEYS].sort());
    expect(INTEGRATIONS.length).toBe(INTEGRATION_KEYS.length);
    expect(JSON.stringify(r.body)).not.toContain(SECRET_VALUE);
    const sms = r.body.integrations.find((i: { key: string }) => i.key === 'SMS');
    expect(sms).toMatchObject({ mode: 'mock', approvedMode: 'mock', drift: 'NONE', secretRefSet: false, runbook: 'INTEGRATION_RUNBOOK_MESSAGING.md#sms', webhook: { path: '/api/v1/messaging/webhooks/sms' } });
    expect(sms.env.find((e: { name: string }) => e.name === 'SMS_API_KEY')).toEqual({ name: 'SMS_API_KEY', required: true, set: true });
    expect(r.body.canManage).toBe(false);
    expect(r.body.integrations.find((i: { key: string }) => i.key === 'CRUX').circuit).toMatchObject({ state: 'CLOSED' });
    expect(r.body.integrations.find((i: { key: string }) => i.key === 'OBJECT_STORAGE')).toMatchObject({ observable: false, owner: 'clinic', mode: null });
  });
  it('roles: patients are refused, ops admins read only, super admin can manage', async () => {
    await c.http().get(B).set(patient).expect(403);
    await c.http().post(`${B}/SMS/check`).set(ops).expect(403);
    await c.http().post(`${B}/SMS/test-send`).set(ops).send({ to: '+201000000001' }).expect(403);
    await c.http().post(`${B}/SMS/propose-mode`).set(ops).send({ mode: 'real', reason: 'go live with the pilot' }).expect(403);
    expect((await c.http().get(B).set(A).expect(200)).body.canManage).toBe(true);
  });
  it('a real mode with missing variables is not ready and the check names the variables, never a value', async () => {
    setEnv('SMS_MODE', 'real'); setEnv('SMS_API_KEY', SECRET_VALUE);
    const o = (await c.http().get(B).set(A).expect(200)).body.integrations.find((i: { key: string }) => i.key === 'SMS');
    expect(o).toMatchObject({ mode: 'real', ready: false, drift: 'REAL_NOT_APPROVED' });
    const chk = (await c.http().post(`${B}/SMS/check`).set(A).expect(200)).body;
    expect(chk.ok).toBe(false); expect(chk.detail).toMatch(/SMS_API_URL/); expect(JSON.stringify(chk)).not.toContain(SECRET_VALUE);
    const again = (await c.http().get(B).set(A).expect(200)).body.integrations.find((i: { key: string }) => i.key === 'SMS');
    expect(again.lastCheck).toMatchObject({ ok: false, by: 'adm_a' });
  });
  it('a mock check answers a synthetic OK; a Clinic-owned integration says it cannot be observed from here', async () => {
    expect((await c.http().post(`${B}/EMAIL/check`).set(A).expect(200)).body).toMatchObject({ ok: true, mode: 'mock' });
    expect((await c.http().post(`${B}/OBJECT_STORAGE/check`).set(A).expect(200)).body.detail).toMatch(/verify/i);
    await c.http().post(`${B}/NOT_A_THING/check`).set(A).expect(400);
  });
  it('test send goes through the mock adapter only; a real mode is refused; a non-sending integration is refused', async () => {
    const ok = (await c.http().post(`${B}/SMS/test-send`).set(A).send({ to: '+201000000001' }).expect(200)).body;
    expect(ok).toMatchObject({ ok: true, mode: 'mock' }); expect(ok.providerRef).toMatch(/^mock_sms_/); expect(ok.to).not.toContain('201000000001');
    await c.http().post(`${B}/PAYMOB/test-send`).set(A).send({ to: '+201000000001' }).expect(400);
    setEnv('SMS_MODE', 'real'); await c.http().post(`${B}/SMS/test-send`).set(A).send({ to: '+201000000001' }).expect(409);
  });
  it('a switch to real is a maker-checker proposal: one super admin proposes, a different one approves, then the approval shows (and drift flips to approved-not-deployed)', async () => {
    const p = (await c.http().post(`${B}/WHATSAPP_CLOUD/propose-mode`).set(A).send({ mode: 'real', reason: 'Pilot clinics go live on 1 December' }).expect(200)).body;
    expect(p).toMatchObject({ status: 'PENDING_APPROVAL', key: 'WHATSAPP_CLOUD', mode: 'real' });
    expect((await c.http().get(B).set(A).expect(200)).body.pendingProposal).toMatchObject({ id: p.id, modes: { WHATSAPP_CLOUD: 'real' } });
    await c.http().post(`/api/v1/ops/growth/config/${p.id}/approve`).set(A).expect(403);
    await c.http().post(`/api/v1/ops/growth/config/${p.id}/approve`).set(Bd).expect(200);
    await c.get(PolicyService).refresh();
    const w = (await c.http().get(B).set(A).expect(200)).body.integrations.find((i: { key: string }) => i.key === 'WHATSAPP_CLOUD');
    expect(w).toMatchObject({ approvedMode: 'real', mode: 'mock', drift: 'APPROVED_NOT_DEPLOYED' });
  });
  it('a proposal needs a real reason and a valid mode', async () => {
    await c.http().post(`${B}/SMS/propose-mode`).set(A).send({ mode: 'real', reason: 'short' }).expect(400);
    await c.http().post(`${B}/SMS/propose-mode`).set(A).send({ mode: 'sandbox', reason: 'a long enough reason' }).expect(400);
  });
});
