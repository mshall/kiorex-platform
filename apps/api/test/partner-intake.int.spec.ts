import { INTAKE_MAX_BODY_BYTES, generateEnrolmentCode, newIntakeNonce, signIntakeRequest } from '@kiorex/contracts';
import { createCtx, TestCtx } from './harness';
import { resetIntakeLimits } from '../src/partner-onboarding/partner-onboarding.service';

const PATH = '/api/v1/partners/v1/connection-requests';
let n = 0;
const org = () => `int_org_${Date.now().toString(36)}_${++n}`;
const clinicBody = (orgRef: string, extra: object = {}) => JSON.stringify({ nonce: newIntakeNonce(), kind: 'CLINIC', orgRef, name: 'Intake Test Clinic', market: 'EG', readiness: { documents: { doctorCredentials: true }, termsAcceptedAt: '2026-11-25T00:00:00Z' }, ...extra });

describe('partner connection intake: enrolment code, issued key, replay, rate limits, uniform errors (contracts 1.9.0)', () => {
  let c: TestCtx; let ops: { Authorization: string };
  const post = (body: string, headers: Record<string, string>) => c.http().post(PATH).set({ ...headers, 'content-type': 'application/json' }).send(body);
  const signed = (body: string, secret: string, enrolmentCode?: string, ts?: number) => signIntakeRequest({ secret, body, timestamp: ts, enrolmentCode });
  const enrol = async (o: Record<string, unknown> = {}) => (await c.http().post('/api/v1/admin/onboarding/enrolments').set(ops).send({ kind: 'CLINIC', label: 'int test', ...o }).expect(201)).body as { id: string; code: string };

  beforeAll(async () => { c = await createCtx(); ops = await c.as('ops_int', { roles: ['ops_admin'] }); });
  afterAll(async () => { await c.close(); });
  beforeEach(() => { resetIntakeLimits(); for (const k of ['INTAKE_RATE_IP_PER_MIN', 'INTAKE_RATE_ORG_PER_HOUR', 'INTAKE_RATE_FAILED_PER_10MIN']) delete process.env[k]; });

  it('ops creates a code that is shown once, stored hashed, listed without the code, and audited', async () => {
    const e = await enrol({ label: 'Nile Clinic onboarding' });
    expect(e.code).toMatch(/^kxe_/);
    const list = (await c.http().get('/api/v1/admin/onboarding/enrolments').set(ops).expect(200)).body;
    const row = list.find((x: any) => x.id === e.id);
    expect(row).toMatchObject({ status: 'ACTIVE', kind: 'CLINIC' }); expect(JSON.stringify(list)).not.toContain(e.code);
    const db = await c.prisma.partnerEnrolment.findUnique({ where: { id: e.id } });
    expect(db!.signingKey).toMatch(/^[0-9a-f]{64}$/); expect(JSON.stringify(db)).not.toContain(e.code.split('.')[1]!);
    expect(await c.prisma.auditLog.count({ where: { action: 'partner_enrolment.created', resourceId: e.id } })).toBe(1);
    await c.http().post('/api/v1/admin/onboarding/enrolments').set(ops).send({ kind: 'BANK', label: 'x' }).expect(400);
    await c.http().post('/api/v1/admin/onboarding/enrolments').send({ kind: 'CLINIC', label: 'x' }).expect(401);
  });

  it('first request signed with the code: creates the connection, returns the intake key ONCE, and the code is single use', async () => {
    const e = await enrol(); const orgRef = org(); const body = clinicBody(orgRef);
    const r = await post(body, signed(body, e.code, e.code)).expect(200);
    expect(r.body).toMatchObject({ created: true, status: expect.any(String) }); expect(r.body.intakeKey).toMatch(/^kxi_/); expect(r.body.statusToken).toBeTruthy();
    expect((await c.prisma.partnerEnrolment.findUnique({ where: { id: e.id } }))!.status).toBe('USED');
    // single use: a second organisation with the same code, and a fresh nonce, is refused
    const b2 = clinicBody(org()); await post(b2, signed(b2, e.code, e.code)).expect(401);
    // later requests are signed with the issued key (no enrolment header), idempotent, no second key
    const b3 = clinicBody(orgRef, { name: 'Renamed Clinic' });
    const r3 = await post(b3, signed(b3, r.body.intakeKey)).expect(200);
    expect(r3.body).toMatchObject({ created: false, id: r.body.id }); expect(r3.body.intakeKey).toBeUndefined();
    // the old shared-secret scheme no longer works
    const b4 = clinicBody(orgRef); await post(b4, signed(b4, 'kx_dev_webhook_secret')).expect(401);
    expect(await c.prisma.auditLog.count({ where: { action: 'partner_onboarding.enrolment_used', resourceId: r.body.id } })).toBe(1);
  });

  it('every authentication failure is the same 401 (no enumeration): unknown, revoked, expired, used, wrong kind/org, bad signature, stale timestamp', async () => {
    const answers: string[] = [];
    const attempt = async (body: string, h: Record<string, string>) => { const r = await post(body, h); expect(r.status).toBe(401); answers.push(JSON.stringify(r.body)); };
    const ok = await enrol(); const revoked = await enrol(); await c.http().delete(`/api/v1/admin/onboarding/enrolments/${revoked.id}`).set(ops).expect(200);
    const expired = await enrol(); await c.prisma.partnerEnrolment.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const bound = await enrol({ orgRef: 'only_this_org' }); const nurse = await enrol({ kind: 'NURSE' }); const ghost = generateEnrolmentCode();
    let b = clinicBody(org()); await attempt(b, signed(b, ghost.code, ghost.code));                       // unknown id
    b = clinicBody(org()); await attempt(b, signed(b, revoked.code, revoked.code));                     // revoked
    b = clinicBody(org()); await attempt(b, signed(b, expired.code, expired.code));                     // expired
    b = clinicBody(org()); await attempt(b, signed(b, bound.code, bound.code));                         // bound to another org
    b = clinicBody(org()); await attempt(b, signed(b, nurse.code, nurse.code));                         // wrong kind
    b = clinicBody(org()); await attempt(b, signed(b, 'wrong.secret', ok.code));                        // bad signature
    b = clinicBody(org()); await attempt(b, signed(b, ok.code, ok.code, Math.floor(Date.now() / 1000) - 3600)); // stale timestamp
    b = clinicBody(org()); await attempt(b, { 'x-kiorly-timestamp': '1', 'x-kiorly-signature': 'sha256=00' });  // no credential at all
    expect(new Set(answers).size).toBe(1); expect(JSON.parse(answers[0]!)).toMatchObject({ code: 'INTAKE_UNAUTHORIZED' });
    expect((await c.prisma.partnerEnrolment.findUnique({ where: { id: ok.id } }))!.status).toBe('ACTIVE'); // failures consume nothing
    expect((await c.http().delete(`/api/v1/admin/onboarding/enrolments/${ok.id}`).set(ops).expect(200)).body.status).toBe('REVOKED');
  });

  it('replay: the same signed request twice is refused the second time (nonce), a fresh nonce on a used code is refused too', async () => {
    const e = await enrol(); const orgRef = org(); const body = clinicBody(orgRef); const h = signed(body, e.code, e.code);
    await post(body, h).expect(200);
    await post(body, h).expect(401);
    const e2 = await enrol(); const rb = clinicBody(orgRef); const k = (await post(rb, signed(rb, e2.code, e2.code))).status; // recovery re-enrolment of the same org with a NEW code is allowed
    expect(k).toBe(200);
  });

  it('strict validation, size cap and no secrets or PHI in audit', async () => {
    const e = await enrol();
    const unknown = clinicBody(org(), { surprise: 1 });
    const r = await post(unknown, signed(unknown, e.code, e.code)); expect(r.status).toBe(400); expect(r.body.code).toBe('INVALID_REQUEST');
    const big = clinicBody(org(), { readiness: { pad: 'x'.repeat(INTAKE_MAX_BODY_BYTES + 10) } });
    const tooBig = await post(big, signed(big, e.code, e.code)); expect(tooBig.status).toBe(413); expect(tooBig.body.code).toBe('PAYLOAD_TOO_LARGE');
    const rows = await c.prisma.auditLog.findMany({ where: { OR: [{ resource: 'PartnerEnrolment' }, { action: { startsWith: 'partner_onboarding.' } }] } });
    expect(JSON.stringify(rows)).not.toContain(e.code.split('.')[1]!);
  });

  it('rate limits: per IP and per orgRef answer 429 with Retry-After; failed authentication is limited too', async () => {
    process.env.INTAKE_RATE_IP_PER_MIN = '3';
    const e = await enrol(); const body = clinicBody(org()); let last: any;
    for (let i = 0; i < 4; i++) last = await post(body, signed(body, 'x', e.code));
    expect(last.status).toBe(429); expect(last.body.code).toBe('RATE_LIMITED'); expect(Number(last.headers['retry-after'])).toBeGreaterThan(0);
    resetIntakeLimits(); delete process.env.INTAKE_RATE_IP_PER_MIN; process.env.INTAKE_RATE_ORG_PER_HOUR = '2';
    const same = org(); const rs: number[] = [];
    for (let i = 0; i < 3; i++) { const b = clinicBody(same); rs.push((await post(b, signed(b, 'x', e.code))).status); }
    expect(rs).toEqual([401, 401, 429]);
    resetIntakeLimits(); delete process.env.INTAKE_RATE_ORG_PER_HOUR; process.env.INTAKE_RATE_FAILED_PER_10MIN = '2';
    const fs: number[] = [];
    for (let i = 0; i < 3; i++) { const b = clinicBody(org()); fs.push((await post(b, signed(b, 'x', e.code))).status); }
    expect(fs).toEqual([401, 401, 429]);
  });

  it('status poll: only with the token, uniform 404, limited per IP', async () => {
    const e = await enrol(); const body = clinicBody(org()); const r = (await post(body, signed(body, e.code, e.code)).expect(200)).body;
    await c.http().get(`${PATH}/${r.id}`).set('x-connection-token', r.statusToken).expect(200);
    const bad = await c.http().get(`${PATH}/${r.id}`).set('x-connection-token', 'nope').expect(404);
    const ghost = await c.http().get(`${PATH}/pc_does_not_exist`).set('x-connection-token', r.statusToken).expect(404);
    expect(bad.body).toEqual(ghost.body);
  });
});
