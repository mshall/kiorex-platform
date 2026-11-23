import { createCtx, seedProvider, TestCtx } from './harness';

const JOIN = 'https://clinic.example.test/v/tok_abc123';

/** Kiorex side of Clinic-owned telehealth: the booking carries the Clinic's `telehealth` block; Kiorex stores it, shows it and follows the Clinic's events. */
describe('Clinic-owned telehealth (P2P): booking telehealth block + events', () => {
  let c: TestCtx; let auth: { Authorization: string }; let pid: string; let bk: string; let start: Date;
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset();
    start = new Date(Date.now() + 3 * 3600_000);
    const slot = { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 30 * 60_000).toISOString() }; c.kiorly.slots = [slot];
    pid = await seedProvider(c); auth = await c.as('sub_amira');
    await c.http().put('/api/v1/me/profile').set(auth).send({ nameEn: 'Amira Samy' }).expect(200);
    const h = await c.http().post('/api/v1/bookings').set(auth).send({ providerId: pid, typeId: 'typ_1', ...slot }).expect(201);
    bk = (await c.http().post(`/api/v1/bookings/${h.body.id}/confirm`).set(auth).send({ marketplaceConsent: true }).expect(200)).body.id;
  });
  const confirmed = (extra: Record<string, unknown> = {}) => c.webhook('APPOINTMENT_CONFIRMED', { externalReference: bk, telehealth: { sessionId: 'ths_1', joinUrl: JOIN, ...extra } });
  const get = async () => (await c.http().get(`/api/v1/bookings/${bk}`).set(auth).expect(200)).body;

  it('stores session id + join URL from the confirmation, derives the join window from the booking time', async () => {
    expect((await get()).telehealth).toBeNull();
    expect((await confirmed()).body.status).toBe('APPLIED');
    const t = (await get()).telehealth;
    expect(t).toMatchObject({ sessionId: 'ths_1', state: 'SCHEDULED', joinUrl: JOIN, movedFrom: null });
    expect(new Date(t.opensAt).getTime()).toBe(start.getTime() - 15 * 60_000);
    expect(new Date(t.closesAt).getTime()).toBe(start.getTime() + 2 * 3600_000);
    const v = (await c.http().get('/api/v1/telemedicine/visits').set(auth).expect(200)).body;
    expect(v).toHaveLength(1); expect(v[0]).toMatchObject({ bookingId: bk, telehealth: { sessionId: 'ths_1', joinUrl: JOIN } });
    expect((await c.http().get('/api/v1/telemedicine/visits').set(await c.as('sub_other')).expect(200)).body).toEqual([]);
  });

  it('the join URL (a bearer token) never reaches the webhook receipt store; non-http URLs are dropped', async () => {
    await confirmed();
    const rec = await c.prisma.webhookReceipt.findFirstOrThrow({ where: { type: 'APPOINTMENT_CONFIRMED' } });
    expect(JSON.stringify(rec.payload)).not.toContain('tok_abc123');
    await confirmed({ joinUrl: 'javascript:alert(1)' });
    expect((await get()).telehealth.joinUrl).toBe(JOIN); // unusable value keeps the previous good link
  });

  it('Clinic events: started -> LIVE, ended -> ENDED (join URL withdrawn), stale/out-of-order and unknown events are ignored', async () => {
    await confirmed();
    const ev = (type: string, data: Record<string, unknown> = {}) => c.webhook(type, { externalReference: bk, sessionId: 'ths_1', ...data }, { aggregateType: 'TelehealthSession', aggregateId: 'ths_1' });
    expect((await ev('telehealth.session.started')).body.status).toBe('APPLIED');
    expect((await get()).telehealth).toMatchObject({ state: 'LIVE', joinUrl: JOIN });
    expect((await ev('telehealth.session.ended')).body.status).toBe('APPLIED');
    expect((await get()).telehealth).toMatchObject({ state: 'ENDED', joinUrl: null });
    expect((await ev('telehealth.session.started')).body.status).toBe('IGNORED'); // late delivery
    expect((await get()).telehealth.state).toBe('ENDED');
    expect((await ev('telehealth.session.something_new')).body.status).toBe('IGNORED'); // unknown subtype: acknowledged
    expect((await c.webhook('telehealth.future.event', { x: 1 })).body.status).toBe('IGNORED');
    expect((await c.webhook('telehealth.session.started', { sessionId: 'nope', externalReference: 'kx_bk_nope' })).body.status).toBe('UNKNOWN_BOOKING');
  });

  it('found by session id alone (aggregateId) when the payload carries no booking reference; missed is terminal', async () => {
    await confirmed();
    const r = await c.webhook('telehealth.session.missed', { sessionId: 'ths_1' }, { aggregateType: 'TelehealthSession', aggregateId: 'ths_1' });
    expect(r.body.status).toBe('APPLIED');
    expect((await get()).telehealth).toMatchObject({ state: 'MISSED', joinUrl: null });
  });

  it('moved: RESCHEDULED shifts the window and remembers the old time; a new window from the Clinic wins', async () => {
    await confirmed();
    const ns = new Date(start.getTime() + 24 * 3600_000);
    await c.webhook('RESCHEDULED', { externalReference: bk, startsAt: ns.toISOString(), endsAt: new Date(ns.getTime() + 1800_000).toISOString() });
    let t = (await get()).telehealth;
    expect(t.movedFrom).toBe(start.toISOString()); expect(t.state).toBe('SCHEDULED'); expect(t.joinUrl).toBe(JOIN);
    expect(new Date(t.opensAt).getTime()).toBe(ns.getTime() - 15 * 60_000);
    const opens = new Date(ns.getTime() - 30 * 60_000).toISOString();
    await c.webhook('telehealth.session.rescheduled', { externalReference: bk, sessionId: 'ths_1', opensAt: opens, startsAt: ns.toISOString() }, { aggregateId: 'ths_1' });
    t = (await get()).telehealth; expect(t.opensAt).toBe(opens);
  });

  it('cancelled booking: state CANCELLED and no join URL', async () => {
    await confirmed();
    await c.webhook('CANCELLED_BY_CLINIC', { externalReference: bk, cancelledBy: 'CLINIC' });
    expect((await get()).telehealth).toMatchObject({ state: 'CANCELLED', joinUrl: null });
  });

  it('changed to in-person: telehealth null or serviceLocation IN_CLINIC on an event, or telehealth.session.converted', async () => {
    await confirmed();
    await c.webhook('RESCHEDULED', { externalReference: bk, startsAt: start.toISOString(), telehealth: null });
    expect((await get()).telehealth).toMatchObject({ state: 'IN_PERSON', joinUrl: null });
    // back to video
    await confirmed();
    expect((await get()).telehealth).toMatchObject({ state: 'SCHEDULED', joinUrl: JOIN });
    await c.webhook('telehealth.session.converted', { externalReference: bk, sessionId: 'ths_1', toServiceLocation: 'IN_CLINIC' }, { aggregateId: 'ths_1' });
    expect((await get()).telehealth).toMatchObject({ state: 'IN_PERSON', joinUrl: null });
  });
});
