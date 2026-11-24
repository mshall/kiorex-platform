import { PARTNER_DEV_DEFAULTS } from '@kiorex/contracts';
import { createCtx, futureSlot, TestCtx } from './harness';
import { FakePartner } from './fake-partner';
import { OutboxService } from '../src/outbox/outbox-public';
import { PartnerRegistry, PartnerRouting } from '../src/partners/partners-public';

const NOW = () => new Date().toISOString();
/** Calls a partner received that act on a booking (a location lookup `GET /tests` or `GET /pharmacies` is how a router finds the owner and is not traffic for the booking). */
const traffic = (f: FakePartner) => f.calls.filter((x) => !(x.method === 'GET' && (x.path === '/tests' || x.path.startsWith('/tests?') || x.path === '/pharmacies')));
const SIGNOFF = { pharmacistSignoff: { userId: 'u1', signedAt: NOW() } };

/** Per-registration routing: two LIVE pharmacies and two LIVE labs (each its own tenant, key and secrets) each receive ONLY their own traffic. */
describe('partner routing: several live partners of one kind', () => {
  let c: TestCtx; let phA: FakePartner; let phB: FakePartner; let labA: FakePartner; let labB: FakePartner; let auth: { Authorization: string }; let admin: { Authorization: string };
  let regPhA: string; let regPhB: string; let regLabA: string; let regLabB: string;

  beforeAll(async () => {
    c = await createCtx();
    phA = await new FakePartner('pharmacy').start(); labA = await new FakePartner('lab').start();
    phB = await new FakePartner('pharmacy', { clientKey: 'kp_tenant_b', clientSecret: 'secret_b', webhookSecret: 'wh_b', pharmacies: [{ id: 'ph_b1', name: 'Tenant B Pharmacy' }], setEnv: false }).start();
    labB = await new FakePartner('lab', { clientKey: 'kl_tenant_b', clientSecret: 'lsecret_b', webhookSecret: 'lwh_b', setEnv: false }).start();
    phB.catalogue = phB.catalogue.map((i) => ({ ...i, pharmacyId: 'ph_b1', sku: `B-${i.sku}` }));
    labB.labTests = labB.labTests.map((t) => ({ ...t, labId: 'lab_b1', labName: 'Tenant B Lab' }));
  });
  afterAll(async () => { await c.close(); await Promise.all([phA.stop(), phB.stop(), labA.stop(), labB.stop()]); });
  beforeEach(async () => {
    await c.reset(); for (const f of [phA, phB, labA, labB]) f.reset();
    labA.slots = [futureSlot(30)]; labB.slots = [futureSlot(30)];
    c.get(PartnerRouting).forget();
    auth = await c.as('sub_amira'); admin = await c.as('adm1', { roles: ['super_admin', 'ops_admin'] });
    await c.http().put('/api/v1/me/profile').set(auth).send({ nameEn: 'Amira Samy' }).expect(200);
    await c.http().put('/api/v1/me/consents/MARKETPLACE_PROCESSING').set(auth).send({ granted: true });
    for (const k of ['kiorex.pharmacy_orders', 'kiorex.lab_bookings']) await c.http().put(`/api/v1/admin/flags/${k}/gate`).set(admin).send({ gateId: 'TEST-FIXTURE-GATE', approver: 'test fixture', approvedOn: '2027-01-01', documentUrl: 'https://dev.invalid/x' });
    const reg = c.get(PartnerRegistry); const d = PARTNER_DEV_DEFAULTS;
    regPhA = (await reg.upsert('pharmacy', undefined, { name: 'Pharmacy A', baseUrl: phA.url, clientKey: d.pharmacy.clientKey, clientSecret: d.pharmacy.clientSecret, webhookSecret: d.pharmacy.webhookSecret })).id;
    regPhB = (await reg.upsert('pharmacy', undefined, { name: 'Pharmacy B', baseUrl: phB.url, clientKey: 'kp_tenant_b', clientSecret: 'secret_b', webhookSecret: 'wh_b' })).id;
    regLabA = (await reg.upsert('lab', undefined, { name: 'Lab A', baseUrl: labA.url, clientKey: d.lab.clientKey, clientSecret: d.lab.clientSecret, webhookSecret: d.lab.webhookSecret })).id;
    regLabB = (await reg.upsert('lab', undefined, { name: 'Lab B', baseUrl: labB.url, clientKey: 'kl_tenant_b', clientSecret: 'lsecret_b', webhookSecret: 'lwh_b' })).id;
    process.env.QUIET_HOURS_START = '0'; process.env.QUIET_HOURS_END = '0';
  });
  const flush = () => c.get(OutboxService).processBatch();
  const pay = async (o: any) => { await c.http().post(`/api/v1/pay/fake-checkout/${o.payment.paymentId}/complete`).send({ outcome: 'pay' }).expect(200); await flush(); };
  const send = (f: FakePartner, type: string, data: any) => { const e = f.event(type, data); return c.http().post(e.path).set(e.headers).send(e.body); };
  const phOrder = async (pharmacyId: string, sku: string) => {
    await c.http().put('/api/v1/pharmacy/cart').set(auth).send({ pharmacyId, items: [{ sku, qty: 1 }] }).expect(200);
    await c.http().put('/api/v1/pharmacy/cart/delivery').set(auth).send({ method: 'PICKUP' }).expect(200);
    return (await c.http().post('/api/v1/pharmacy/orders').set(auth).send({}).expect(201)).body;
  };
  const labBook = async (labId: string, slot: { startsAt: string; endsAt: string }, partnerId?: string) =>
    c.http().post('/api/v1/lab/bookings').set(auth).send({ labId, ...(partnerId ? { partnerId } : {}), testCodes: ['CBC'], collectionType: 'HOME', slot, address: { line1: '1 Nile St' } });

  it('pharmacy: listing and search fan out and tag the owner; a targeted search, cart, quote and order reach ONLY the owning pharmacy', async () => {
    const list = (await c.http().get('/api/v1/pharmacy/pharmacies').set(auth).expect(200)).body;
    expect(list.map((p: any) => [p.id, p.partnerId]).sort()).toEqual([['ph_1', regPhA], ['ph_2', regPhA], ['ph_b1', regPhB]].sort());
    const all = (await c.http().get('/api/v1/pharmacy/search?q=').set(auth).expect(200)).body.items;
    expect(new Set(all.map((i: any) => i.partnerId))).toEqual(new Set([regPhA, regPhB]));
    expect(all.filter((i: any) => i.partnerId === regPhB).every((i: any) => i.pharmacyId === 'ph_b1')).toBe(true);
    phA.reset(); phB.reset();
    const onlyB = (await c.http().get('/api/v1/pharmacy/search?q=&pharmacyId=ph_b1').set(auth).expect(200)).body.items;
    expect(onlyB.every((i: any) => i.partnerId === regPhB)).toBe(true);
    expect(phA.calls.filter((x) => x.path.startsWith('/catalogue'))).toHaveLength(0); // pharmacy A never saw B's search
    const ob = await phOrder('ph_b1', 'B-PARA500');
    expect(ob.partnerId).toBe(regPhB);
    expect(phA.calls.filter((x) => x.path.startsWith('/catalogue/quote'))).toHaveLength(0);
    expect(phB.callsTo('POST', '/catalogue/quote').length).toBeGreaterThan(0);
    await pay(ob);
    expect(phB.callsTo('POST', '/orders')).toHaveLength(1); expect(phA.callsTo('POST', '/orders')).toHaveLength(0);
    const oa = await phOrder('ph_1', 'PARA500');
    expect(oa.partnerId).toBe(regPhA);
    await pay(oa);
    expect(phA.callsTo('POST', '/orders')).toHaveLength(1); expect(phB.callsTo('POST', '/orders')).toHaveLength(1);
    expect(phA.callsTo('POST', '/orders')[0].body.orderId).toBe(oa.id); expect(phB.callsTo('POST', '/orders')[0].body.orderId).toBe(ob.id);
    // every call carried its own partner's key and nothing else
    expect(phA.calls.every((x) => x.headers['x-kiorly-client-key'] === PARTNER_DEV_DEFAULTS.pharmacy.clientKey)).toBe(true);
    expect(phB.calls.every((x) => x.headers['x-kiorly-client-key'] === 'kp_tenant_b')).toBe(true);
    expect(phA.bad + phB.bad).toBe(0);
    // cancel goes to the owner as well
    await c.http().post(`/api/v1/pharmacy/orders/${ob.id}/cancel`).set(auth).expect(200);
    expect(phB.callsTo('POST', '/cancel').length).toBe(1); expect(phA.callsTo('POST', '/cancel')).toHaveLength(0);
  });

  it('pharmacy webhooks: an event signed by pharmacy A can never move pharmacy B\'s order; the owner can', async () => {
    const ob = await phOrder('ph_b1', 'B-PARA500'); await pay(ob);
    const partnerOrderId = (await c.prisma.pharmacyOrder.findUniqueOrThrow({ where: { id: ob.id } })).partnerOrderId!;
    const foreign = await send(phA, 'OrderReady', { orderId: partnerOrderId, pharmacyId: 'ph_1', readyAt: NOW(), ...SIGNOFF });
    expect(foreign.body.status).toBe('IGNORED');
    expect((await c.http().get(`/api/v1/pharmacy/orders/${ob.id}`).set(auth)).body.status).toBe('SUBMITTED');
    expect(await c.prisma.auditLog.count({ where: { action: 'pharmacy.event_from_other_registration', resourceId: ob.id } })).toBe(1);
    expect((await send(phB, 'OrderReady', { orderId: partnerOrderId, pharmacyId: 'ph_b1', readyAt: NOW(), ...SIGNOFF })).body.status).toBe('APPLIED');
    expect((await c.http().get(`/api/v1/pharmacy/orders/${ob.id}`).set(auth)).body.status).toBe('READY');
  });

  it('pharmacy: an id offered by two partners is ambiguous unless partnerId says which; an unknown id is 404; the partner\'s org flag OFF hides it', async () => {
    (phB as any).opts.pharmacies = [{ id: 'ph_b1', name: 'B' }, { id: 'ph_1', name: 'B also has ph_1' }]; phB.catalogue = phB.catalogue.map((i) => ({ ...i, pharmacyId: 'ph_1' }));
    c.get(PartnerRouting).forget();
    const flagBody = { scope: 'ORG', scopeId: 'org_tenant_b', value: 'OFF', reason: 'test', ticket: 'T-1', emergency: true };
    void flagBody;
    const amb = await c.http().put('/api/v1/pharmacy/cart').set(auth).send({ pharmacyId: 'ph_1', items: [{ sku: 'PARA500', qty: 1 }] }).expect(409);
    expect(amb.body.code).toBe('AMBIGUOUS_LOCATION'); expect(amb.body.partners).toHaveLength(2);
    expect((await c.http().put('/api/v1/pharmacy/cart').set(auth).send({ pharmacyId: 'ph_1', partnerId: regPhA, items: [{ sku: 'PARA500', qty: 1 }] }).expect(200)).body.partnerId).toBe(regPhA);
    await c.http().put('/api/v1/pharmacy/cart').set(auth).send({ pharmacyId: 'nope', items: [{ sku: 'PARA500', qty: 1 }] }).expect(404);
    (phB as any).opts.pharmacies = [{ id: 'ph_b1', name: 'B' }]; c.get(PartnerRouting).forget();
    // org-scope flag: partner B's organisation switches the capability off -> its pharmacies vanish from listings, targeted calls answer FEATURE_DISABLED scope ORG
    await c.prisma.partnerConnection.create({ data: { id: 'pc_b', kind: 'PHARMACY', orgRef: 'org_tenant_b', name: 'B', statusTokenHash: 'x', registrationId: regPhB, status: 'LIVE' } });
    await c.http().put('/api/v1/admin/flags/pharmacy.kiorex_orders/values').set(admin).send({ scope: 'ORG', scopeId: 'org_tenant_b', value: 'OFF', reason: 'test', ticket: 'T-1', emergency: true }).then((r) => { if (r.status !== 200) throw new Error(`flag ${r.status} ${JSON.stringify(r.body)}`); });
    expect((await c.http().get('/api/v1/pharmacy/pharmacies').set(auth).expect(200)).body.map((p: any) => p.id)).toEqual(['ph_1', 'ph_2']);
    const off = await c.http().put('/api/v1/pharmacy/cart').set(auth).send({ pharmacyId: 'ph_1', partnerId: regPhB, items: [{ sku: 'B-PARA500', qty: 1 }] }).expect(403);
    expect(off.body).toMatchObject({ code: 'FEATURE_DISABLED', key: 'pharmacy.kiorex_orders', scope: 'ORG' });
  });

  it('lab: tests, slots, quote, booking and cancel reach ONLY the owning lab; a lab\'s result event cannot touch the other lab\'s booking', async () => {
    const tests = (await c.http().get('/api/v1/lab/tests').set(auth).expect(200)).body.items;
    expect(new Set(tests.map((t: any) => t.partnerId))).toEqual(new Set([regLabA, regLabB]));
    labA.reset(); labB.reset(); labA.slots = [futureSlot(30)]; labB.slots = [futureSlot(30)];
    const slots = (await c.http().get('/api/v1/lab/slots?labId=lab_b1&collectionType=HOME&from=' + new Date().toISOString() + '&to=' + new Date(Date.now() + 5 * 86400_000).toISOString()).set(auth).expect(200)).body;
    expect(slots.partnerId).toBe(regLabB); expect(traffic(labA)).toHaveLength(0);
    const bb = (await labBook('lab_b1', labB.slots[0]).then((r) => { if (r.status !== 201) throw new Error(`book ${r.status} ${JSON.stringify(r.body)}`); return r; })).body;
    expect(bb.partnerId).toBe(regLabB); expect(traffic(labA)).toHaveLength(0);
    await pay(bb);
    expect(labB.callsTo('POST', '/orders')).toHaveLength(1); expect(labA.callsTo('POST', '/orders')).toHaveLength(0);
    const ba = (await labBook('lab_1', labA.slots[0]).then((r) => { if (r.status !== 201) throw new Error(`book ${r.status} ${JSON.stringify(r.body)}`); return r; })).body;
    expect(ba.partnerId).toBe(regLabA); await pay(ba);
    expect(labA.callsTo('POST', '/orders')).toHaveLength(1); expect(labB.callsTo('POST', '/orders')).toHaveLength(1);
    expect(labA.calls.every((x) => x.headers['x-kiorly-client-key'] === PARTNER_DEV_DEFAULTS.lab.clientKey)).toBe(true);
    expect(labB.calls.every((x) => x.headers['x-kiorly-client-key'] === 'kl_tenant_b')).toBe(true);
    expect(labA.bad + labB.bad).toBe(0);
    // lab A reports a result for lab B's booking: ignored; lab B's own report releases it
    const rowB = await c.prisma.labBooking.findUniqueOrThrow({ where: { id: bb.id } });
    const evt = { orderId: rowB.partnerOrderId, labId: 'lab_b1', patientRef: 'sub_amira', reportId: 'rep_1', reportVersion: 1, signedAt: NOW(), secureLink: 'https://lab.example/r/1', channels: ['KIOREX_VAULT'] };
    expect((await send(labA, 'LabResultReleased', evt)).body.status).toBe('IGNORED');
    expect((await c.http().get(`/api/v1/lab/bookings/${bb.id}`).set(auth)).body.status).toBe('SUBMITTED');
    expect((await send(labB, 'LabResultReleased', evt)).body.status).toBe('APPLIED');
    expect((await c.http().get(`/api/v1/lab/bookings/${bb.id}`).set(auth)).body.status).toBe('RESULT_RELEASED');
    // cancel of A's booking goes to A only
    labA.reset(); labB.reset();
    await c.http().post(`/api/v1/lab/bookings/${ba.id}/cancel`).set(auth).expect(200);
    expect(labA.callsTo('POST', '/cancel')).toHaveLength(1); expect(labB.callsTo('POST', '/cancel')).toHaveLength(0);
  });

  it('a registration paused AFTER an order was placed still receives that order\'s cancel/settlement; new traffic goes only to live partners; rows without a registration use the legacy default', async () => {
    const ob = await phOrder('ph_b1', 'B-PARA500'); await pay(ob);
    await c.get(PartnerRegistry).upsert('pharmacy', regPhB, { active: false });
    phA.reset(); phB.reset();
    await c.http().post(`/api/v1/pharmacy/orders/${ob.id}/cancel`).set(auth).expect(200);
    expect(phB.callsTo('POST', '/cancel')).toHaveLength(1); expect(phA.callsTo('POST', '/cancel')).toHaveLength(0);
    expect((await c.http().get('/api/v1/pharmacy/pharmacies').set(auth)).body.map((p: any) => p.id)).toEqual(['ph_1', 'ph_2']);
    // legacy row (registrationId NULL, created before the migration with no registration): routes to the first active registration
    const legacy = await phOrder('ph_1', 'PARA500'); await pay(legacy);
    await c.prisma.pharmacyOrder.update({ where: { id: legacy.id }, data: { registrationId: null } });
    phA.reset();
    await c.http().post(`/api/v1/pharmacy/orders/${legacy.id}/cancel`).set(auth).expect(200);
    expect(phA.callsTo('POST', '/cancel')).toHaveLength(1);
  });
});
