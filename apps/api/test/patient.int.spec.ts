import { createCtx, TestCtx } from './harness';
import { OutboxService } from '../src/outbox/outbox-public';
import { PatientService } from '../src/patient/patient-public';

describe('patient & auth (KXM-AC-01..07, KA05/07)', () => {
  let c: TestCtx;
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => { await c.reset(); });

  it('health live/ready are public', async () => {
    await c.http().get('/api/v1/health/live').expect(200);
    const r = await c.http().get('/api/v1/health/ready').expect(200);
    expect(r.body.db).toBe('up');
  });

  it('rejects missing/invalid/wrong-audience tokens (KXM-AC-01)', async () => {
    await c.http().get('/api/v1/me/profile').expect(401);
    await c.http().get('/api/v1/me/profile').set('Authorization', 'Bearer junk').expect(401);
    const bad = await c.token({ aud: 'someone-else' });
    await c.http().get('/api/v1/me/profile').set('Authorization', `Bearer ${bad}`).expect(401);
    const ok = await c.http().get('/api/v1/auth/me').set(await c.as('sub_amira')).expect(200);
    expect(ok.body.roles).toEqual(['patient']);
  });

  it('KXM-AC-02 profile: national ID encrypted at rest and masked in responses', async () => {
    const h = await c.as('sub_amira');
    const r = await c.http().put('/api/v1/me/profile').set(h).send({ nameEn: 'Amira Samy', nameAr: 'أميرة سامي', dateOfBirth: '1990-04-02', gender: 'FEMALE', nationalId: '29004020101234' }).expect(200);
    expect(r.body.nationalIdLast4).toBe('1234');
    expect(JSON.stringify(r.body)).not.toContain('29004020101234');
    const row = await c.prisma.patientProfile.findUniqueOrThrow({ where: { sub: 'sub_amira' } });
    expect(row.nationalIdEnc).toBeTruthy();
    expect(row.nationalIdEnc).not.toContain('2900402');
    expect(row.nationalIdHash).toHaveLength(64);
    await c.http().put('/api/v1/me/profile').set(h).send({ nationalId: '123' }).expect(400);
  });

  it('KXM-AC-03 dependants: guardian only, minors only, flag-gated', async () => {
    const h = await c.as('sub_amira');
    const dob = new Date(Date.now() - 5 * 365 * 86400_000).toISOString().slice(0, 10);
    const d = await c.http().post('/api/v1/me/dependants').set(h).send({ nameEn: 'Omar', dateOfBirth: dob, relationship: 'CHILD' }).expect(201);
    expect(d.body.expiresAt).toBeTruthy();
    await c.http().post('/api/v1/me/dependants').set(h).send({ nameEn: 'Adult', dateOfBirth: '1980-01-01', relationship: 'PARENT' }).expect(400);
    const other = await c.as('sub_hassan');
    expect((await c.http().get('/api/v1/me/dependants').set(other).expect(200)).body).toHaveLength(0);
    await c.http().delete(`/api/v1/me/dependants/${d.body.id}`).set(other).expect(404);
    expect((await c.http().get('/api/v1/me/dependants').set(h)).body).toHaveLength(1);
  });

  it('KXM-AC-04 consent centre: view, grant, withdraw with history', async () => {
    const h = await c.as('sub_amira');
    let r = await c.http().get('/api/v1/me/consents').set(h).expect(200);
    expect(r.body.every((x: any) => x.granted === false)).toBe(true);
    await c.http().put('/api/v1/me/consents/REMINDERS').set(h).send({ granted: true }).expect(200);
    await c.http().put('/api/v1/me/consents/REMINDERS').set(h).send({ granted: false }).expect(200);
    r = await c.http().get('/api/v1/me/consents').set(h);
    expect(r.body.find((x: any) => x.purpose === 'REMINDERS').granted).toBe(false);
    expect((await c.http().get('/api/v1/me/consents/history').set(h)).body).toHaveLength(2);
    await c.http().put('/api/v1/me/consents/NOPE').set(h).send({ granted: true }).expect(400);
  });

  it('KXM-AC-05 sessions list + remote sign-out revokes the token', async () => {
    const hA = await c.as('sub_amira', { sid: 'sid_phone' });
    const hB = await c.as('sub_amira', { sid: 'sid_laptop' });
    await c.http().get('/api/v1/auth/me').set(hA).expect(200);
    await c.http().get('/api/v1/auth/me').set(hB).expect(200);
    const list = await c.http().get('/api/v1/me/sessions').set(hA).expect(200);
    expect(list.body).toHaveLength(2);
    const laptop = (await c.prisma.authSession.findUniqueOrThrow({ where: { sid: 'sid_laptop' } })).id;
    await c.http().delete(`/api/v1/me/sessions/${laptop}`).set(hA).expect(200);
    const r = await c.http().get('/api/v1/auth/me').set(hB).expect(401);
    expect(r.body.code).toBe('SESSION_REVOKED');
    await c.http().get('/api/v1/auth/me').set(hA).expect(200);
  });

  it('back-channel logout: session.revoked kills the sid; invalid token rejected', async () => {
    const h = await c.as('sub_amira', { sid: 'sid_x' });
    await c.http().get('/api/v1/auth/me').set(h).expect(200);
    const lt = await c.logoutToken({ sub: 'sub_amira', sid: 'sid_x' });
    await c.http().post('/api/v1/auth/backchannel-logout').type('form').send({ logout_token: lt }).expect(200);
    await c.http().get('/api/v1/auth/me').set(h).expect(401);
    await c.http().post('/api/v1/auth/backchannel-logout').send({ logout_token: 'garbage' }).expect(400);
    await c.http().post('/api/v1/auth/backchannel-logout').send({}).expect(400);
  });

  it('KXM-AC-06 export + in-app deletion retains no identifiers; subject.deleted back-channel also deletes', async () => {
    const h = await c.as('sub_amira');
    await c.http().put('/api/v1/me/profile').set(h).send({ nameEn: 'Amira Samy', nationalId: '29004020101234' }).expect(200);
    const exp = await c.http().post('/api/v1/me/export').set(h).expect(200);
    expect(exp.body.profile.nationalId).toBe('29004020101234');
    expect(exp.body.bookings).toEqual([]);
    expect((await c.http().post('/api/v1/me/deletion').set(h).send({ confirm: false }).expect(200)).body.deleted).toBe(false);
    const del = await c.http().post('/api/v1/me/deletion').set(h).send({ confirm: true, includeExport: true }).expect(200);
    expect(del.body.deleted).toBe(true);
    expect(del.body.export.profile.nameEn).toBe('Amira Samy');
    const row = await c.prisma.patientProfile.findUniqueOrThrow({ where: { sub: 'sub_amira' } });
    expect(row.nameEn).toBeNull(); expect(row.nationalIdEnc).toBeNull(); expect(row.deletedAt).toBeTruthy();

    await c.http().put('/api/v1/me/profile').set(await c.as('sub_hassan')).send({ nameEn: 'Hassan Ali' }).expect(200);
    const lt = await c.logoutToken({ sub: 'sub_hassan', event: 'subject.deleted' });
    await c.http().post('/api/v1/auth/backchannel-logout').send({ logout_token: lt }).expect(200);
    await c.get(OutboxService).processBatch();
    expect((await c.prisma.patientProfile.findUniqueOrThrow({ where: { sub: 'sub_hassan' } })).nameEn).toBeNull();
  });

  it('KXM-AC-07 Kiorly record link: first link recorded; a different Kiorly patient is parked, never merged', async () => {
    const svc = c.get(PatientService);
    const a = await svc.linkKiorlyPatient({ sub: 'sub_amira', clinicId: 'cl_1', kiorlyPatientId: 'pat_1', evidence: 'PHONE' });
    expect(a.status).toBe('LINKED');
    const same = await svc.linkKiorlyPatient({ sub: 'sub_amira', clinicId: 'cl_1', kiorlyPatientId: 'pat_1', evidence: 'PHONE' });
    expect(same.id).toBe(a.id);
    const conflict = await svc.linkKiorlyPatient({ sub: 'sub_amira', clinicId: 'cl_1', kiorlyPatientId: 'pat_2', evidence: 'NATIONAL_ID' });
    expect(conflict.status).toBe('CONFLICT_REVIEW');
    const links = await c.http().get('/api/v1/me/kiorly-links').set(await c.as('sub_amira')).expect(200);
    expect(links.body).toHaveLength(2);
  });
});
