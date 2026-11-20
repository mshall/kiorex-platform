import { createCtx, futureSlot, seedProvider, TestCtx } from './harness';

/**
 * Flag-OFF contract for the Rev 2.3 flags (ADR-023/024): OFF => 403 FEATURE_DISABLED {key, scope} for NEW actions only; reversible.
 * Launch-locked flags use DEV-ONLY-NOT-A-REAL-GATE:<GATE> fixture evidence (application code never records gates).
 */
describe('flag-OFF contract: kiorex.home_visits, kiorex.category.*, kiorex.visit_tracking, nurse.care_plans', () => {
  let c: TestCtx; let auth: { Authorization: string }; let admin: { Authorization: string }; let nurse: string; let physio: string; let addressId: string; let booked: string;
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  const gate = async (key: string, ...ids: string[]) => { for (const g of ids) await c.flags.recordGate('TEST_FIXTURE', key, { gateId: `DEV-ONLY-NOT-A-REAL-GATE:${g}`, approver: 'fixture', approvedOn: new Date(), documentUrl: 'https://dev.invalid/f' }); };
  beforeEach(async () => {
    await c.reset();
    c.kiorly.slots = [futureSlot(72)];
    nurse = await seedProvider(c, { id: 'lst_n', clinicianId: 'dr_n', profession: 'NURSE', serviceLocations: ['HOME'], coverageDistricts: ['maadi'], feeServiceLocation: 'HOME', typeId: 'typ_home' });
    physio = await seedProvider(c, { id: 'lst_p', clinicianId: 'dr_p', profession: 'PHYSIOTHERAPIST', serviceLocations: ['IN_CLINIC'] });
    auth = await c.as('sub_amira'); admin = await c.as('adm1', { roles: ['super_admin', 'ops_admin'] });
    await c.http().put('/api/v1/me/profile').set(auth).send({ nameEn: 'Amira Samy' }).expect(200);
    await gate('clinic.home_visits', 'GHV1', 'GHV2'); await gate('kiorex.home_visits', 'GHV1', 'GHV2'); await gate('kiorex.category.physiotherapy', 'GPR1'); await gate('nurse.care_plans', 'GKN1');
    const a = await c.http().post('/api/v1/me/addresses').set(auth).send({ label: 'Home', governorate: 'Cairo', district: 'maadi', street: 'Street 1' }).expect(201);
    await c.http().post(`/api/v1/me/addresses/${a.body.id}/confirm`).set(auth).expect(200); addressId = a.body.id;
    const h = await c.http().post('/api/v1/bookings').set(auth).send({ providerId: nurse, typeId: 'typ_home', ...futureSlot(72), addressId }).expect(201);
    await c.http().post(`/api/v1/bookings/${h.body.id}/confirm`).set(auth).send({ marketplaceConsent: true }).expect(200); booked = h.body.id;
  });
  const set = (key: string, value: 'ON' | 'OFF') => c.http().put(`/api/v1/admin/flags/${key}/values`).set(admin).send({ scope: 'GLOBAL', value, reason: 'contract', ticket: 'T-9', emergency: true }).expect(200);

  const cases: [string, () => any][] = [
    ['kiorex.home_visits', () => c.http().get('/api/v1/search/providers?serviceLocation=HOME&district=maadi')],
    ['kiorex.category.physiotherapy', () => c.http().post('/api/v1/bookings').set(auth).send({ providerId: physio, typeId: 'typ_1', ...futureSlot(73) })],
    ['kiorex.category.nursing', () => c.http().get('/api/v1/search/providers?careType=HOME_NURSING')],
    ['nurse.care_plans', () => c.http().post('/api/v1/care-plans').set(auth).send({ providerId: nurse, addressId })],
  ];
  it.each(cases)('%s OFF => 403 FEATURE_DISABLED {key, scope}; reversible; existing data stays readable', async (key, act) => {
    expect((await act()).status).not.toBe(403);
    await set(key, 'OFF');
    const r = await act();
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ code: 'FEATURE_DISABLED', key: expect.any(String) });
    expect((await c.http().get(`/api/v1/bookings/${booked}`).set(auth).expect(200)).body.home.district).toBe('maadi'); // never hides data
    expect((await c.http().get(`/api/v1/providers/${nurse}`).expect(200)).body.id).toBe(nurse);
    await set(key, 'ON');
    expect((await act()).status).not.toBe(403);
  });

  it('kiorex.visit_tracking OFF: on-the-way events are not shown (timeline without them); ON again: shown. Booked visit stays readable', async () => {
    const ev = { appointmentId: 'apt_1', externalReference: booked, enRouteAt: new Date().toISOString() };
    await set('kiorex.visit_tracking', 'OFF');
    expect((await c.webhook('HOME_VISIT_EN_ROUTE', ev)).body.status).toBe('IGNORED');
    expect((await c.http().get(`/api/v1/bookings/${booked}`).set(auth).expect(200)).body.home).toMatchObject({ subState: null, trackingEnabled: false });
    await set('kiorex.visit_tracking', 'ON');
    expect((await c.webhook('HOME_VISIT_EN_ROUTE', ev)).body.status).toBe('APPLIED');
  });

  it('launch-locked Rev 2.3 flags are AWAITING_GATE (scope GATE) without evidence, and the evidence is only ever a human action', async () => {
    await c.reset();
    const flags = (await c.http().get('/api/v1/flags/effective').expect(200)).body.flags;
    for (const k of ['kiorex.home_visits', 'kiorex.category.physiotherapy']) expect(flags[k]).toMatchObject({ enabled: false, reason: 'AWAITING_GATE' });
    expect(flags['kiorex.category.nursing'].enabled).toBe(false); // depends on kiorex.home_visits
    expect(await c.prisma.flagGateEvidence.count({ where: { gateId: { not: { startsWith: 'DEV-' } } } })).toBe(0);
  });
});
