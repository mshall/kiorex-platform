import { TelemedicineService } from '../src/telemedicine/telemedicine-public';
import { createCtx, productHeaders, seedProvider, TestCtx } from './harness';

describe('telemedicine orchestration (launch-locked kiorex.telemedicine; MOCK video provider)', () => {
  let c: TestCtx; let auth: { Authorization: string }; let admin: { Authorization: string }; let pid: string; let bk: string; let slot: { startsAt: string; endsAt: string };
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset();
    const st = new Date(Date.now() + 10 * 60_000); slot = { startsAt: st.toISOString(), endsAt: new Date(st.getTime() + 30 * 60_000).toISOString() }; c.kiorly.slots = [slot];
    pid = await seedProvider(c);
    auth = await c.as('sub_amira'); admin = await c.as('adm1', { roles: ['super_admin', 'ops_admin'] });
    await c.http().put('/api/v1/me/profile').set(auth).send({ nameEn: 'Amira Samy' }).expect(200);
    const h = await c.http().post('/api/v1/bookings').set(auth).send({ providerId: pid, typeId: 'typ_1', ...slot }).expect(201);
    await c.http().post(`/api/v1/bookings/${h.body.id}/confirm`).set(auth).send({ marketplaceConsent: true }).expect(200);
    bk = h.body.id;
    await c.http().put('/api/v1/admin/flags/kiorex.telemedicine/gate').set(admin).send({ gateId: 'TEST-FIXTURE-GATE', approver: 'test fixture', approvedOn: '2027-01-01', documentUrl: 'https://example.test/fixture' }).expect(200);
    process.env.QUIET_HOURS_START = '0'; process.env.QUIET_HOURS_END = '0';
  });
  afterEach(() => { delete process.env.TELE_CONSULT_FEE_MINOR; });
  const clinic = (path: string) => productHeaders('kiorly-clinic', path, undefined, 'POST', '');
  const clinicPost = (path: string) => c.http().post(path).set(clinic(path));

  it('AWAITING_GATE blocks matching/creation; matching returns video-capable doctors; emergency text gets guidance', async () => {
    const m = await c.http().get('/api/v1/telemedicine/providers?specialty=dermatology').set(auth).expect(200);
    expect(m.body.items[0]).toMatchObject({ id: pid });
    expect((await c.http().get('/api/v1/telemedicine/providers?q=chest%20pain').set(auth)).body).toMatchObject({ items: [], emergency: { bookingBlocked: true } });
    await c.flags.revokeGate('t', 'kiorex.telemedicine', 'test');
    await c.http().post('/api/v1/telemedicine/sessions').set(auth).send({ bookingId: bk }).expect(403).expect((r) => expect(r.body).toMatchObject({ code: 'FEATURE_DISABLED', scope: 'GATE' }));
  });

  it('capability declared by Kiorly is honoured (false => not matched, not creatable)', async () => {
    await c.prisma.provider.update({ where: { id: pid }, data: { raw: { ...(await c.prisma.provider.findUniqueOrThrow({ where: { id: pid } })).raw as any, provider: { ...((await c.prisma.provider.findUniqueOrThrow({ where: { id: pid } })).raw as any).provider, telemedicine: false } } } });
    expect((await c.http().get('/api/v1/telemedicine/providers').set(auth)).body.items).toEqual([]);
    await c.http().post('/api/v1/telemedicine/sessions').set(auth).send({ bookingId: bk }).expect(409).expect((r) => expect(r.body.code).toBe('NOT_VIDEO_CAPABLE'));
  });

  it('session lifecycle: create (idempotent) -> patient join with MOCK token -> clinician token (Kiorly, product-key HMAC) -> IN_PROGRESS -> end with duration; no clinical data stored', async () => {
    process.env.TELE_CONSULT_FEE_MINOR = '0';
    const s = (await c.http().post('/api/v1/telemedicine/sessions').set(auth).send({ bookingId: bk }).expect(201)).body;
    expect(s).toMatchObject({ bookingId: bk, status: 'SCHEDULED', consultFeeMinor: 0 });
    expect((await c.http().post('/api/v1/telemedicine/sessions').set(auth).send({ bookingId: bk }).expect(201)).body.id).toBe(s.id);
    const j = (await c.http().post(`/api/v1/telemedicine/sessions/${s.id}/join`).set(auth).expect(200)).body;
    expect(j.video).toMatchObject({ provider: 'mock', role: 'patient', room: `kxmock-${s.id}` });
    expect(j.video.token).toMatch(/^mockvid\./);
    expect(j.session.status).toBe('WAITING');
    expect(JSON.stringify(j.video)).not.toContain('sub_amira'); // opaque identity
    const path = `/api/v1/telemedicine/clinician/bookings/${bk}/token`;
    const ct = (await clinicPost(path).expect(200)).body;
    expect(ct.video).toMatchObject({ role: 'clinician', room: `kxmock-${s.id}` });
    expect(ct.session.status).toBe('IN_PROGRESS');
    expect((await c.http().get('/api/v1/me/notifications').set(auth)).body.some((n: any) => n.kind === 'TELE_SESSION_READY')).toBe(true);
    await c.prisma.teleSession.update({ where: { id: s.id }, data: { startedAt: new Date(Date.now() - 600_000) } });
    const end = (await clinicPost(`/api/v1/telemedicine/clinician/bookings/${bk}/end`).expect(200)).body;
    expect(end).toMatchObject({ status: 'ENDED' }); expect(end.durationSec).toBeGreaterThanOrEqual(599);
    await c.http().post(`/api/v1/telemedicine/sessions/${s.id}/join`).set(auth).expect(409).expect((r) => expect(r.body.code).toBe('SESSION_CLOSED'));
    expect(Object.keys(await c.prisma.teleSession.findUniqueOrThrow({ where: { id: s.id } })).join()).not.toMatch(/note|diagnos|soap|record/i);
  });

  it('guards: only confirmed own bookings, join window, owner-only, clinician endpoints need Kiorly Clinic product key', async () => {
    await c.http().post('/api/v1/telemedicine/sessions').set(auth).send({ bookingId: 'kx_bk_nope' }).expect(404);
    await c.http().post('/api/v1/telemedicine/sessions').set(await c.as('sub_other')).send({ bookingId: bk }).expect(404);
    const s = (await c.http().post('/api/v1/telemedicine/sessions').set(auth).send({ bookingId: bk }).expect(201)).body;
    await c.http().post(`/api/v1/telemedicine/sessions/${s.id}/join`).set(await c.as('sub_other')).expect(404);
    await c.prisma.teleSession.update({ where: { id: s.id }, data: { scheduledStartsAt: new Date(Date.now() + 3 * 3600_000) } });
    await c.http().post(`/api/v1/telemedicine/sessions/${s.id}/join`).set(auth).expect(409).expect((r) => expect(r.body.code).toBe('TOO_EARLY'));
    await c.http().post(`/api/v1/telemedicine/clinician/bookings/${bk}/token`).expect(401);
    const other = productHeaders('kiorex', `/api/v1/telemedicine/clinician/bookings/${bk}/token`, undefined, 'POST', '');
    await c.http().post(`/api/v1/telemedicine/clinician/bookings/${bk}/token`).set(other).expect(403);
    await c.http().post(`/api/v1/telemedicine/sessions`).set(auth).send({ bookingId: bk }).expect(201);
    // cancelled booking cannot start a visit
    await c.prisma.teleSession.update({ where: { id: s.id }, data: { scheduledStartsAt: new Date(Date.now() + 60_000) } });
    await c.http().post(`/api/v1/bookings/${bk}/cancel`).set(auth).expect(200);
    await c.http().post(`/api/v1/telemedicine/sessions/${s.id}/join`).set(auth).expect(409);
  });

  it('video has no vendor: VIDEO_MODE real is rejected at startup, clinic-p2p adapter creates no rooms/tokens and the Kiorex-owned path is dormant', async () => {
    const { ClinicP2pVideoAdapter, videoAdapter } = await import('../src/telemedicine/video');
    const { verifyProviderStartup } = await import('../src/common/providers/startup');
    expect(() => verifyProviderStartup({ VIDEO_MODE: 'real' })).toThrow('VIDEO_MODE must be mock or clinic-p2p');
    expect(verifyProviderStartup({ VIDEO_MODE: 'clinic-p2p' })).toContain('video=real');
    await expect(new ClinicP2pVideoAdapter().createRoom()).rejects.toThrow(/CLINIC_OWNS_CALL/);
    expect(videoAdapter().mode).toBe('mock'); // default
    // dormant in clinic-p2p: the service refuses before touching the adapter
    const svc = c.get(TelemedicineService) as any;
    const prev = svc.video; svc.video = new ClinicP2pVideoAdapter();
    try { await c.http().post('/api/v1/telemedicine/sessions').set(auth).send({ bookingId: bk }).expect(409).expect((r) => expect(r.body.code).toBe('CLINIC_OWNS_CALL')); } finally { svc.video = prev; }
  });

  it('flag OFF: no new sessions, existing visit can still be joined/ended', async () => {
    const s = (await c.http().post('/api/v1/telemedicine/sessions').set(auth).send({ bookingId: bk }).expect(201)).body;
    await c.http().put('/api/v1/admin/flags/kiorex.telemedicine/values').set(admin).send({ scope: 'GLOBAL', value: 'OFF', reason: 't', ticket: 'T-1' }).expect(200);
    await c.http().get('/api/v1/telemedicine/providers').set(auth).expect(403);
    await c.http().post(`/api/v1/telemedicine/sessions/${s.id}/join`).set(auth).expect(200);
    await c.http().post(`/api/v1/telemedicine/sessions/${s.id}/end`).set(auth).expect(200);
  });
});
