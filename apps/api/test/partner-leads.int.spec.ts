import { createHmac } from 'node:crypto';
import { deriveIntakeSigningKey, newIntakeNonce } from '@kiorex/contracts';
import { createCtx, TestCtx } from './harness';
import { resetLeadLimits } from '../src/partner-leads/partner-leads.service';

const LEADS = '/api/v1/partners/v1/leads';
const FUNNEL = '/api/v1/partners/v1/funnel';
const SECRET = 'kiorex-dev-lead-signing-secret';
let n = 0;
const org = () => `lead_org_${Date.now().toString(36)}_${++n}`;
const sign = (body: string, secret = SECRET, ts = Math.floor(Date.now() / 1000)) => ({ 'X-Kiorly-Timestamp': String(ts), 'X-Kiorly-Signature': `sha256=${createHmac('sha256', deriveIntakeSigningKey(secret)).update(`${ts}.${body}`).digest('hex')}`, 'content-type': 'application/json' });
const lead = (orgRef: string, extra: object = {}) => JSON.stringify({ nonce: newIntakeNonce(), kind: 'CLINIC', orgRef, orgName: 'Lead Test Clinic', contactName: 'Dr Test', contactRole: 'Owner', phone: '+201000009999', preferredTime: 'MORNING', note: 'Call after 10', locale: 'en', market: 'EG', consent: true, ...extra });

describe('partner leads ("Talk to us") and the onboarding funnel', () => {
  let c: TestCtx; let ops: { Authorization: string };
  const post = (path: string, body: string, headers: Record<string, string> = sign(body)) => c.http().post(path).set(headers).send(body);
  beforeAll(async () => { c = await createCtx(); ops = await c.as('ops_leads', { roles: ['ops_admin'] }); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => { await resetLeadLimits(); for (const k of ['LEAD_RATE_IP_PER_MIN', 'LEAD_RATE_ORG_PER_HOUR', 'LEAD_RATE_FAILED_PER_10MIN']) delete process.env[k]; });

  it('a signed lead creates one lead per organisation, repeats refresh it, ops lists it with status NEW', async () => {
    const o = org(); const body = lead(o);
    const r = await post(LEADS, body).expect(200); expect(r.body).toMatchObject({ created: true });
    const again = lead(o, { contactName: 'Dr Renamed' }); const r2 = await post(LEADS, again).expect(200);
    expect(r2.body).toMatchObject({ id: r.body.id, created: false });
    const list = (await c.http().get('/api/v1/admin/partner-leads').set(ops).expect(200)).body as any[];
    const row = list.find((x) => x.orgRef === o); expect(row).toMatchObject({ status: 'NEW', contactName: 'Dr Renamed', kind: 'CLINIC', connectionId: null });
    expect(list.filter((x) => x.orgRef === o)).toHaveLength(1);
    await c.http().get('/api/v1/admin/partner-leads').expect(401);
  });

  it('refuses without consent, without any contact, with unknown fields and with bad phone/email (400), and never stores anything', async () => {
    for (const extra of [{ consent: false }, { phone: undefined, email: undefined }, { evil: 1 }, { phone: 'abc' }, { email: 'nope' }, { preferredTime: 'NOON' }, { kind: 'BANK' }, { orgName: '' }]) {
      const o = org(); const body = lead(o, extra); await post(LEADS, body).expect(400);
      expect(await c.prisma.partnerLead.count({ where: { orgRef: o } })).toBe(0);
    }
  });

  it('every authentication failure is the same 401: wrong secret, stale timestamp, tampered body, replayed nonce, missing headers', async () => {
    const answers: string[] = []; const bad = async (body: string, h: Record<string, string>) => { const r = await post(LEADS, body, h); expect(r.status).toBe(401); answers.push(JSON.stringify(r.body)); };
    let b = lead(org()); await bad(b, sign(b, 'another-secret'));
    b = lead(org()); await bad(b, sign(b, SECRET, Math.floor(Date.now() / 1000) - 3600));
    b = lead(org()); await bad(b, { ...sign(b), 'X-Kiorly-Signature': 'sha256=' + '0'.repeat(64) });
    b = lead(org()); await bad(b, { 'content-type': 'application/json' });
    const ok = lead(org()); await post(LEADS, ok).expect(200); await bad(ok, sign(ok)); // replay
    expect(new Set(answers).size).toBe(1);
  });

  it('rate limits per IP and per organisation (429 with Retry-After)', async () => {
    process.env.LEAD_RATE_ORG_PER_HOUR = '2'; const o = org();
    await post(LEADS, lead(o)).expect(200); await post(LEADS, lead(o)).expect(200);
    const r = await post(LEADS, lead(o)).expect(429); expect(r.headers['retry-after']).toBeTruthy();
    await resetLeadLimits(); process.env.LEAD_RATE_IP_PER_MIN = '2';
    await post(LEADS, lead(org())).expect(200); await post(LEADS, lead(org())).expect(200); await post(LEADS, lead(org())).expect(429);
  });

  it('ops sets status, assignee and notes; the lead status follows the onboarding request (submitted, live) and links to it', async () => {
    const o = org(); const { body: { id } } = await post(LEADS, lead(o)).expect(200);
    const p = await c.http().patch(`/api/v1/admin/partner-leads/${id}`).set(ops).send({ status: 'CONTACTED', assignee: 'sara' }).expect(200);
    expect(p.body).toMatchObject({ status: 'CONTACTED', assignee: 'sara' });
    const nn = await c.http().post(`/api/v1/admin/partner-leads/${id}/notes`).set(ops).send({ text: 'Spoke to the owner' }).expect(200);
    expect(nn.body.notes).toHaveLength(1); expect(nn.body.notes[0]).toMatchObject({ text: 'Spoke to the owner', by: expect.any(String) });
    await c.http().patch(`/api/v1/admin/partner-leads/${id}`).set(ops).send({ status: 'NOPE' }).expect(400);
    await c.prisma.partnerConnection.create({ data: { id: `pc_lead_${o}`, kind: 'CLINIC', orgRef: o, name: 'x', statusTokenHash: 'h', status: 'SUBMITTED' } });
    let row = ((await c.http().get('/api/v1/admin/partner-leads?status=SUBMITTED').set(ops).expect(200)).body as any[]).find((x) => x.id === id);
    expect(row).toMatchObject({ status: 'SUBMITTED', connectionId: `pc_lead_${o}` });
    await c.prisma.partnerConnection.update({ where: { id: `pc_lead_${o}` }, data: { status: 'LIVE' } });
    row = ((await c.http().get('/api/v1/admin/partner-leads?status=LIVE').set(ops).expect(200)).body as any[]).find((x) => x.id === id); expect(row).toBeTruthy();
    await c.http().patch(`/api/v1/admin/partner-leads/${id}`).set(ops).send({ status: 'CLOSED' }).expect(200);
    expect(((await c.http().get('/api/v1/admin/partner-leads?status=CLOSED').set(ops)).body as any[]).some((x) => x.id === id)).toBe(true);
  });

  it('funnel counts distinct organisations per stage with conversion, from signed markers and real onboarding requests (no PHI)', async () => {
    const before = (await c.http().get('/api/v1/admin/partner-leads/funnel?days=30&kind=PHARMACY').set(ops).expect(200)).body;
    const mark = (o: string, stage: string) => post(FUNNEL, JSON.stringify({ nonce: newIntakeNonce(), kind: 'PHARMACY', orgRef: o, stage }));
    const a = org(); const b = org(); const d = org();
    await mark(a, 'INTERESTED').expect(200); await mark(a, 'INTERESTED').expect(200); // idempotent
    await mark(b, 'INTERESTED').expect(200); await mark(b, 'STARTED').expect(200);
    await mark(d, 'INTERESTED').expect(200); await mark(d, 'STARTED').expect(200);
    await c.prisma.partnerConnection.create({ data: { id: `pc_f_${d}`, kind: 'PHARMACY', orgRef: d, name: 'x', statusTokenHash: 'h', status: 'LIVE' } });
    await post(FUNNEL, JSON.stringify({ nonce: newIntakeNonce(), kind: 'PHARMACY', orgRef: a, stage: 'LIVE' })).expect(400);
    await post(FUNNEL, JSON.stringify({ nonce: newIntakeNonce(), kind: 'PHARMACY', orgRef: a, stage: 'INTERESTED', patientName: 'x' })).expect(400);
    const f = (await c.http().get('/api/v1/admin/partner-leads/funnel?days=30&kind=PHARMACY').set(ops).expect(200)).body;
    const by = (x: any, s: string) => x.stages.find((r: any) => r.stage === s).count;
    expect(by(f, 'interested') - by(before, 'interested')).toBe(3); expect(by(f, 'started') - by(before, 'started')).toBe(2);
    expect(by(f, 'submitted') - by(before, 'submitted')).toBe(1); expect(by(f, 'live') - by(before, 'live')).toBe(1);
    expect(f.stages[1].fromPrevious).toEqual(expect.any(Number));
    expect(JSON.stringify(f)).not.toContain(a);
  });
});
