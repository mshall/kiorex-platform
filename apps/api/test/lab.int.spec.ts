import { createCtx, futureSlot, TestCtx } from './harness';
import { FakePartner } from './fake-partner';
import { OutboxService } from '../src/outbox/outbox-public';

const NOW = () => new Date().toISOString();

describe('lab bookings (launch-locked kiorex.lab_bookings; fake Kiorly Lab contract server)', () => {
  let c: TestCtx; let lab: FakePartner; let auth: { Authorization: string }; let admin: { Authorization: string }; let slot: { startsAt: string; endsAt: string };
  beforeAll(async () => { c = await createCtx(); lab = await new FakePartner('lab').start(); });
  afterAll(async () => { await c.close(); await lab.stop(); });
  beforeEach(async () => {
    await c.reset(); lab.reset();
    slot = futureSlot(30); lab.slots = [slot, futureSlot(31)];
    auth = await c.as('sub_amira'); admin = await c.as('adm1', { roles: ['super_admin', 'ops_admin'] });
    await c.http().put('/api/v1/me/profile').set(auth).send({ nameEn: 'Amira Samy' }).expect(200);
    await c.http().put('/api/v1/me/consents/MARKETPLACE_PROCESSING').set(auth).send({ granted: true });
    await c.http().put('/api/v1/admin/flags/kiorex.lab_bookings/gate').set(admin).send({ gateId: 'TEST-FIXTURE-GATE', approver: 'test fixture', approvedOn: '2027-01-01', documentUrl: 'https://example.test/fixture' }).expect(200);
    process.env.QUIET_HOURS_START = '0'; process.env.QUIET_HOURS_END = '0';
  });
  afterEach(() => { delete process.env.LAB_TAKE_RATE_BPS; });
  const flush = () => c.get(OutboxService).processBatch();
  const book = (o: any = {}) => c.http().post('/api/v1/lab/bookings').set(auth).send({ labId: 'lab_1', testCodes: ['CBC'], collectionType: 'HOME', slot, address: { line1: '1 Nile St', area: 'Maadi' }, ...o });
  const pay = async (b: any) => { await c.http().post(`/api/v1/pay/fake-checkout/${b.payment.paymentId}/complete`).send({ outcome: 'pay' }).expect(200); await flush(); };
  const balance = async (account: string) => { const r = (await c.prisma.ledgerEntry.aggregate({ where: { account }, _sum: { debitMinor: true, creditMinor: true } }))._sum; return (r.creditMinor ?? 0) - (r.debitMinor ?? 0); };
  const release = async (orderId: string, extra: any = {}) => { const e = lab.event('LabResultReleased', { reportId: 'rep_1', orderId, labId: 'lab_1', patientRef: 'sub_amira', reportVersion: 1, signedAt: NOW(), secureLink: 'https://lab.example.test/r/abc', channels: ['KIOREX_VAULT'], ...extra }, { aggregateId: 'rep_1' }); return c.http().post(e.path).set(e.headers).send(e.body); };

  it('catalogue search + home-collection slots come from the lab; AWAITING_GATE before evidence', async () => {
    const t = await c.http().get('/api/v1/lab/tests?q=blood').set(auth).expect(200);
    expect(t.body.items.map((i: any) => i.code)).toEqual(['CBC']);
    const s = await c.http().get('/api/v1/lab/slots?labId=lab_1&collectionType=HOME').set(auth).expect(200);
    expect(s.body.slots).toHaveLength(2);
    await c.http().get('/api/v1/lab/slots?collectionType=HOME').set(auth).expect(400);
    await c.http().get('/api/v1/lab/slots?labId=lab_1&collectionType=FAX').set(auth).expect(400);
    await c.http().post('/api/v1/admin/flags/kiorex.lab_bookings/gate/revoke').set(admin).send({ reason: 't' });
    await c.flags.revokeGate('t', 'kiorex.lab_bookings', 'test');
    await c.http().get('/api/v1/lab/tests').set(auth).expect(403).expect((r) => expect(r.body).toMatchObject({ code: 'FEATURE_DISABLED', key: 'kiorex.lab_bookings', scope: 'GATE' }));
  });

  it('1.8.0 Arabic names: tests carry nameAr/preparationAr/sampleTypeAr where the lab holds them (English fallback otherwise); Arabic and English search both work; the booking snapshot keeps nameAr', async () => {
    const ar = await c.http().get(`/api/v1/lab/tests?q=${encodeURIComponent('صورة دم')}`).set(auth).expect(200);
    expect(ar.body.items).toHaveLength(1);
    expect(ar.body.items[0]).toMatchObject({ code: 'CBC', name: 'Complete blood count', nameAr: 'صورة دم كاملة', sampleTypeAr: 'دم', preparationAr: 'لا يلزم أي تحضير', preparation: 'No preparation needed' });
    const en = await c.http().get('/api/v1/lab/tests?q=thyroid').set(auth).expect(200);
    expect(en.body.items[0]).toMatchObject({ code: 'TSH', name: 'Thyroid stimulating hormone' });
    expect('nameAr' in en.body.items[0]).toBe(false); // the lab holds no Arabic name for TSH: absent, never blank
    const b = await book().expect(201);
    expect(b.body.tests[0]).toMatchObject({ code: 'CBC', name: 'Complete blood count', nameAr: 'صورة دم كاملة' });
  });

  it('golden path: book + pay -> order sent to Kiorly Lab -> LabResultReleased lands in the vault (secure link only) and releases funds with the take', async () => {
    process.env.LAB_TAKE_RATE_BPS = '800'; // test-only; real rate NEEDS_HUMAN
    const b = (await book().expect(201)).body;
    expect(b).toMatchObject({ status: 'PENDING_PAYMENT', subtotalMinor: 15000, collectionFeeMinor: 5000, totalMinor: 20000, payment: { status: 'CREATED' } });
    await pay(b);
    expect(lab.callsTo('POST', '/orders')[0].headers['idempotency-key']).toBe(b.id);
    expect(lab.callsTo('POST', '/orders')[0].body).toMatchObject({ sourceRef: b.id, labId: 'lab_1', patient: { fullName: 'Amira Samy', externalId: 'sub_amira' }, testCodes: expect.any(Array), consentChannels: ['KIOREX_VAULT'], collection: { type: 'HOME', windowStart: slot.startsAt, windowEnd: slot.endsAt } });
    expect((await c.http().get(`/api/v1/lab/bookings/${b.id}`).set(auth)).body.status).toBe('SUBMITTED');
    expect((await c.http().get('/api/v1/me/notifications').set(auth)).body.some((n: any) => n.kind === 'LAB_BOOKING_CONFIRMED')).toBe(true);
    const oid = (await c.prisma.labBooking.findUniqueOrThrow({ where: { id: b.id } })).partnerOrderId!;
    expect((await release(oid)).body.status).toBe('APPLIED');
    const done = (await c.http().get(`/api/v1/lab/bookings/${b.id}`).set(auth)).body;
    expect(done.status).toBe('RESULT_RELEASED');
    const rec = (await c.http().get(`/api/v1/me/vault/${done.resultRecordId}`).set(auth)).body;
    expect(rec).toMatchObject({ kind: 'LAB_RESULT', source: 'LAB', report: { secureLink: 'https://lab.example.test/r/abc', reportVersion: 1 } });
    expect(JSON.stringify(rec)).not.toMatch(/"values"|"results"/);
    expect(await c.prisma.labBooking.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ platformFeeMinor: 1200, takeRateBps: 800 });
    expect(await balance('PAYABLE:lab:lab_1')).toBe(18800);
    expect(await balance('MARKETPLACE_FEES')).toBe(1200);
    expect((await c.http().get('/api/v1/me/notifications').set(auth)).body.some((n: any) => n.kind === 'LAB_RESULT_RELEASED')).toBe(true);
    expect((await release(oid, { reportVersion: 2 })).status).toBe(200); // corrected report version: vault updated, no double release
    expect(await balance('PAYABLE:lab:lab_1')).toBe(18800);
  });

  it('result for a patient who revoked LAB_RESULTS sharing, or via non-vault channels, is not stored', async () => {
    const b = (await book().expect(201)).body; await pay(b);
    const oid = (await c.prisma.labBooking.findUniqueOrThrow({ where: { id: b.id } })).partnerOrderId!;
    expect((await release(oid, { channels: ['PRINTED'] })).body.status).toBe('IGNORED');
    expect(await c.prisma.sharedRecord.count()).toBe(0);
    await c.prisma.recordShareConsent.create({ data: { sub: 'sub_amira', scope: 'LAB_RESULTS', granted: false } });
    expect((await release(oid, { reportId: 'rep_2' })).body.status).toBe('IGNORED');
    expect(await c.prisma.sharedRecord.count()).toBe(0);
  });

  it('validation: slot must still be offered, home needs address, unknown tests rejected, prices from the lab', async () => {
    await book({ address: undefined }).expect(400).expect((r) => expect(r.body.code).toBe('ADDRESS_REQUIRED'));
    await book({ slot: futureSlot(50) }).expect(409).expect((r) => expect(r.body.code).toBe('SLOT_TAKEN'));
    await book({ testCodes: ['NOPE'] }).expect(422).expect((r) => expect(r.body.code).toBe('TEST_NOT_AVAILABLE'));
    await book({ testCodes: ['CBC', 'CBC'] }).expect(400);
    const w = await book({ collectionType: 'WALK_IN', address: undefined }).expect(201);
    expect(w.body).toMatchObject({ collectionFeeMinor: 0, totalMinor: 15000 });
  });

  it('lab rejection or outage after payment: refund on rejection; retry with same key on outage; cancel flow', async () => {
    lab.orderMode = 'reject';
    const a = (await book().expect(201)).body; await pay(a);
    expect((await c.http().get(`/api/v1/lab/bookings/${a.id}`).set(auth)).body).toMatchObject({ status: 'REJECTED', rejectionReason: 'SLOT_FULL', payment: { status: 'REFUNDED' } });
    lab.orderMode = '5xx';
    const b = (await book().expect(201)).body; await pay(b);
    expect((await c.http().get(`/api/v1/lab/bookings/${b.id}`).set(auth)).body.status).toBe('PAID');
    lab.orderMode = undefined;
    await c.prisma.outboxEvent.updateMany({ where: { type: 'pay.order_captured', status: 'FAILED' }, data: { nextAttemptAt: new Date() } });
    await flush();
    expect((await c.http().get(`/api/v1/lab/bookings/${b.id}`).set(auth)).body.status).toBe('SUBMITTED');
    lab.cancelMode = '409';
    await c.http().post(`/api/v1/lab/bookings/${b.id}/cancel`).set(auth).expect(409);
    lab.cancelMode = undefined;
    expect((await c.http().post(`/api/v1/lab/bookings/${b.id}/cancel`).set(auth).expect(200)).body).toMatchObject({ status: 'CANCELLED', payment: { status: 'REFUNDED' } });
    await c.http().get(`/api/v1/lab/bookings/${b.id}`).set(await c.as('sub_other')).expect(404);
    expect((await c.http().get('/api/v1/admin/lab/bookings').set(admin)).body.length).toBe(2);
  });

  it('flag OFF: new bookings 403, own bookings stay readable/cancellable', async () => {
    const b = (await book().expect(201)).body;
    await c.http().put('/api/v1/admin/flags/kiorex.lab_bookings/values').set(admin).send({ scope: 'GLOBAL', value: 'OFF', reason: 't', ticket: 'T-1', emergency: true }).expect(200);
    await book().expect(403).expect((r) => expect(r.body.key).toBe('kiorex.lab_bookings'));
    await c.http().get(`/api/v1/lab/bookings/${b.id}`).set(auth).expect(200);
    await c.http().post(`/api/v1/lab/bookings/${b.id}/cancel`).set(auth).expect(200);
  });
});
