import { createCtx, futureSlot, seedProvider, TestCtx } from './harness';

/**
 * Flag-OFF contract for the flags that gained real behaviour in this wave (ADR-023): OFF => 403 FEATURE_DISABLED {key, scope}
 * for NEW actions only; existing data stays readable; flipping back needs no migration. Launch-locked flags use a TEST-FIXTURE
 * gate (application code never records gates).
 */
describe('flag-OFF contract — WhatsApp booking, vault/record shares, waitlist, verticals, market gate', () => {
  let c: TestCtx; let auth: { Authorization: string }; let admin: { Authorization: string }; let pid: string;
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset();
    c.kiorly.slots = [futureSlot(72)]; pid = await seedProvider(c);
    auth = await c.as('sub_amira'); admin = await c.as('adm1', { roles: ['super_admin', 'ops_admin'] });
    await c.http().put('/api/v1/me/profile').set(auth).send({ nameEn: 'Amira Samy' }).expect(200);
  });
  const off = (key: string, scope = 'GLOBAL') => c.http().put(`/api/v1/admin/flags/${key}/values`).set(admin).send({ scope, ...(scope === 'MARKET' ? { scopeId: 'EG' } : {}), value: 'OFF', reason: 't', ticket: 'T-9', emergency: true }).expect(200);
  const on = (key: string) => c.http().put(`/api/v1/admin/flags/${key}/values`).set(admin).send({ scope: 'GLOBAL', value: 'ON', reason: 'restore', ticket: 'T-9' }).expect(200);
  const gate = (key: string) => c.http().put(`/api/v1/admin/flags/${key}/gate`).set(admin).send({ gateId: 'TEST-FIXTURE-GATE', approver: 'test fixture', approvedOn: '2027-01-01', documentUrl: 'https://example.test/fixture' }).expect(200);
  const disabled = (r: any, key: string, scope = 'GLOBAL') => { expect(r.status).toBe(403); expect(r.body).toMatchObject({ code: 'FEATURE_DISABLED', key, scope }); };
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(40, 1)]).toString('base64');

  const cases: { key: string; launchLocked?: boolean; act: () => any; scope?: string }[] = [
    { key: 'kiorex.whatsapp_booking', act: () => c.http().post('/api/v1/channels/whatsapp/booking-intents').send({ from: '+201000000001', text: 'hi' }) },
    { key: 'kiorex.record_vault', act: () => c.http().post('/api/v1/me/vault/uploads').set(auth).send({ fileName: 'a.png', mimeType: 'image/png', contentBase64: png }) },
    { key: 'kiorex.marketplace', act: () => c.http().post('/api/v1/waitlist').set(auth).send({ providerId: pid, typeId: 'typ_1' }) },
    { key: 'kiorex.pharmacy_orders', launchLocked: true, act: () => c.http().get('/api/v1/pharmacy/pharmacies').set(auth) },
    { key: 'kiorex.lab_bookings', launchLocked: true, act: () => c.http().get('/api/v1/lab/tests').set(auth) },
    { key: 'kiorex.telemedicine', launchLocked: true, act: () => c.http().get('/api/v1/telemedicine/providers').set(auth) },
    { key: 'kiorex.sponsored_listings', act: () => c.http().get('/api/v1/search/sponsored') },
  ];

  it.each(cases.map((x) => [x.key, x] as const))('%s OFF => 403 {key, scope}; reversible', async (_k, x) => {
    if (x.launchLocked) { await gate(x.key); }
    expect((await x.act()).status).not.toBe(403);
    await off(x.key);
    disabled(await x.act(), x.key);
    await on(x.key);
    expect((await x.act()).status).not.toBe(403);
  });

  it('launch-locked verticals are AWAITING_GATE (scope GATE) without evidence — the gate is only ever recorded by a human', async () => {
    for (const [key, path] of [['kiorex.pharmacy_orders', '/api/v1/pharmacy/pharmacies'], ['kiorex.lab_bookings', '/api/v1/lab/tests'], ['kiorex.telemedicine', '/api/v1/telemedicine/providers']] as const) {
      disabled(await c.http().get(path).set(auth), key, 'GATE');
    }
    expect(await c.prisma.flagGateEvidence.count({ where: { flagKey: { in: ['kiorex.pharmacy_orders', 'kiorex.lab_bookings', 'kiorex.telemedicine'] } } })).toBe(0);
  });

  it('kiorex.record_vault OFF: vault list stays readable (readOnly), uploads and grants blocked; clinic.record_share_patient_app OFF: grants blocked', async () => {
    await off('kiorex.record_vault');
    expect((await c.http().get('/api/v1/me/vault').set(auth).expect(200)).body).toMatchObject({ items: [], readOnly: true });
    disabled(await c.http().put('/api/v1/me/record-sharing/VISIT_SUMMARY').set(auth).send({ granted: true }), 'kiorex.record_vault');
    await c.http().put('/api/v1/me/record-sharing/VISIT_SUMMARY').set(auth).send({ granted: false }).expect(200);
    await on('kiorex.record_vault');
    await off('clinic.record_share_patient_app');
    disabled(await c.http().put('/api/v1/me/record-sharing/VISIT_SUMMARY').set(auth).send({ granted: true }), 'clinic.record_share_patient_app');
    expect((await c.http().get('/api/v1/me/record-sharing').set(auth).expect(200)).body.canGrant).toBe(false);
  });

  it('market.eg.live OFF (gate evidence revoked): sign-up country list and search hide Egypt; booking is 403 at scope GATE', async () => {
    await c.flags.revokeGate('t', 'market.eg.live', 'test');
    expect((await c.http().get('/api/v1/markets')).body).toEqual([]);
    expect((await c.http().get('/api/v1/search/providers')).body.items).toEqual([]);
    disabled(await c.http().post('/api/v1/bookings').set(auth).send({ providerId: pid, typeId: 'typ_1', ...futureSlot(72) }), 'market.eg.live', 'GATE');
  });
});
