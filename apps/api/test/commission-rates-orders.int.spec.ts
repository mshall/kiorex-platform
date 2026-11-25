import { createCtx, futureSlot, TestCtx } from './harness';
import { FakePartner } from './fake-partner';
import { OutboxService } from '../src/outbox/outbox-public';
import { CommissionRateService } from '../src/commissions/commissions-public';

const NOW = () => new Date().toISOString();

/** COM-2 on the verticals: the fee Kiorex keeps from a pharmacy order or a lab booking at release follows the rate snapshotted at creation (default per type or the partner's own), never an invented one. Rates are TEST placeholders. */
describe('commission rates on pharmacy orders and lab bookings', () => {
  let c: TestCtx; let ph: FakePartner; let lab: FakePartner; let auth: { Authorization: string }; let sa1: any; let sa2: any; let phReg = ''; let labReg = '';
  const R = '/api/v1/admin/commissions/rates';
  beforeAll(async () => { c = await createCtx(); ph = await new FakePartner('pharmacy').start(); lab = await new FakePartner('lab').start(); });
  afterAll(async () => { await c.close(); await ph.stop(); await lab.stop(); });
  beforeEach(async () => {
    await c.reset(); ph.reset(); lab.reset(); lab.slots = [futureSlot(30)];
    sa1 = await c.as('sa1', { roles: ['super_admin', 'ops_admin'] }); sa2 = await c.as('sa2', { roles: ['super_admin', 'ops_admin'] });
    auth = await c.as('sub_amira');
    await c.http().put('/api/v1/me/profile').set(auth).send({ nameEn: 'Amira Samy' }).expect(200);
    await c.http().put('/api/v1/me/consents/MARKETPLACE_PROCESSING').set(auth).send({ granted: true });
    for (const k of ['kiorex.pharmacy_orders', 'kiorex.lab_bookings']) await c.http().put(`/api/v1/admin/flags/${k}/gate`).set(sa1).send({ gateId: 'TEST-FIXTURE-GATE', approver: 'test fixture', approvedOn: '2027-01-01', documentUrl: 'https://example.test/fixture' }).expect(200);
    process.env.QUIET_HOURS_START = '0'; process.env.QUIET_HOURS_END = '0';
    // each partner is a REGISTRATION (the organisation Kiorex sets the rate for): the dev credentials, so the fake partners answer
    phReg = (await c.http().post('/api/v1/admin/partners/pharmacy').set(sa1).send({ name: 'Pharmacy A', baseUrl: ph.url, clientKey: ph.cfg.clientKey, clientSecret: ph.cfg.clientSecret, webhookSecret: ph.cfg.webhookSecret }).expect(201)).body.id;
    labReg = (await c.http().post('/api/v1/admin/partners/lab').set(sa1).send({ name: 'Lab A', baseUrl: lab.url, clientKey: lab.cfg.clientKey, clientSecret: lab.cfg.clientSecret, webhookSecret: lab.cfg.webhookSecret }).expect(201)).body.id;
  });
  afterEach(() => { delete process.env.PHARMACY_TAKE_RATE_BPS; delete process.env.LAB_TAKE_RATE_BPS; });
  const flush = () => c.get(OutboxService).processBatch();
  const pay = async (o: any) => { await c.http().post(`/api/v1/pay/fake-checkout/${o.payment.paymentId}/complete`).send({ outcome: 'pay' }).expect(200); await flush(); };
  const setDefault = async (product: string, spec: object) => { const p = (await c.http().post(`${R}/defaults`).set(sa1).send({ product, spec }).expect(200)).body; await c.http().post(`${R}/${p.id}/decide`).set(sa2).send({ approve: true }).expect(200); };
  const setOverride = async (orgRef: string, product: string, spec: object) => { const p = (await c.http().post(`${R}/orgs/${orgRef}`).set(sa1).send({ product, kind: 'RATE', spec, reason: 'negotiated' }).expect(200)).body; await c.http().post(`${R}/${p.id}/decide`).set(sa2).send({ approve: true }).expect(200); };
  const balance = async (account: string) => { const r = (await c.prisma.ledgerEntry.aggregate({ where: { account }, _sum: { debitMinor: true, creditMinor: true } }))._sum; return (r.creditMinor ?? 0) - (r.debitMinor ?? 0); };
  const phOrder = async () => {
    await c.http().put('/api/v1/pharmacy/cart').set(auth).send({ pharmacyId: 'ph_1', items: [{ sku: 'PARA500', qty: 2 }] }).expect(200);
    await c.http().put('/api/v1/pharmacy/cart/delivery').set(auth).send({ method: 'PICKUP' }).expect(200);
    return (await c.http().post('/api/v1/pharmacy/orders').set(auth).send({}).expect(201)).body;
  };
  const dispense = async (orderId: string) => {
    const partnerId = (await c.prisma.pharmacyOrder.findUniqueOrThrow({ where: { id: orderId } })).partnerOrderId!;
    const ready = ph.event('OrderReady', { orderId: partnerId, pharmacyId: 'ph_1', readyAt: NOW(), pharmacistSignoff: { userId: 'u1', signedAt: NOW() } }); await c.http().post(ready.path).set(ready.headers).send(ready.body).expect(200);
    const done = ph.event('DispenseCompleted', { orderId: partnerId, pharmacyId: 'ph_1', dispensedAt: NOW(), pharmacistSignoff: { userId: 'u1', signedAt: NOW() } }); await c.http().post(done.path).set(done.headers).send(done.body).expect(200);
  };

  it('no rate set: the fee is 0 (nothing invented), the order links the partner to its type default and keeps no snapshot', async () => {
    const o = await phOrder(); await pay(o); await dispense(o.id);
    expect(await c.prisma.pharmacyOrder.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({ status: 'DISPENSED', platformFeeMinor: 0, rateSnapshot: null });
    expect(await balance('MARKETPLACE_FEES')).toBe(0);
    expect(await c.prisma.commissionOrgRateLink.findUniqueOrThrow({ where: { orgRef: phReg } })).toMatchObject({ product: 'PHARMACY' });
  });

  it('pharmacy: the default per type decides the fee; the partner\'s own rate wins afterwards; the order keeps the rate it was created with', async () => {
    await setDefault('PHARMACY', { feeType: 'PERCENT', percentBps: 1000, minMinor: 300 });
    const first = await phOrder(); // goods 5000 -> 10 % = 500
    await setOverride(phReg, 'PHARMACY', { feeType: 'FLAT', flatMinor: 150 });
    const second = await phOrder(); // created after the override
    await pay(first); await pay(second); await dispense(first.id); await dispense(second.id);
    expect(await c.prisma.pharmacyOrder.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ platformFeeMinor: 500, rateSnapshot: { source: 'DEFAULT', spec: { feeType: 'PERCENT', percentBps: 1000 } } });
    expect(await c.prisma.pharmacyOrder.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({ platformFeeMinor: 150, rateSnapshot: { source: 'OVERRIDE', spec: { feeType: 'FLAT', flatMinor: 150 } } });
    expect(await balance('MARKETPLACE_FEES')).toBe(650);
    expect(await balance('PAYABLE:ph:ph_1')).toBe(5000 - 500 + 5000 - 150);
  });

  it('a later rate change never touches an order that already exists', async () => {
    await setDefault('PHARMACY', { feeType: 'PERCENT', percentBps: 1000 });
    const o = await phOrder(); await pay(o);
    await setOverride(phReg, 'PHARMACY', { feeType: 'FLAT', flatMinor: 999 });
    await dispense(o.id);
    expect((await c.prisma.pharmacyOrder.findUniqueOrThrow({ where: { id: o.id } })).platformFeeMinor).toBe(500);
  });

  it('lab: the type default and the legacy env rate (only when no rate is set) both stay deterministic', async () => {
    process.env.LAB_TAKE_RATE_BPS = '800';
    const legacy = await c.http().post('/api/v1/lab/bookings').set(auth).send({ labId: 'lab_1', testCodes: ['CBC'], collectionType: 'HOME', slot: lab.slots[0], address: { line1: '1 Nile St' } }).expect(201);
    expect(await c.prisma.labBooking.findUniqueOrThrow({ where: { id: legacy.body.id } })).toMatchObject({ takeRateBps: 800, rateSnapshot: null }); // no rate set: the legacy number applies, exactly as before
    await setDefault('LAB', { feeType: 'PERCENT', percentBps: 500, maxMinor: 500 });
    lab.slots = [futureSlot(31)];
    const b = (await c.http().post('/api/v1/lab/bookings').set(auth).send({ labId: 'lab_1', testCodes: ['CBC'], collectionType: 'HOME', slot: lab.slots[0], address: { line1: '1 Nile St' } }).expect(201)).body;
    await pay(b);
    const oid = (await c.prisma.labBooking.findUniqueOrThrow({ where: { id: b.id } })).partnerOrderId!;
    const e = lab.event('LabResultReleased', { reportId: 'rep_x', orderId: oid, labId: 'lab_1', patientRef: 'sub_amira', reportVersion: 1, signedAt: NOW(), secureLink: 'https://lab.example.test/r/abc', channels: ['KIOREX_VAULT'] });
    await c.http().post(e.path).set(e.headers).send(e.body).expect(200);
    // tests 15000 -> 5 % = 750, capped at 500
    expect(await c.prisma.labBooking.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ platformFeeMinor: 500, rateSnapshot: { source: 'DEFAULT', spec: { maxMinor: 500 } } });
  });

  it('the partner view for a pharmacy is pushed to its own API with the registration as the organisation reference', async () => {
    await c.get(CommissionRateService).ensureLink(phReg, 'PHARMACY');
    await setDefault('PHARMACY', { feeType: 'PERCENT', percentBps: 700 });
    await flush();
    const pushed = ph.callsTo('POST', '/commission-rates');
    expect(pushed.length).toBeGreaterThan(0);
    expect(pushed[pushed.length - 1].body).toMatchObject({ orgRef: phReg, product: 'PHARMACY', history: [expect.objectContaining({ scope: 'DEFAULT', kind: 'RATE' })] });
    expect(JSON.stringify(pushed[pushed.length - 1].body)).not.toMatch(/sa1|sa2|proposedBy|decidedBy/);
  });
});
