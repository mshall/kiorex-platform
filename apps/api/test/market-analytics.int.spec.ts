import { createCtx, futureSlot, seedProvider, TestCtx } from './harness';

describe('market.eg.live gate behaviour + client analytics ingestion', () => {
  let c: TestCtx; let auth: { Authorization: string }; let pid: string; let admin: { Authorization: string };
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset();
    c.kiorly.slots = [futureSlot(72)];
    pid = await seedProvider(c);
    auth = await c.as('sub_amira');
    admin = await c.as('adm1', { roles: ['super_admin', 'ops_admin'] });
  });

  it('with the (DEV) gate evidence EG is live: listed for sign-up, searchable, bookable', async () => {
    const m = await c.http().get('/api/v1/markets').expect(200);
    expect(m.body).toEqual([{ code: 'EG', live: true, flag: 'market.eg.live', state: 'LIVE' }]);
    expect((await c.http().get('/api/v1/search/providers')).body.total).toBe(1);
    await c.http().put('/api/v1/me/profile').set(auth).send({ nameEn: 'Amira Samy', market: 'eg' }).expect(200);
  });

  it('gate evidence missing (AWAITING_GATE): country hidden from sign-up and search; booking/slots/profile 403 FEATURE_DISABLED', async () => {
    await c.flags.revokeGate('test', 'market.eg.live', 'test');
    expect((await c.http().get('/api/v1/markets')).body).toEqual([]);
    expect((await c.http().get('/api/v1/markets?all=true')).body[0]).toMatchObject({ code: 'EG', live: false, state: 'AWAITING_GATE' });
    const s = await c.http().get('/api/v1/search/providers').expect(200);
    expect(s.body).toMatchObject({ items: [], total: 0 });
    await c.http().put('/api/v1/me/profile').set(auth).send({ nameEn: 'Amira Samy', market: 'EG' }).expect(403).expect((r) => expect(r.body).toMatchObject({ code: 'FEATURE_DISABLED', key: 'market.eg.live' }));
    await c.http().get(`/api/v1/providers/${pid}`).expect(403);
    await c.http().get(`/api/v1/providers/${pid}/slots?typeId=typ_1`).expect(403);
    await c.http().put('/api/v1/me/profile').set(auth).send({ nameEn: 'Amira Samy' }).expect(200); // profile w/o market still fine
    const r = await c.http().post('/api/v1/bookings').set(auth).send({ providerId: pid, typeId: 'typ_1', ...futureSlot(72) }).expect(403);
    expect(r.body).toMatchObject({ code: 'FEATURE_DISABLED', key: 'market.eg.live', scope: 'GATE' });
    // existing data untouched: gate recorded again => visible again
    await c.flags.recordGate('test', 'market.eg.live', { gateId: 'DEV-TEST-FIXTURE-NOT-A-REAL-GATE', approver: 'x', approvedOn: new Date(), documentUrl: 'https://dev.invalid/x' });
    expect((await c.http().get('/api/v1/search/providers')).body.total).toBe(1);
  });

  it('switching the market flag OFF (super admin) hides it as well; unknown markets are never live', async () => {
    await c.http().put('/api/v1/admin/flags/market.eg.live/values').set(admin).send({ scope: 'GLOBAL', value: 'OFF', reason: 'test', ticket: 'T-1', emergency: true }).expect(200);
    expect((await c.http().get('/api/v1/markets')).body).toEqual([]);
    await c.http().put('/api/v1/me/profile').set(auth).send({ market: 'SA' }).expect(404);
  });

  describe('POST /analytics/events (KX-03 §07)', () => {
    const post = (events: any[]) => c.http().post('/api/v1/analytics/events').send({ events });
    it('accepts whitelisted events anonymously and stores no identity', async () => {
      const r = await post([{ name: 'search_started', props: { specialtyCode: 'dermatology', market: 'EG' } }, { name: 'booking_failed', props: { code: 'SLOT_TAKEN', providerId: pid } }]).expect(202);
      expect(r.body).toEqual({ accepted: 2 });
      const rows = await c.prisma.analyticsEvent.findMany({ where: { name: { in: ['search_started', 'booking_failed'] } } });
      expect(rows).toHaveLength(2);
      expect(Object.keys(rows[0]).sort()).toEqual(['code', 'createdAt', 'id', 'market', 'name', 'providerId', 'specialtyCode']); // no sub/ip/device columns exist
    });
    it('rejects unknown events, unknown property keys, free text and PHI-looking values; all-or-nothing', async () => {
      const before = await c.prisma.analyticsEvent.count();
      await post([{ name: 'page_view' }]).expect(400).expect((r) => expect(r.body.code).toBe('EVENT_NOT_ALLOWED'));
      await post([{ name: 'search_started', props: { query: 'chest pain' } }]).expect(400).expect((r) => expect(r.body.code).toBe('PROPERTY_NOT_ALLOWED'));
      await post([{ name: 'search_started', props: { code: 'I have a rash on my arm' } }]).expect(400);
      await post([{ name: 'search_started', props: { specialtyCode: 'oncology-of-my-mother' } }]).expect(400);
      await post([{ name: 'slot_viewed', props: { providerId: '01012345678' } }]).expect(400).expect((r) => expect(r.body.code).toBe('PROPERTY_INVALID'));
      await post([{ name: 'search_started' }, { name: 'results_viewed', props: { note: 'x' } }]).expect(400);
      await post([]).expect(400);
      await post(Array.from({ length: 21 }, () => ({ name: 'search_started' }))).expect(400).expect((r) => expect(r.body.code).toBe('BATCH_TOO_LARGE'));
      expect(await c.prisma.analyticsEvent.count()).toBe(before);
    });
  });
});
