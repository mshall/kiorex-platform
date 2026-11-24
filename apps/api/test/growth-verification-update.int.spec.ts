import { validateEvent } from '@kiorex/contracts';
import { createCtx, TestCtx } from './harness';
import { KiorlyClient } from '../src/kiorly/kiorly-public';

/** GRW-P2-C: the Clinic asks Kiorex ops to update a verified field; Kiorex queues it (no new table), ops reads the value live and decides, the decision goes back to the Clinic. */
describe('provider verification update requests (contracts 1.12.0)', () => {
  let c: TestCtx; let ops: { Authorization: string }; let sa: { Authorization: string };
  const ORG = `vu_org_${Date.now().toString(36)}`; let connId: string;
  const REQ = `vu_req_${Date.now().toString(36)}`;
  const requested = (ref = REQ, extra: Record<string, unknown> = {}) => c.webhook('ProviderVerificationUpdateRequested', { requestRef: ref, orgRef: ORG, clinicId: 'cl_1', field: 'LICENSE_NUMBER', evidenceCount: 2, requestedAt: new Date().toISOString(), ...extra }, { aggregateType: 'ProviderVerificationUpdate', aggregateId: ref, eventId: `vu_${ref}_${Math.random()}` });
  const calls: { method: string; path: string; body?: any }[] = [];

  beforeAll(async () => {
    c = await createCtx();
    ops = await c.as('ops_vu', { roles: ['ops_admin'] }); sa = await c.as('sa_vu', { roles: ['super_admin'] });
    connId = `pc_vu_${Date.now().toString(36)}`;
    await c.prisma.partnerConnection.create({ data: { id: connId, kind: 'CLINIC', orgRef: ORG, name: 'VU Clinic', statusTokenHash: 'x', status: 'LIVE' } as any });
    jest.spyOn(c.get(KiorlyClient), 'request').mockImplementation((async (r: any) => {
      calls.push({ method: r.method, path: r.path, body: r.body });
      if (r.method === 'GET') return { status: 200, data: { requestRef: REQ, orgRef: ORG, field: 'LICENSE_NUMBER', newValue: 'EG-LIC-998877', evidenceFileRefs: ['uploads/lic.pdf'], status: 'SUBMITTED' } };
      return { status: 200, data: { ok: true, status: r.body.decision } };
    }) as any);
  });
  afterAll(async () => { await c.prisma.partnerConnection.delete({ where: { id: connId } }).catch(() => undefined); await c.close(); });

  it('the example event validates against the contract and the webhook queues an item without the value', async () => {
    const ev = { eventId: 'x', type: 'ProviderVerificationUpdateRequested', aggregateType: 'ProviderVerificationUpdate', aggregateId: REQ, occurredAt: new Date().toISOString(), data: { requestRef: REQ, orgRef: ORG, clinicId: 'cl_1', field: 'LICENSE_NUMBER', evidenceCount: 2, requestedAt: new Date().toISOString() } };
    expect(validateEvent('ProviderVerificationUpdateRequested', ev).valid).toBe(true);
    const r = await requested();
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('APPLIED');
    const row = await c.prisma.partnerConnection.findUniqueOrThrow({ where: { id: connId } });
    const item = (row.human as any).verificationUpdates[REQ];
    expect(item).toMatchObject({ field: 'LICENSE_NUMBER', evidenceCount: 2, status: 'OPEN', clinicId: 'cl_1' });
    expect(JSON.stringify(row.human)).not.toContain('998877');
    expect(await c.prisma.auditLog.count({ where: { action: 'partner_onboarding.verification_update_requested', resourceId: connId } })).toBe(1);
  });

  it('unknown organisations, bad fields and bad refs are acknowledged and ignored (never a retried 500)', async () => {
    expect((await requested('vu_other_1', { orgRef: 'no_such_org' })).body.status).toBe('IGNORED');
    expect((await requested('vu_other_2', { field: 'PASSWORD' })).body.status).toBe('IGNORED');
    expect((await requested('bad ref!', {})).body.status).toBe('IGNORED');
  });

  it('ops list shows it open first; the detail reads the requested value live from the Clinic; a role without ops is refused', async () => {
    const list = (await c.http().get('/api/v1/admin/onboarding/verification-updates').set(ops).expect(200)).body;
    expect(list.find((i: any) => i.requestRef === REQ)).toMatchObject({ status: 'OPEN', organisation: 'VU Clinic', orgRef: ORG });
    expect(JSON.stringify(list)).not.toContain('998877');
    const d = (await c.http().get(`/api/v1/admin/onboarding/verification-updates/${REQ}`).set(ops).expect(200)).body;
    expect(d.live.newValue).toBe('EG-LIC-998877');
    expect(calls.find((x) => x.method === 'GET')?.path).toBe(`/provider-verification/requests/${REQ}`);
    await c.http().get('/api/v1/admin/onboarding/verification-updates').expect(401);
    await c.http().get('/api/v1/admin/onboarding/verification-updates').set(await c.as('p1', { roles: ['patient'] })).expect(403);
  });

  it('NEEDS_INFO needs a note, goes to the Clinic as the contract body and keeps the item decidable after a re-sent request', async () => {
    await c.http().post(`/api/v1/admin/onboarding/verification-updates/${REQ}/decide`).set(ops).send({ decision: 'REJECTED' }).expect(400);
    await c.http().post(`/api/v1/admin/onboarding/verification-updates/${REQ}/decide`).set(ops).send({ decision: 'MAYBE', note: 'x' }).expect(400);
    const r = await c.http().post(`/api/v1/admin/onboarding/verification-updates/${REQ}/decide`).set(ops).send({ decision: 'NEEDS_INFO', note: 'Please add a utility bill' }).expect(200);
    expect(r.body.status).toBe('NEEDS_INFO');
    const post = calls.filter((x) => x.method === 'POST').pop()!;
    expect(post.path).toBe('/provider-verification/decisions');
    expect(post.body).toMatchObject({ requestRef: REQ, orgRef: ORG, clinicId: 'cl_1', decision: 'NEEDS_INFO', note: 'Please add a utility bill' });
    const ev = { eventId: 'x', type: 'ProviderVerificationDecided', aggregateType: 'ProviderVerificationUpdate', aggregateId: REQ, occurredAt: new Date().toISOString(), data: post.body };
    expect(validateEvent('ProviderVerificationDecided', ev).valid).toBe(true);
    await c.http().post(`/api/v1/admin/onboarding/verification-updates/${REQ}/decide`).set(ops).send({ decision: 'APPROVED' }).expect(409); // already decided
    await requested(REQ, { evidenceCount: 3 }); // the provider answered: the same request re-opens
    const again = (await c.http().get('/api/v1/admin/onboarding/verification-updates?status=OPEN').set(ops).expect(200)).body;
    expect(again.find((i: any) => i.requestRef === REQ)).toMatchObject({ status: 'OPEN', evidenceCount: 3 });
    const ok = await c.http().post(`/api/v1/admin/onboarding/verification-updates/${REQ}/decide`).set(sa).send({ decision: 'APPROVED' }).expect(200);
    expect(ok.body.status).toBe('APPROVED');
    expect(await c.prisma.auditLog.count({ where: { action: 'partner_onboarding.verification_update_decided', resourceId: connId } })).toBe(2);
  });

  it('when the Clinic cannot be reached the item stays open so ops can retry', async () => {
    const ref = `${REQ}_b`;
    await requested(ref);
    const spy = jest.spyOn(c.get(KiorlyClient), 'request').mockRejectedValueOnce(new Error('network down'));
    await c.http().post(`/api/v1/admin/onboarding/verification-updates/${ref}/decide`).set(ops).send({ decision: 'APPROVED' }).expect(500);
    spy.mockRestore();
    const row = await c.prisma.partnerConnection.findUniqueOrThrow({ where: { id: connId } });
    expect((row.human as any).verificationUpdates[ref].status).toBe('OPEN');
  });
});
