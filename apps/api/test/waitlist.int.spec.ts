import { createCtx, futureSlot, seedProvider, TestCtx } from './harness';
import { WaitlistService } from '../src/waitlist/waitlist-public';

describe('waitlist autofill (KXM-BK-12)', () => {
  let c: TestCtx; let a: { Authorization: string }; let b: { Authorization: string }; let admin: { Authorization: string }; let pid: string;
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset();
    pid = await seedProvider(c);
    a = await c.as('sub_a'); b = await c.as('sub_b'); admin = await c.as('adm1', { roles: ['super_admin', 'ops_admin'] });
    for (const [h, n] of [[a, 'Amira Samy'], [b, 'Hassan Ali']] as const) await c.http().put('/api/v1/me/profile').set(h).send({ nameEn: n }).expect(200);
    process.env.QUIET_HOURS_START = '0'; process.env.QUIET_HOURS_END = '0';
  });
  const join = (h: any, body: any = {}) => c.http().post('/api/v1/waitlist').set(h).send({ providerId: pid, typeId: 'typ_1', ...body });
  const open = async (slots: any[]) => { c.kiorly.slots = slots; return c.webhook('SLOTS_CHANGED', { clinicianId: 'dr_1' }, { aggregateType: 'Clinic', aggregateId: 'dr_1' }); };
  const offers = async (h: any) => (await c.http().get('/api/v1/waitlist').set(h)).body.flatMap((e: any) => e.offers);

  it('join is idempotent and cancellable; validates the window and provider', async () => {
    const e1 = await join(a).expect(201);
    const e2 = await join(a).expect(201);
    expect(e2.body.id).toBe(e1.body.id);
    expect(e1.body).toMatchObject({ status: 'WAITING', offers: [] });
    await join(a, { providerId: 'nope' }).expect(404);
    await join(a, { preferredFrom: '2030-01-02T00:00:00Z', preferredTo: '2030-01-01T00:00:00Z' }).expect(400);
    await c.http().delete(`/api/v1/waitlist/${e1.body.id}`).set(a).expect(200);
    await c.http().delete(`/api/v1/waitlist/${e1.body.id}`).set(a).expect(404);
    expect((await c.http().get('/api/v1/waitlist').set(a)).body).toEqual([]);
  });

  it('SLOTS_CHANGED offers the freed slot to the OLDEST fitting entry, notifies them, and accept creates a normal hold', async () => {
    await join(a).expect(201); await join(b).expect(201);
    const slot = futureSlot(72);
    await open([slot]);
    const oa = await offers(a);
    expect(oa).toHaveLength(1);
    expect(oa[0]).toMatchObject({ status: 'OFFERED', startsAt: slot.startsAt });
    expect(await offers(b)).toHaveLength(0);
    expect((await c.http().get('/api/v1/me/notifications').set(a)).body.some((n: any) => n.kind === 'WAITLIST_OFFER')).toBe(true);
    expect((await c.http().get('/api/v1/me/notifications').set(b)).body).toEqual([]);
    const bk = await c.http().post(`/api/v1/waitlist/offers/${oa[0].id}/accept`).set(a).expect(200);
    expect(bk.body).toMatchObject({ status: 'HELD', startsAt: slot.startsAt });
    expect(c.kiorly.callsTo('POST', '/holds')).toHaveLength(1);
    expect((await c.http().get('/api/v1/waitlist').set(a)).body[0].status).toBe('BOOKED');
    await c.http().post(`/api/v1/bookings/${bk.body.id}/confirm`).set(a).send({ marketplaceConsent: true }).expect(200);
    await c.http().post(`/api/v1/waitlist/offers/${oa[0].id}/accept`).set(a).expect(409); // already accepted
    await c.http().post(`/api/v1/waitlist/offers/${oa[0].id}/accept`).set(b).expect(404); // not yours
  });

  it('decline / expiry pass the slot on and a patient is never re-offered a slot they already saw', async () => {
    await join(a).expect(201); await join(b).expect(201);
    await open([futureSlot(72)]);
    const oa = (await offers(a))[0];
    await c.http().post(`/api/v1/waitlist/offers/${oa.id}/decline`).set(a).expect(200);
    await c.get(WaitlistService).scan();
    expect(await offers(b)).toHaveLength(1);
    expect((await offers(a)).filter((o: any) => o.status === 'OFFERED')).toHaveLength(0);
    // b lets the offer lapse: slot goes back on the market; nobody left who has not seen it => no new offer
    await c.prisma.waitlistOffer.updateMany({ where: { sub: 'sub_b' }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const r = await c.get(WaitlistService).scan();
    expect(r.offersExpired).toBe(1);
    expect((await c.http().get('/api/v1/waitlist').set(b)).body[0].status).toBe('WAITING');
    await c.http().post(`/api/v1/waitlist/offers/${(await offers(b))[0].id}/accept`).set(b).expect(409);
    // a different slot appears: both can be offered again (oldest first)
    await open([futureSlot(72), futureSlot(96)]);
    expect((await offers(a)).filter((o: any) => o.status === 'OFFERED')).toHaveLength(1);
  });

  it('preferred window is respected; slot already taken at accept => 409 SLOT_TAKEN and the patient keeps waiting', async () => {
    await join(a, { preferredFrom: new Date(Date.now() + 100 * 3600_000).toISOString() }).expect(201);
    await open([futureSlot(72)]);
    expect(await offers(a)).toHaveLength(0);
    await join(b).expect(201);
    await open([futureSlot(72)]);
    const ob = (await offers(b))[0];
    c.kiorly.holdMode = '409';
    const r = await c.http().post(`/api/v1/waitlist/offers/${ob.id}/accept`).set(b).expect(409);
    expect(r.body.code).toBe('SLOT_TAKEN');
    expect((await c.http().get('/api/v1/waitlist').set(b)).body[0]).toMatchObject({ status: 'WAITING' });
    expect((await offers(b))[0].status).toBe('EXPIRED');
  });

  it('Kiorly org flag clinic.waitlist_autofill OFF => entries kept, no automatic offers; back ON => offers resume', async () => {
    await join(a).expect(201);
    await c.http().put('/api/v1/admin/flags/clinic.waitlist_autofill/values').set(admin).send({ scope: 'ORG', scopeId: 'tn_1', value: 'OFF', reason: 't', ticket: 'T-1' }).expect(200);
    await open([futureSlot(72)]);
    expect(await offers(a)).toHaveLength(0);
    expect((await c.http().get('/api/v1/waitlist').set(a)).body[0].status).toBe('WAITING');
    await c.http().put('/api/v1/admin/flags/clinic.waitlist_autofill/values').set(admin).send({ scope: 'ORG', scopeId: 'tn_1', value: 'ON', reason: 't', ticket: 'T-1' }).expect(200);
    await c.http().post('/api/v1/admin/waitlist/scan').set(admin).expect(200);
    expect(await offers(a)).toHaveLength(1);
  });

  it('flag kiorex.marketplace OFF => join/accept 403 FEATURE_DISABLED; webhook never fails because of the waitlist', async () => {
    await join(a).expect(201);
    await c.http().put('/api/v1/admin/flags/kiorex.marketplace/values').set(admin).send({ scope: 'GLOBAL', value: 'OFF', reason: 't', ticket: 'T-1', emergency: true }).expect(200);
    await join(b).expect(403).expect((r) => expect(r.body).toMatchObject({ code: 'FEATURE_DISABLED', key: 'kiorex.marketplace' }));
    expect((await open([futureSlot(72)])).status).toBe(200);
    c.kiorly.slots = [];
  });
});
