import { createCtx, TestCtx } from './harness';
import { FakePartner } from './fake-partner';
import { OutboxService } from '../src/outbox/outbox-public';

const NOW = () => new Date().toISOString();

describe('pharmacy orders (launch-locked kiorex.pharmacy_orders; fake Kiorly Pharmacy contract server)', () => {
  let c: TestCtx; let ph: FakePartner; let auth: { Authorization: string }; let admin: { Authorization: string };
  beforeAll(async () => { c = await createCtx(); ph = await new FakePartner('pharmacy').start(); });
  afterAll(async () => { await c.close(); await ph.stop(); });
  beforeEach(async () => {
    await c.reset(); ph.reset();
    auth = await c.as('sub_amira'); admin = await c.as('adm1', { roles: ['super_admin', 'ops_admin'] });
    await c.http().put('/api/v1/me/profile').set(auth).send({ nameEn: 'Amira Samy' }).expect(200);
    await c.http().put('/api/v1/me/consents/MARKETPLACE_PROCESSING').set(auth).send({ granted: true });
    process.env.QUIET_HOURS_START = '0'; process.env.QUIET_HOURS_END = '0';
  });
  afterEach(() => { delete process.env.PHARMACY_TAKE_RATE_BPS; });
  const flush = () => c.get(OutboxService).processBatch();
  const gate = (key = 'kiorex.pharmacy_orders') => c.http().put(`/api/v1/admin/flags/${key}/gate`).set(admin).send({ gateId: 'TEST-FIXTURE-GATE', approver: 'test fixture', approvedOn: '2027-01-01', documentUrl: 'https://example.test/fixture' }).expect(200);
  const cart = (items: any[], rx?: string) => c.http().put('/api/v1/pharmacy/cart').set(auth).send({ pharmacyId: 'ph_1', items, ...(rx ? { prescriptionRecordId: rx } : {}) });
  const pay = async (o: any) => { await c.http().post(`/api/v1/pay/fake-checkout/${o.payment.paymentId}/complete`).send({ outcome: 'pay' }).expect(200); await flush(); };
  const balance = async (account: string) => { const r = (await c.prisma.ledgerEntry.aggregate({ where: { account }, _sum: { debitMinor: true, creditMinor: true } }))._sum; return (r.creditMinor ?? 0) - (r.debitMinor ?? 0); };
  const event = async (type: string, data: any) => { const e = ph.event(type, data); return c.http().post(e.path).set(e.headers).send(e.body); };
  const shareRx = async () => {
    await c.prisma.kiorlyPatientLink.create({ data: { sub: 'sub_amira', clinicId: 'cl_1', kiorlyPatientId: 'pat_1', evidence: 'PHONE' } });
    await c.webhook('PRESCRIPTION_SHARED', { patientId: 'pat_1', scope: 'PRESCRIPTIONS', encounterId: 'enc_1', clinicId: 'cl_1', signedAt: NOW() }, { aggregateType: 'Encounter', aggregateId: 'enc_1' });
    return (await c.http().get('/api/v1/me/prescriptions').set(auth)).body[0];
  };

  it('launch-locked: AWAITING_GATE => 403 FEATURE_DISABLED until a human records gate evidence (never recorded by code)', async () => {
    const r = await c.http().get('/api/v1/pharmacy/search?q=para').set(auth).expect(403);
    expect(r.body).toMatchObject({ code: 'FEATURE_DISABLED', key: 'kiorex.pharmacy_orders', scope: 'GATE' });
    await c.http().post('/api/v1/pharmacy/orders').set(auth).send({}).expect(403);
    await c.http().get('/api/v1/pharmacy/orders').set(auth).expect(200); // own history stays readable
    expect(await c.prisma.flagGateEvidence.count({ where: { flagKey: 'kiorex.pharmacy_orders' } })).toBe(0);
  });

  describe('with gate evidence (test fixture)', () => {
    beforeEach(async () => { await gate(); });

    it('search + cart: controlled medicines are never returned or orderable; prices come from the pharmacy quote', async () => {
      const s = await c.http().get('/api/v1/pharmacy/search?q=').set(auth).expect(200);
      expect(s.body.items.map((i: any) => i.sku).sort()).toEqual(['AMOX500', 'OUT1', 'PARA500']);
      expect(JSON.stringify(s.body)).not.toContain('CTRL1');
      expect((await c.http().get('/api/v1/pharmacy/pharmacies').set(auth)).body[0]).toMatchObject({ id: 'ph_1', deliveryEnabled: true, deliveryFeeMinor: 3000 });
      await cart([{ sku: 'CTRL1', qty: 1 }]).expect(422).expect((r) => expect(r.body.code).toBe('CONTROLLED_NOT_ORDERABLE'));
      await cart([{ sku: 'PARA500', qty: 0 }]).expect(400);
      const ok = await cart([{ sku: 'PARA500', qty: 2 }]).expect(200);
      expect(ok.body).toMatchObject({ subtotalMinor: 5000, rxRequired: false, deliveryMethod: null });
      const d = await c.http().put('/api/v1/pharmacy/cart/delivery').set(auth).send({ method: 'DELIVERY', address: { line1: '1 Nile St', area: 'Maadi' } }).expect(200);
      expect(d.body).toMatchObject({ deliveryMethod: 'DELIVERY', deliveryFeeMinor: 3000, totalMinor: 8000 });
      await c.http().put('/api/v1/pharmacy/cart/delivery').set(auth).send({ method: 'DELIVERY' }).expect(400);
    });

    it('OTC golden path: intent -> Kiorex Pay -> order sent to Pharmacy (Idempotency-Key = order id) -> OrderReady -> DispenseCompleted releases funds with the take', async () => {
      process.env.PHARMACY_TAKE_RATE_BPS = '400'; // test-only value; real rate is NEEDS_HUMAN
      await cart([{ sku: 'PARA500', qty: 2 }]);
      await c.http().put('/api/v1/pharmacy/cart/delivery').set(auth).send({ method: 'PICKUP' }).expect(200);
      const o = (await c.http().post('/api/v1/pharmacy/orders').set(auth).send({}).expect(201)).body;
      expect(o).toMatchObject({ status: 'PENDING_PAYMENT', totalMinor: 5000, rxStatus: 'NOT_REQUIRED', payment: { status: 'CREATED' } });
      expect(o.payment.checkoutUrl).toContain('/pay/fake-checkout/');
      expect((await c.http().get('/api/v1/pharmacy/cart').set(auth)).body.items).toEqual([]);
      await c.http().post('/api/v1/pharmacy/orders').set(auth).send({}).expect(400); // double submit: empty cart
      await pay(o);
      expect(ph.callsTo('POST', '/orders')[0].headers['idempotency-key']).toBe(o.id);
      expect(ph.callsTo('POST', '/orders')[0].body).toMatchObject({ orderRef: o.id, pharmacyId: 'ph_1', patientRef: 'sub_amira', payment: { totalMinor: 5000 } });
      expect(ph.callsTo('POST', '/orders')[0].body.patientRef).not.toMatch(/\d{14}/); // no national id
      expect(ph.callsTo('POST', '/prescriptions/validate')).toHaveLength(0);
      expect((await c.http().get(`/api/v1/pharmacy/orders/${o.id}`).set(auth)).body.status).toBe('SUBMITTED');
      const partnerId = (await c.prisma.pharmacyOrder.findUniqueOrThrow({ where: { id: o.id } })).partnerOrderId!;
      // pharmacist sign-off is mandatory
      expect((await event('OrderReady', { orderId: partnerId, pharmacyId: 'ph_1', readyAt: NOW() })).body.status).toBe('IGNORED');
      expect((await event('OrderReady', { orderId: partnerId, pharmacyId: 'ph_1', readyAt: NOW(), pharmacistSignoff: { userId: 'u1', signedAt: NOW() } })).body.status).toBe('APPLIED');
      expect((await c.http().get(`/api/v1/pharmacy/orders/${o.id}`).set(auth)).body.status).toBe('READY');
      await c.http().post(`/api/v1/pharmacy/orders/${o.id}/cancel`).set(auth).expect(409); // ready: too late to cancel
      const done = await event('DispenseCompleted', { orderId: partnerId, pharmacyId: 'ph_1', dispensedAt: NOW(), pharmacistSignoff: { userId: 'u1', signedAt: NOW() } });
      expect(done.body.status).toBe('APPLIED');
      expect((await event('DispenseCompleted', { orderId: partnerId, pharmacyId: 'ph_1', dispensedAt: NOW(), pharmacistSignoff: { userId: 'u1', signedAt: NOW() } })).body.status).toBe('IGNORED'); // already final
      const row = await c.prisma.pharmacyOrder.findUniqueOrThrow({ where: { id: o.id } });
      expect(row).toMatchObject({ status: 'DISPENSED', platformFeeMinor: 200, takeRateBps: 400 });
      expect(await balance('PAYABLE:ph:ph_1')).toBe(4800);
      expect(await balance('MARKETPLACE_FEES')).toBe(200);
      expect(await balance('HELD:ph:ph_1')).toBe(0);
      const notes = (await c.http().get('/api/v1/me/notifications').set(auth)).body.map((n: any) => n.kind);
      expect(notes).toEqual(expect.arrayContaining(['PHARMACY_ORDER_READY', 'PHARMACY_ORDER_DISPENSED']));
      // vertical money never reaches Kiorly clinic deposit/payout endpoints
      expect((await c.get(OutboxService).list({ type: 'kiorly.deposit_paid' })).length).toBe(0);
      expect((await c.http().post('/api/v1/admin/payouts/run').set(admin)).body.payouts).toEqual([]);
      // Kiorex's own fee statement: VAT is a config line only (test value), never reported anywhere
      process.env.FEE_STATEMENT_VAT_BPS = '1400';
      try {
        const st = (await c.http().get('/api/v1/admin/fee-statements').set(admin).expect(200)).body;
        expect(st.lines).toEqual([{ partner: 'ph:ph_1', orders: 1, feeMinor: 200, vatBps: 1400, vatMinor: 28, totalMinor: 228 }]);
        expect(st.totals).toEqual({ feeMinor: 200, vatMinor: 28, totalMinor: 228 });
      } finally { delete process.env.FEE_STATEMENT_VAT_BPS; }
    });

    it('take rate is config only: unset => 0 fee (never hard-coded 4%)', async () => {
      await cart([{ sku: 'PARA500', qty: 1 }]); await c.http().put('/api/v1/pharmacy/cart/delivery').set(auth).send({ method: 'PICKUP' });
      const o = (await c.http().post('/api/v1/pharmacy/orders').set(auth).send({}).expect(201)).body; await pay(o);
      const id = (await c.prisma.pharmacyOrder.findUniqueOrThrow({ where: { id: o.id } })).partnerOrderId!;
      await event('DispenseCompleted', { orderId: id, pharmacyId: 'ph_1', dispensedAt: NOW(), pharmacistSignoff: { userId: 'u', signedAt: NOW() } });
      expect(await c.prisma.pharmacyOrder.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({ platformFeeMinor: 0, takeRateBps: 0 });
      expect(await balance('MARKETPLACE_FEES')).toBe(0);
      expect(await balance('PAYABLE:ph:ph_1')).toBe(2500);
    });

    it('Rx order: needs a vault prescription; Rx validation request sent with the verification token; INVALID => rejected + automatic refund', async () => {
      await cart([{ sku: 'AMOX500', qty: 1 }]); await c.http().put('/api/v1/pharmacy/cart/delivery').set(auth).send({ method: 'PICKUP' });
      await c.http().post('/api/v1/pharmacy/orders').set(auth).send({}).expect(422).expect((r) => expect(r.body.code).toBe('RX_REQUIRED'));
      const rx = await shareRx();
      await cart([{ sku: 'AMOX500', qty: 1 }], rx.id); await c.http().put('/api/v1/pharmacy/cart/delivery').set(auth).send({ method: 'PICKUP' });
      ph.rxMode = 'INVALID';
      const o = (await c.http().post('/api/v1/pharmacy/orders').set(auth).send({}).expect(201)).body;
      expect(o.rxStatus).toBe('PENDING');
      await pay(o);
      const sent = ph.callsTo('POST', '/orders')[0].body;
      expect(sent.prescription.recordRef).toBe(rx.id);
      const verify = await c.http().get(`/api/v1/rx/verify?t=${encodeURIComponent(sent.prescription.verificationToken)}`).expect(200);
      expect(verify.body.valid).toBe(true); // the pharmacy can verify the token it was sent
      expect(ph.callsTo('POST', '/prescriptions/validate')).toHaveLength(1);
      const after = (await c.http().get(`/api/v1/pharmacy/orders/${o.id}`).set(auth)).body;
      expect(after).toMatchObject({ status: 'REJECTED', rxStatus: 'INVALID', rejectionReason: 'PRESCRIBER_NOT_VERIFIED', payment: { status: 'REFUNDED' } });
      expect((await c.prisma.refund.findMany({})).map((r) => r.reason)).toEqual(['REJECTED']);
      await flush();
      expect((await c.prisma.refund.findMany({}))[0].status).toBe('SETTLED');
      expect((await c.http().get('/api/v1/me/notifications').set(auth)).body.some((n: any) => n.kind === 'PHARMACY_ORDER_REJECTED')).toBe(true);
      expect(await balance('REFUND_PAYABLE')).toBe(0);
    });

    it('OrderRejected / synchronous rejection => full refund; partial dispense is held for ops review (no auto-release)', async () => {
      const mk = async () => { await cart([{ sku: 'PARA500', qty: 1 }]); await c.http().put('/api/v1/pharmacy/cart/delivery').set(auth).send({ method: 'PICKUP' }); const o = (await c.http().post('/api/v1/pharmacy/orders').set(auth).send({}).expect(201)).body; await pay(o); return o; };
      ph.orderMode = 'reject';
      const a = await mk();
      expect((await c.http().get(`/api/v1/pharmacy/orders/${a.id}`).set(auth)).body).toMatchObject({ status: 'REJECTED', rejectionReason: 'OUT_OF_STOCK', payment: { status: 'REFUNDED' } });
      ph.orderMode = undefined;
      const b = await mk();
      const pid = (await c.prisma.pharmacyOrder.findUniqueOrThrow({ where: { id: b.id } })).partnerOrderId!;
      expect((await event('OrderRejected', { orderId: pid, pharmacyId: 'ph_1', rejectedAt: NOW(), reason: 'Closed', reasonCode: 'CLOSED' })).body.status).toBe('APPLIED');
      expect((await c.http().get(`/api/v1/pharmacy/orders/${b.id}`).set(auth)).body).toMatchObject({ status: 'REJECTED', rejectionReason: 'CLOSED', payment: { status: 'REFUNDED' } });
      const d = await mk();
      const did = (await c.prisma.pharmacyOrder.findUniqueOrThrow({ where: { id: d.id } })).partnerOrderId!;
      await event('DispenseCompleted', { orderId: did, pharmacyId: 'ph_1', dispensedAt: NOW(), partial: true, pharmacistSignoff: { userId: 'u', signedAt: NOW() } });
      expect((await c.http().get(`/api/v1/pharmacy/orders/${d.id}`).set(auth)).body.status).toBe('PARTIAL_REVIEW');
      expect(await balance('PAYABLE:ph:ph_1')).toBe(0);
      expect(await c.prisma.auditLog.count({ where: { action: 'pharmacy.partial_dispense_review' } })).toBe(1);
      expect((await c.http().get('/api/v1/admin/pharmacy/orders?status=PARTIAL_REVIEW').set(admin)).body).toHaveLength(1);
    });

    it('partner outage after payment: order stays PAID, outbox retries with the SAME key (no duplicate); patient cancel refunds', async () => {
      await cart([{ sku: 'PARA500', qty: 1 }]); await c.http().put('/api/v1/pharmacy/cart/delivery').set(auth).send({ method: 'PICKUP' });
      const o = (await c.http().post('/api/v1/pharmacy/orders').set(auth).send({}).expect(201)).body;
      ph.orderMode = '5xx';
      await pay(o);
      expect((await c.http().get(`/api/v1/pharmacy/orders/${o.id}`).set(auth)).body.status).toBe('PAID');
      ph.orderMode = undefined;
      await c.prisma.outboxEvent.updateMany({ where: { type: 'pay.order_captured' }, data: { nextAttemptAt: new Date() } });
      await flush();
      expect((await c.http().get(`/api/v1/pharmacy/orders/${o.id}`).set(auth)).body.status).toBe('SUBMITTED');
      expect(ph.orders.size).toBe(1);
      ph.cancelMode = '409';
      await c.http().post(`/api/v1/pharmacy/orders/${o.id}/cancel`).set(auth).expect(409);
      ph.cancelMode = undefined;
      expect((await c.http().post(`/api/v1/pharmacy/orders/${o.id}/cancel`).set(auth).expect(200)).body).toMatchObject({ status: 'CANCELLED', payment: { status: 'REFUNDED' } });
      await c.http().get(`/api/v1/pharmacy/orders/${o.id}`).set(await c.as('sub_other')).expect(404);
    });

    it('unavailable items block the order; a Pharmacy outage during search is 503 retryable', async () => {
      await cart([{ sku: 'OUT1', qty: 1 }]); await c.http().put('/api/v1/pharmacy/cart/delivery').set(auth).send({ method: 'PICKUP' });
      await c.http().post('/api/v1/pharmacy/orders').set(auth).send({}).expect(409).expect((r) => expect(r.body).toMatchObject({ code: 'ITEM_UNAVAILABLE', skus: ['OUT1'] }));
      await ph.stop();
      try { await c.http().get('/api/v1/pharmacy/search?q=a').set(auth).expect(503).expect((r) => expect(r.body).toMatchObject({ code: 'PHARMACY_SYSTEM_BUSY', retryable: true })); }
      finally { await ph.start(); }
    });

    it('the Pharmacy webhook enforces its own HMAC secret and de-duplicates on eventId', async () => {
      const e = ph.event('OrderRejected', { orderId: 'unknown', pharmacyId: 'ph_1', rejectedAt: NOW(), reason: 'x' }, { eventId: 'pev_fixed' });
      await c.http().post(e.path).set({ ...e.headers, 'x-kiorly-signature': 'sha256=bad' }).send(e.body).expect(401);
      await c.http().post(e.path).set(e.headers).send(e.body).expect(200);
      expect((await c.http().post(e.path).set(e.headers).send(e.body).expect(200)).body.status).toBe('DUPLICATE');
      // a Clinic-secret signature is not accepted on the pharmacy endpoint
      const wrong = await c.webhook('OrderRejected', { orderId: 'x' }, { aggregateType: 'PharmacyOrder' });
      expect(wrong.status).toBe(200); // kiorly endpoint accepts its own secret and just ignores unknown order
      expect(ph.bad).toBe(0);
    });

    it('flag OFF at global scope: new actions 403 FEATURE_DISABLED; existing orders remain readable and cancellable', async () => {
      await cart([{ sku: 'PARA500', qty: 1 }]); await c.http().put('/api/v1/pharmacy/cart/delivery').set(auth).send({ method: 'PICKUP' });
      const o = (await c.http().post('/api/v1/pharmacy/orders').set(auth).send({}).expect(201)).body;
      await c.http().put('/api/v1/admin/flags/kiorex.pharmacy_orders/values').set(admin).send({ scope: 'GLOBAL', value: 'OFF', reason: 't', ticket: 'T-1', emergency: true }).expect(200);
      await c.http().get('/api/v1/pharmacy/search?q=a').set(auth).expect(403);
      await c.http().put('/api/v1/pharmacy/cart').set(auth).send({ pharmacyId: 'ph_1', items: [{ sku: 'PARA500', qty: 1 }] }).expect(403);
      await c.http().get(`/api/v1/pharmacy/orders/${o.id}`).set(auth).expect(200);
      await c.http().post(`/api/v1/pharmacy/orders/${o.id}/cancel`).set(auth).expect(200);
    });
  });
});
