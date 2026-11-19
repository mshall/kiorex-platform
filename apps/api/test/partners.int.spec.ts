import { signWebhook } from '@kiorex/contracts';
import { createCtx, futureSlot, TestCtx } from './harness';
import { FakePartner } from './fake-partner';
import { OutboxService } from '../src/outbox/outbox-public';
import { PartnerRegistry } from '../src/partners/partners-public';

const NOW = () => new Date().toISOString();

/** kiorex-contracts 1.4.0: partner registrations (base URL / keys / webhook secret per partner record), per-partner webhook secrets and the order/booking lifecycle details found by the real-HTTP integration. */
describe('partner registrations + vertical integration details', () => {
  let c: TestCtx; let ph: FakePartner; let lab: FakePartner; let auth: { Authorization: string }; let admin: { Authorization: string };
  beforeAll(async () => { c = await createCtx(); ph = await new FakePartner('pharmacy').start(); lab = await new FakePartner('lab').start(); });
  afterAll(async () => { await c.close(); await ph.stop(); await lab.stop(); });
  beforeEach(async () => {
    await c.reset(); ph.reset(); lab.reset();
    lab.slots = [futureSlot(30)];
    auth = await c.as('sub_amira'); admin = await c.as('adm1', { roles: ['super_admin', 'ops_admin'] });
    await c.http().put('/api/v1/me/profile').set(auth).send({ nameEn: 'Amira Samy' }).expect(200);
    await c.http().put('/api/v1/me/consents/MARKETPLACE_PROCESSING').set(auth).send({ granted: true });
    for (const k of ['kiorex.pharmacy_orders', 'kiorex.lab_bookings']) await c.http().put(`/api/v1/admin/flags/${k}/gate`).set(admin).send({ gateId: 'TEST-FIXTURE-GATE', approver: 'test fixture', approvedOn: '2027-01-01', documentUrl: 'https://example.test/fixture' }).expect(200);
    process.env.QUIET_HOURS_START = '0'; process.env.QUIET_HOURS_END = '0';
  });
  const flush = () => c.get(OutboxService).processBatch();
  const send = (e: { path: string; headers: Record<string, string>; body: string }) => c.http().post(e.path).set(e.headers).send(e.body);
  const pay = async (o: any) => { await c.http().post(`/api/v1/pay/fake-checkout/${o.payment.paymentId}/complete`).send({ outcome: 'pay' }).expect(200); await flush(); };
  const phOrder = async () => {
    await c.http().put('/api/v1/pharmacy/cart').set(auth).send({ pharmacyId: 'ph_1', items: [{ sku: 'PARA500', qty: 1 }] }).expect(200);
    await c.http().put('/api/v1/pharmacy/cart/delivery').set(auth).send({ method: 'PICKUP' }).expect(200);
    return (await c.http().post('/api/v1/pharmacy/orders').set(auth).send({}).expect(201)).body;
  };
  const labBooking = async () => (await c.http().post('/api/v1/lab/bookings').set(auth).send({ labId: 'lab_1', testCodes: ['CBC'], collectionType: 'HOME', slot: lab.slots[0], address: { line1: '1 Nile St' } }).expect(201)).body;

  it('ops registry: secrets are write-only, a registered partner overrides env, and an inactive one falls back to env', async () => {
    const list = await c.http().get('/api/v1/admin/partners').set(admin).expect(200);
    expect(list.body).toEqual([]); // nothing seeded in the test DB: env defaults apply
    await c.http().get('/api/v1/admin/partners').set(auth).expect(403);
    const made = (await c.http().post('/api/v1/admin/partners/pharmacy').set(admin).send({ name: 'Pharmacy B', baseUrl: `http://127.0.0.1:${ph.port}/`, clientKey: 'kx_dev_pharmacy_client', clientSecret: 'kx_dev_pharmacy_secret_change_me', webhookSecret: 'whsec_b' }).expect(201)).body;
    expect(made).toMatchObject({ kind: 'pharmacy', clientSecret: '********', webhookSecret: '********', apiPath: '/marketplace/v1', baseUrl: `http://127.0.0.1:${ph.port}` });
    expect(JSON.stringify((await c.http().get('/api/v1/admin/partners').set(admin)).body)).not.toContain('whsec_b');
    await c.http().post('/api/v1/admin/partners/pharmacy').set(admin).send({ name: 'x', baseUrl: 'http://h/with/path', clientKey: 'k', clientSecret: 's', webhookSecret: 'w' }).expect(400);
    await c.http().post('/api/v1/admin/partners/pharmacy').set(admin).send({ name: 'x' }).expect(400);
    await c.http().post('/api/v1/admin/partners/fax').set(admin).send({}).expect(400);
    // the registered credentials are used: a wrong secret on the record => the partner answers 401 BAD_HMAC => PHARMACY_SYSTEM_BUSY? no: 422 PHARMACY_REJECTED for catalogue reads
    await c.http().put(`/api/v1/admin/partners/pharmacy/${made.id}`).set(admin).send({ clientSecret: 'wrong' }).expect(200);
    await c.http().get('/api/v1/pharmacy/search?q=').set(auth).expect(422);
    expect(ph.bad).toBeGreaterThan(0);
    await c.http().put(`/api/v1/admin/partners/pharmacy/${made.id}`).set(admin).send({ clientSecret: 'kx_dev_pharmacy_secret_change_me' }).expect(200);
    await c.http().get('/api/v1/pharmacy/search?q=').set(auth).expect(200);
    await c.http().put(`/api/v1/admin/partners/pharmacy/${made.id}`).set(admin).send({ active: false }).expect(200);
    await c.http().get('/api/v1/pharmacy/search?q=').set(auth).expect(200); // env fallback (same dev credentials)
    await c.http().put(`/api/v1/admin/partners/lab/${made.id}`).set(admin).send({ name: 'wrong kind' }).expect(404);
  });

  it('webhooks: the per-partner secret is selected by X-Kiorly-Client-Key; unknown key and wrong secret => 401; a lab event cannot use a pharmacy key', async () => {
    const reg = c.get(PartnerRegistry);
    await reg.upsert('pharmacy', undefined, { name: 'P', baseUrl: `http://127.0.0.1:${ph.port}`, clientKey: 'kp_custom', clientSecret: 'cs', webhookSecret: 'wh_custom_secret' });
    const body = JSON.stringify({ eventId: 'e_custom_1', type: 'OrderRejected', aggregateType: 'PharmacyOrder', aggregateId: 'nope', target: 'KIOREX', occurredAt: NOW(), data: { orderId: 'nope', pharmacyId: 'p', rejectedAt: NOW(), reason: 'x' } });
    const sign = (secret: string, clientKey?: string) => signWebhook({ secret, body, eventType: 'OrderRejected', clientKey }).headers;
    await c.http().post('/api/v1/webhooks/pharmacy').set(sign('wh_custom_secret', 'kp_custom')).send(body).expect(200);
    await c.http().post('/api/v1/webhooks/pharmacy').set(sign('wh_custom_secret', 'kp_unknown')).send(body).expect(401);
    await c.http().post('/api/v1/webhooks/pharmacy').set(sign('wrong', 'kp_custom')).send(body).expect(401);
    await c.http().post('/api/v1/webhooks/lab').set(sign('wh_custom_secret', 'kp_custom')).send(body).expect(401);
    // legacy: no client key => only the env secret (never in production)
    await c.http().post('/api/v1/webhooks/pharmacy').set(sign('kx_dev_pharmacy_webhook_secret')).send(JSON.stringify({ ...JSON.parse(body), eventId: 'e_custom_2' })).expect(401); // body changed after signing
    const b2 = JSON.stringify({ ...JSON.parse(body), eventId: 'e_custom_3' });
    await c.http().post('/api/v1/webhooks/pharmacy').set(signWebhook({ secret: 'kx_dev_pharmacy_webhook_secret', body: b2 }).headers).send(b2).expect(200);
  });

  it('a 401 from the partner (our credentials are wrong) never auto-refunds: the order stays PAID for retry / ops resubmit', async () => {
    const reg = c.get(PartnerRegistry);
    const o = await phOrder(); // quoted + created with the (working) env credentials
    await reg.upsert('pharmacy', undefined, { name: 'P', baseUrl: `http://127.0.0.1:${ph.port}`, clientKey: 'kx_dev_pharmacy_client', clientSecret: 'wrong-secret', webhookSecret: 'w' }); // then ops mis-edits the secret
    await pay(o);
    expect((await c.http().get(`/api/v1/pharmacy/orders/${o.id}`).set(auth)).body).toMatchObject({ status: 'PAID', payment: { status: 'CAPTURED' } });
    expect(await c.prisma.refund.count()).toBe(0);
    await reg.upsert('pharmacy', (await c.prisma.partnerRegistration.findFirstOrThrow()).id, { clientSecret: 'kx_dev_pharmacy_secret_change_me' });
    expect((await c.http().post(`/api/v1/admin/pharmacy/orders/${o.id}/resubmit`).set(admin).expect(200)).body.status).toBe('SUBMITTED');
    expect(ph.callsTo('POST', '/orders')).toHaveLength(1);
  });

  it('pharmacy Rx order: OrderReady proves the pharmacist validated the prescription => rxStatus VALID', async () => {
    await c.prisma.kiorlyPatientLink.create({ data: { sub: 'sub_amira', clinicId: 'cl_1', kiorlyPatientId: 'pat_1', evidence: 'PHONE' } });
    await c.webhook('PRESCRIPTION_SHARED', { patientId: 'pat_1', scope: 'PRESCRIPTIONS', encounterId: 'enc_1', clinicId: 'cl_1', signedAt: NOW() }, { aggregateType: 'Encounter', aggregateId: 'enc_1' });
    const rx = (await c.http().get('/api/v1/me/prescriptions').set(auth)).body[0];
    await c.http().put('/api/v1/pharmacy/cart').set(auth).send({ pharmacyId: 'ph_1', items: [{ sku: 'AMOX500', qty: 1 }], prescriptionRecordId: rx.id }).expect(200);
    await c.http().put('/api/v1/pharmacy/cart/delivery').set(auth).send({ method: 'PICKUP' }).expect(200);
    ph.rxMode = 'PENDING';
    const o = (await c.http().post('/api/v1/pharmacy/orders').set(auth).send({}).expect(201)).body;
    await pay(o);
    expect((await c.http().get(`/api/v1/pharmacy/orders/${o.id}`).set(auth)).body).toMatchObject({ status: 'SUBMITTED', rxStatus: 'PENDING' });
    await send(ph.event('OrderReady', { orderId: o.id, pharmacyId: 'p', readyAt: NOW(), pharmacistSignoff: { userId: 'u1', signedAt: NOW() } }));
    expect((await c.http().get(`/api/v1/pharmacy/orders/${o.id}`).set(auth)).body).toMatchObject({ status: 'READY', rxStatus: 'VALID' });
  });

  it('lab: LabOrderStatusChanged COLLECTED is tracked, the result still releases from COLLECTED, and the cancel call uses the booking id (sourceRef)', async () => {
    const b = await labBooking(); await pay(b);
    const oid = (await c.prisma.labBooking.findUniqueOrThrow({ where: { id: b.id } })).partnerOrderId!;
    const ev = { orderId: oid, orderNumber: 'TL-1', source: 'KIOREX_BOOKING', sourceRef: b.id, previousStatus: 'AWAITING_COLLECTION', nextStatus: 'COLLECTED' };
    expect((await send(lab.event('LabOrderStatusChanged', ev, { aggregateId: oid }))).body.status).toBe('APPLIED');
    expect((await c.http().get(`/api/v1/lab/bookings/${b.id}`).set(auth)).body.status).toBe('COLLECTED');
    await c.http().post(`/api/v1/lab/bookings/${b.id}/cancel`).set(auth).expect(409); // already collected
    const rel = lab.event('LabResultReleased', { reportId: 'rep_9', orderId: oid, labId: 'lab_1', patientRef: 'sub_amira', reportVersion: 1, signedAt: NOW(), secureLink: 'https://lab.example.test/r/z', channels: ['KIOREX_VAULT'] }, { aggregateId: 'rep_9' });
    expect((await send(rel)).body.status).toBe('APPLIED');
    expect((await c.http().get(`/api/v1/lab/bookings/${b.id}`).set(auth)).body.status).toBe('RESULT_RELEASED');
  });

  it('lab: a lab-side cancel before collection refunds in full; cancel by the patient calls the lab with the booking id', async () => {
    const a = await labBooking(); await pay(a);
    const oid = (await c.prisma.labBooking.findUniqueOrThrow({ where: { id: a.id } })).partnerOrderId!;
    await send(lab.event('LabOrderStatusChanged', { orderId: oid, sourceRef: a.id, nextStatus: 'CANCELLED' }, { aggregateId: oid }));
    expect((await c.http().get(`/api/v1/lab/bookings/${a.id}`).set(auth)).body).toMatchObject({ status: 'REJECTED', rejectionReason: 'LAB_CANCELLED', payment: { status: 'REFUNDED' } });
    lab.reset(); lab.slots = [futureSlot(31)];
    const b = (await c.http().post('/api/v1/lab/bookings').set(auth).send({ labId: 'lab_1', testCodes: ['CBC'], collectionType: 'HOME', slot: lab.slots[0], address: { line1: '2 Nile St' } }).expect(201)).body; await pay(b);
    await c.http().post(`/api/v1/lab/bookings/${b.id}/cancel`).set(auth).expect(200);
    expect(lab.callsTo('POST', `/orders/${b.id}/cancel`)).toHaveLength(1);
  });
});
