import { createCtx, futureSlot, productHeaders, seedProvider, TestCtx } from './harness';
import { FLAG_CATALOGUE, KIOREX_OWN_FLAGS } from '../src/control-plane/control-plane-public';

/**
 * Flag-OFF contract (ADR-023, KX-08 §08): for EVERY Kiorex flag, OFF => the capability's NEW-action endpoint answers
 * 403 { code: FEATURE_DISABLED, key, scope }; reads of existing data keep working; reversible with no migration.
 */
describe('flag-OFF contract per Kiorex flag', () => {
  let c: TestCtx;
  let auth: { Authorization: string }; let admin: { Authorization: string }; let admin2: { Authorization: string };
  let pid: string; let doneBooking: string; let confirmedBooking: string;
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset();
    c.kiorly.slots = [futureSlot(72), futureSlot(73)];
    pid = await seedProvider(c, { depositAmount: 100 });
    auth = await c.as('sub_amira');
    admin = await c.as('adm1', { roles: ['super_admin', 'ops_admin'] });
    admin2 = await c.as('adm2', { roles: ['super_admin', 'ops_admin'] });
    await c.http().put('/api/v1/me/profile').set(auth).send({ nameEn: 'Amira Samy' });
    const h = await c.http().post('/api/v1/bookings').set(auth).send({ providerId: pid, typeId: 'typ_1', ...futureSlot(72) });
    await c.http().post(`/api/v1/bookings/${h.body.id}/confirm`).set(auth).send({ marketplaceConsent: true });
    confirmedBooking = h.body.id;
    const h2 = await c.http().post('/api/v1/bookings').set(auth).send({ providerId: pid, typeId: 'typ_1', ...futureSlot(73) });
    await c.http().post(`/api/v1/bookings/${h2.body.id}/confirm`).set(auth).send({ marketplaceConsent: true });
    await c.webhook('COMPLETED', { externalReference: h2.body.id });
    doneBooking = h2.body.id;
  });

  const turnOff = async (key: string, scope: 'GLOBAL' | 'MARKET' = 'GLOBAL') => {
    const body = { scope, ...(scope === 'MARKET' ? { scopeId: 'EG' } : {}), value: 'OFF', reason: 'contract test', ticket: 'T-9', emergency: true };
    await c.http().put(`/api/v1/admin/flags/${key}/values`).set(admin).send(body).expect(200);
  };
  const turnOn = (key: string, scope: 'GLOBAL' | 'MARKET' = 'GLOBAL') =>
    c.http().put(`/api/v1/admin/flags/${key}/values`).set(admin).send({ scope, ...(scope === 'MARKET' ? { scopeId: 'EG' } : {}), value: 'ON', reason: 'restore', ticket: 'T-9' }).expect(200);
  const recordGate = (key: string) => c.http().put(`/api/v1/admin/flags/${key}/gate`).set(admin).send({ gateId: 'TEST-GATE', approver: 'test fixture', approvedOn: '2027-01-01', documentUrl: 'https://example.test/fixture' }).expect(200);

  /** flag -> request that performs a NEW action guarded by it */
  const actions: Record<string, () => any> = {
    'kiorex.marketplace': () => c.http().post('/api/v1/bookings').set(auth).send({ providerId: pid, typeId: 'typ_1', ...futureSlot(74) }),
    'kiorex.pay_deposits': () => c.http().post(`/api/v1/bookings/${confirmedBooking}/deposit-checkout`).set(auth),
    'kiorex.reviews': () => c.http().post(`/api/v1/bookings/${doneBooking}/review`).set(auth).send({ rating: 5 }),
    'kiorex.family_accounts': () => c.http().post('/api/v1/me/dependants').set(auth).send({ nameEn: 'Kid', dateOfBirth: new Date(Date.now() - 3 * 365 * 86400_000).toISOString().slice(0, 10), relationship: 'CHILD' }),
    'kiorex.record_vault': () => c.http().post('/api/v1/me/vault/uploads').set(auth),
    'kiorex.whatsapp_booking': () => c.http().post('/api/v1/channels/whatsapp/booking-intents'),
    'kiorex.sponsored_listings': () => c.http().get('/api/v1/search/sponsored'),
    'kiorex.pharmacy_orders': () => c.http().post('/api/v1/pharmacy/orders').set(auth),
    'kiorex.lab_bookings': () => c.http().post('/api/v1/lab/bookings').set(auth),
    'kiorex.telemedicine': () => c.http().post('/api/v1/telemedicine/sessions').set(auth),
    'kiorex.ai_navigation': () => c.http().post('/api/v1/navigation/symptoms').set(auth).send({ text: 'skin rash' }),
  };

  it('every Kiorex flag of the catalogue has a contract action (none forgotten)', () => {
    expect(Object.keys(actions).sort()).toEqual([...KIOREX_OWN_FLAGS].sort());
    expect(KIOREX_OWN_FLAGS.length).toBe(FLAG_CATALOGUE.filter((f) => f.product === 'kiorex').length);
  });

  const guarded = Object.keys(actions).filter((k) => k !== 'kiorex.ai_navigation'); // AI degrades to rules instead of 403 (see ai test)

  it.each(guarded)('%s OFF (global) → 403 FEATURE_DISABLED {key, scope}; reversible', async (key) => {
    const meta = FLAG_CATALOGUE.find((f) => f.key === key)!;
    if (meta.launchLocked) await recordGate(key); // fixture-only gate so we test the toggle, not the lock
    const before = await actions[key]();
    expect(before.body?.code).not.toBe('FEATURE_DISABLED'); // ON by default (launch-locked fixture gate recorded)
    await turnOff(key);
    const r = await actions[key]();
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ code: 'FEATURE_DISABLED', scope: 'GLOBAL' });
    expect(r.body.key ?? r.body.blockedBy).toBeTruthy();
    expect(r.body.key).toBe(key);
    await turnOn(key);
    const after = await actions[key]();
    expect(after.body?.code).not.toBe('FEATURE_DISABLED');
  });

  it.each(guarded.filter((k) => FLAG_CATALOGUE.find((f) => f.key === k)!.scopes.includes('MARKET')))('%s OFF at market scope reports scope MARKET', async (key) => {
    if (FLAG_CATALOGUE.find((f) => f.key === key)!.launchLocked) await recordGate(key);
    await turnOff(key, 'MARKET');
    const r = await actions[key]();
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ code: 'FEATURE_DISABLED', key, scope: 'MARKET' });
  });

  it('launch-locked Kiorex flags are OFF by default with scope GATE until evidence is recorded (ADR-024)', async () => {
    for (const key of ['kiorex.pharmacy_orders', 'kiorex.lab_bookings', 'kiorex.telemedicine']) {
      const r = await actions[key]();
      expect(r.status).toBe(403);
      expect(r.body).toMatchObject({ code: 'FEATURE_DISABLED', scope: 'GATE' });
    }
    // with the gate recorded the guard opens (feature itself is phase 2 → 501, not 403)
    await recordGate('kiorex.telemedicine');
    expect((await actions['kiorex.telemedicine']()).status).toBe(501);
  });

  it('dependent flags: kiorex.marketplace OFF also stops kiorex.reviews and kiorex.pay_deposits (dependsOn)', async () => {
    await turnOff('kiorex.marketplace');
    const r = await actions['kiorex.reviews']();
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ code: 'FEATURE_DISABLED', scope: 'DEPENDENCY', blockedBy: 'kiorex.marketplace' });
  });

  it('OFF never hides data: bookings, reviews, vault, profile, dependants, provider profiles stay readable', async () => {
    for (const k of guarded) if (!FLAG_CATALOGUE.find((f) => f.key === k)!.launchLocked) await turnOff(k);
    await c.http().get('/api/v1/bookings').set(auth).expect(200);
    await c.http().get(`/api/v1/bookings/${confirmedBooking}`).set(auth).expect(200);
    await c.http().get(`/api/v1/bookings/${confirmedBooking}/calendar.ics`).set(auth).expect(200);
    await c.http().get('/api/v1/me/vault').set(auth).expect(200);
    await c.http().get('/api/v1/me/dependants').set(auth).expect(200);
    await c.http().get(`/api/v1/providers/${pid}/reviews`).expect(200);
    await c.http().get(`/api/v1/providers/${pid}`).expect(200);
    await c.http().post('/api/v1/me/export').set(auth).expect(200);
  });

  it('in-flight work is honoured when kiorex.marketplace is OFF: confirmed bookings can still be cancelled and Kiorly events still apply', async () => {
    await turnOff('kiorex.marketplace');
    await c.http().post(`/api/v1/bookings/${confirmedBooking}/cancel`).set(auth).send({}).expect(200);
    expect((await c.webhook('COMPLETED', { externalReference: doneBooking })).status).toBe(200);
  });

  it('kiorex.pay_deposits OFF: deposit-required visit types are bookable without a deposit (new intents)', async () => {
    await turnOff('kiorex.pay_deposits');
    const h = await c.http().post('/api/v1/bookings').set(auth).send({ providerId: pid, typeId: 'typ_1', ...futureSlot(75) }).expect(201);
    expect(h.body.depositStatus).toBe('NONE');
  });

  it('kiorex.ai_navigation: launch-locked flag OFF → keyword fallback (never an error); safety emergency routing is not a flag', async () => {
    const r = await actions['kiorex.ai_navigation']().expect(200);
    expect(r.body).toMatchObject({ source: 'RULES', ai: false });
    expect(r.body.specialties[0].code).toBe('dermatology');
    await c.http().post('/api/v1/navigation/symptoms').set(auth).send({ text: 'chest pain' }).expect(200).then((x) => expect(x.body.emergency.number).toBe('123'));
  });

  it('product snapshot reflects every Kiorex flag OFF for the Kiorex product', async () => {
    await turnOff('kiorex.reviews');
    const path = '/api/v1/control/v1/flags/snapshot';
    const s = await c.http().get(`${path}?product=kiorex`).set(productHeaders('kiorex', path)).expect(200);
    expect(s.body.flags.find((f: any) => f.key === 'kiorex.reviews').values.global).toBe('OFF');
    void admin2;
  });
});
