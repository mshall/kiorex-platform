import { createCtx, TestCtx } from './harness';
import { FakePartner } from './fake-partner';
import { OutboxService } from '../src/outbox/outbox-public';
import { PayService } from '../src/pay/pay-public';

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
      expect(s.body.items.map((i: any) => i.sku).sort()).toEqual(['AMOX500', 'OUT1', 'PARA500', 'VITC']);
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

    it('DELIVERY order: the patient sees the address they gave (no internal fee field), pickup orders carry none', async () => {
      await cart([{ sku: 'PARA500', qty: 1 }]);
      await c.http().put('/api/v1/pharmacy/cart/delivery').set(auth).send({ method: 'DELIVERY', address: { line1: '1 Nile St', area: 'Maadi', phone: '+201000001001' } }).expect(200);
      const o = (await c.http().post('/api/v1/pharmacy/orders').set(auth).send({}).expect(201)).body;
      expect(o).toMatchObject({ deliveryMethod: 'DELIVERY', deliveryFeeMinor: 3000, deliveryAddress: { line1: '1 Nile St', area: 'Maadi', phone: '+201000001001' } });
      expect(JSON.stringify(o)).not.toContain('_feeMinor');
      expect((await c.http().get(`/api/v1/pharmacy/orders/${o.id}`).set(auth)).body.deliveryAddress).toMatchObject({ line1: '1 Nile St' });
      await cart([{ sku: 'PARA500', qty: 1 }]);
      await c.http().put('/api/v1/pharmacy/cart/delivery').set(auth).send({ method: 'PICKUP' }).expect(200);
      expect((await c.http().post('/api/v1/pharmacy/orders').set(auth).send({}).expect(201)).body.deliveryAddress).toBeNull();
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
      expect(ph.callsTo('POST', '/orders')[0].body).toMatchObject({ orderId: o.id, branchId: 'ph_1', patientRef: 'sub_amira', prepaid: true, lines: [{ sku: 'PARA500', quantity: 2, unitPrice: '25.00' }], delivery: { method: 'PICKUP' }, payment: { totalMinor: 5000, currency: 'EGP' } });
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

    it('OrderRejected / synchronous rejection => full refund; a partial dispense WITHOUT per-line data (pre-1.8.0 pharmacy) is held for ops review (no auto-release)', async () => {
      const mk = async () => { await cart([{ sku: 'PARA500', qty: 1 }]); await c.http().put('/api/v1/pharmacy/cart/delivery').set(auth).send({ method: 'PICKUP' }); const o = (await c.http().post('/api/v1/pharmacy/orders').set(auth).send({}).expect(201)).body; await pay(o); return o; };
      ph.orderMode = 'reject';
      const a = await mk();
      expect((await c.http().get(`/api/v1/pharmacy/orders/${a.id}`).set(auth)).body).toMatchObject({ status: 'REJECTED', rejectionReason: 'BRANCH_NOT_OPTED_IN', payment: { status: 'REFUNDED' } });
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

    describe('1.8.0: OUT_FOR_DELIVERY, Arabic names and partial fulfilment (PROPOSED_DEFAULT policy)', () => {
      const place = async (items: { sku: string; qty: number }[], method: 'PICKUP' | 'DELIVERY' = 'DELIVERY') => {
        await cart(items);
        await c.http().put('/api/v1/pharmacy/cart/delivery').set(auth).send(method === 'DELIVERY' ? { method, address: { line1: '1 Nile St', area: 'Maadi' } } : { method }).expect(200);
        const o = (await c.http().post('/api/v1/pharmacy/orders').set(auth).send({}).expect(201)).body;
        await pay(o);
        const partnerId = (await c.prisma.pharmacyOrder.findUniqueOrThrow({ where: { id: o.id } })).partnerOrderId!;
        return { o, partnerId };
      };
      const so = { userId: 'u1', signedAt: NOW() };
      const get = async (id: string) => (await c.http().get(`/api/v1/pharmacy/orders/${id}`).set(auth)).body;

      it('search and cart carry Arabic names with English fallback; Arabic and English queries both find the medicine; the order snapshot keeps them', async () => {
        const ar = await c.http().get(`/api/v1/pharmacy/search?q=${encodeURIComponent('باراسيتامول')}`).set(auth).expect(200);
        expect(ar.body.items).toHaveLength(1);
        expect(ar.body.items[0]).toMatchObject({ sku: 'PARA500', name: 'Paracetamol 500mg', nameAr: 'باراسيتامول ٥٠٠', formAr: 'أقراص', activeIngredient: 'paracetamol' });
        expect((await c.http().get('/api/v1/pharmacy/search?q=paracetamol').set(auth)).body.items[0].sku).toBe('PARA500');
        const items = (await c.http().get('/api/v1/pharmacy/search?q=').set(auth)).body.items;
        expect('nameAr' in items.find((i: any) => i.sku === 'VITC')).toBe(false); // the pharmacy holds no Arabic name: absent, never blank
        const ok = await cart([{ sku: 'PARA500', qty: 1 }, { sku: 'VITC', qty: 1 }]).expect(200);
        expect(ok.body.items[0]).toMatchObject({ nameAr: 'باراسيتامول ٥٠٠', formAr: 'أقراص' });
        expect(ok.body.items[1].nameAr).toBeUndefined();
        await c.http().put('/api/v1/pharmacy/cart/delivery').set(auth).send({ method: 'PICKUP' }).expect(200);
        const o = (await c.http().post('/api/v1/pharmacy/orders').set(auth).send({}).expect(201)).body;
        expect(o.items[0]).toMatchObject({ sku: 'PARA500', nameAr: 'باراسيتامول ٥٠٠' });
      });

      it('quiet hours (explicit window, no clock dependence): the out-for-delivery message on external channels is held until the window ends, the in-app inbox still gets it at once; outside the window it is sent', async () => {
        const T = 'TODO_NEEDS_HUMAN_pharmacy_order_out_for_delivery';
        const localHour = (new Date().getUTCHours() + 2) % 24; // MARKET_TZ_OFFSET_HOURS default 2; the window starts an hour ago and ends in 2 hours, so it contains now at any minute
        for (const ch of ['WHATSAPP', 'PUSH']) await c.http().put(`/api/v1/me/notification-preferences/${ch}`).set(auth).send({ quietStart: (localHour + 23) % 24, quietEnd: (localHour + 2) % 24 }).expect(200);
        const held = await place([{ sku: 'PARA500', qty: 1 }]);
        await event('OrderReady', { orderId: held.partnerId, pharmacyId: 'ph_1', readyAt: NOW(), pharmacistSignoff: so });
        await event('OrderOutForDelivery', { orderId: held.partnerId, pharmacyId: 'ph_1', outForDeliveryAt: NOW() });
        expect((await c.http().get('/api/v1/me/notifications').set(auth)).body.filter((n: any) => n.kind === 'PHARMACY_ORDER_OUT_FOR_DELIVERY')).toHaveLength(1);
        const deferred = await c.prisma.message.findMany({ where: { templateId: T, channel: { in: ['WHATSAPP', 'PUSH'] } } });
        expect(deferred.length).toBeGreaterThan(0);
        expect(deferred.every((m) => m.status === 'SCHEDULED' && m.reason === 'QUIET_HOURS_DEFERRED' && m.scheduledFor.getTime() > Date.now() + 3_600_000)).toBe(true);
        // a window that does not contain now (0-0 = no quiet hours): sent at once
        for (const ch of ['WHATSAPP', 'PUSH']) await c.http().put(`/api/v1/me/notification-preferences/${ch}`).set(auth).send({ quietStart: 0, quietEnd: 0 }).expect(200);
        const sent = await place([{ sku: 'PARA500', qty: 1 }]);
        await event('OrderReady', { orderId: sent.partnerId, pharmacyId: 'ph_1', readyAt: NOW(), pharmacistSignoff: so });
        await event('OrderOutForDelivery', { orderId: sent.partnerId, pharmacyId: 'ph_1', outForDeliveryAt: NOW() });
        const now = await c.prisma.message.findMany({ where: { templateId: T, channel: { in: ['WHATSAPP', 'PUSH'] }, id: { notIn: deferred.map((m) => m.id) } } });
        expect(now.length).toBeGreaterThan(0);
        expect(now.every((m) => m.status !== 'SCHEDULED' && m.reason !== 'QUIET_HOURS_DEFERRED')).toBe(true);
      });

      it('OUT_FOR_DELIVERY: OrderReady -> OrderOutForDelivery -> DispenseCompleted; patient notified once (AR/EN, mock channel); DispenseCompleted still releases the funds', async () => {
        const { o, partnerId } = await place([{ sku: 'PARA500', qty: 2 }]);
        await event('OrderReady', { orderId: partnerId, pharmacyId: 'ph_1', readyAt: NOW(), pharmacistSignoff: so });
        const out = await event('OrderOutForDelivery', { orderId: partnerId, pharmacyId: 'ph_1', outForDeliveryAt: NOW(), estimatedDeliveryMinutes: 40 });
        expect(out.body.status).toBe('APPLIED');
        expect(await get(o.id)).toMatchObject({ status: 'OUT_FOR_DELIVERY', outForDeliveryAt: expect.any(String) });
        expect((await event('OrderOutForDelivery', { orderId: partnerId, pharmacyId: 'ph_1', outForDeliveryAt: NOW() })).body.status).toBe('APPLIED'); // replayed with another event id: no second move
        await c.http().post(`/api/v1/pharmacy/orders/${o.id}/cancel`).set(auth).expect(409); // on its way: too late to cancel
        const notes = (await c.http().get('/api/v1/me/notifications').set(auth)).body.filter((n: any) => n.kind === 'PHARMACY_ORDER_OUT_FOR_DELIVERY');
        expect(notes).toHaveLength(1);
        const logs = await c.prisma.messageLog.findMany({ where: { templateId: 'TODO_NEEDS_HUMAN_pharmacy_order_out_for_delivery' } }); // mock channels write the rendered text to the dev inbox
        expect(logs.length).toBeGreaterThan(0);
        expect(logs.every((l) => l.status !== 'FAILED')).toBe(true);
        expect(logs.some((l) => /في الطريق|out for delivery/i.test(l.body ?? ''))).toBe(true);
        expect((await c.http().get('/api/v1/me/notifications').set(auth)).body.find((n: any) => n.kind === 'PHARMACY_ORDER_OUT_FOR_DELIVERY')).toBeTruthy();
        expect((await event('DispenseCompleted', { orderId: partnerId, pharmacyId: 'ph_1', dispensedAt: NOW(), pharmacistSignoff: so })).body.status).toBe('APPLIED');
        expect(await get(o.id)).toMatchObject({ status: 'DISPENSED' });
        expect(await balance('PAYABLE:ph:ph_1')).toBe(8000);
        expect(await balance('HELD:ph:ph_1')).toBe(0);
      });

      it('OrderOutForDelivery out of order (before OrderReady) is applied; a late OrderReady does not move the order back; a PICKUP order ignores it (audited)', async () => {
        const a = await place([{ sku: 'PARA500', qty: 1 }]);
        await event('OrderOutForDelivery', { orderId: a.partnerId, pharmacyId: 'ph_1', outForDeliveryAt: NOW() });
        await event('OrderReady', { orderId: a.partnerId, pharmacyId: 'ph_1', readyAt: NOW(), pharmacistSignoff: so });
        expect((await get(a.o.id)).status).toBe('OUT_FOR_DELIVERY');
        const b = await place([{ sku: 'PARA500', qty: 1 }], 'PICKUP');
        expect((await event('OrderOutForDelivery', { orderId: b.partnerId, pharmacyId: 'ph_1', outForDeliveryAt: NOW() })).body.status).toBe('IGNORED');
        expect((await get(b.o.id)).status).toBe('SUBMITTED');
        expect(await c.prisma.auditLog.count({ where: { action: 'pharmacy.out_for_delivery_on_pickup_order' } })).toBe(1);
      });

      it('partial fulfilment (default policy): unavailable lines refunded pro-rata, fulfilled lines released to the pharmacy, itemised refund, ledger + reconciliation consistent, idempotent', async () => {
        process.env.PHARMACY_TAKE_RATE_BPS = '400'; // test-only value
        const { o, partnerId } = await place([{ sku: 'PARA500', qty: 3 }, { sku: 'VITC', qty: 1 }]); // 3 x 25 + 40 + 30 delivery = 145 EGP
        expect(o.totalMinor).toBe(7500 + 4000 + 3000);
        await event('OrderReady', { orderId: partnerId, pharmacyId: 'ph_1', readyAt: NOW(), pharmacistSignoff: so });
        await event('OrderOutForDelivery', { orderId: partnerId, pharmacyId: 'ph_1', outForDeliveryAt: NOW() });
        const done = { orderId: partnerId, pharmacyId: 'ph_1', dispensedAt: NOW(), partial: true, pharmacistSignoff: so, lines: [{ sku: 'PARA500', quantityRequested: 3, quantityDispensed: 1 }, { sku: 'VITC', quantityRequested: 1, quantityDispensed: 1 }] };
        expect((await event('DispenseCompleted', done)).body.status).toBe('APPLIED');
        const after = await get(o.id);
        expect(after.status).toBe('PARTIALLY_FULFILLED');
        expect(after.refund).toMatchObject({ goodsMinor: 5000, deliveryFeeMinor: 0, totalMinor: 5000, fulfilledMinor: 2500 + 4000, currency: 'EGP', policyNote: 'PROPOSED_DEFAULT delegated by founder 23 Nov 2026' });
        expect(after.refund.lines).toEqual(expect.arrayContaining([expect.objectContaining({ sku: 'PARA500', nameAr: 'باراسيتامول ٥٠٠', qtyOrdered: 3, qtyFulfilled: 1, qtyRefunded: 2, refundMinor: 5000 })]));
        expect(after.payment.status).toBe('PARTIALLY_REFUNDED');
        // money path: refund row (idempotency key) -> ledger; remainder released minus the take on the FULFILLED goods only (4% of 65 EGP = 260)
        const refunds = await c.prisma.refund.findMany({ where: { paymentId: o.payment.paymentId } });
        expect(refunds).toMatchObject([{ amountMinor: 5000, reason: 'PARTIAL_FULFILMENT', idempotencyKey: `refund-partial:${o.payment.paymentId}` }]);
        expect(await balance('MARKETPLACE_FEES')).toBe(260);
        expect(await balance('PAYABLE:ph:ph_1')).toBe(14500 - 5000 - 260);
        expect(await balance('HELD:ph:ph_1')).toBe(0);
        await flush();
        expect((await get(o.id)).refund.status).toBe('SETTLED');
        expect(await balance('REFUND_PAYABLE')).toBe(0);
        expect((await c.get(PayService).reconcileDaily()).status).toBe('OK');
        expect(await c.prisma.auditLog.count({ where: { action: 'pharmacy.partial_settled' } })).toBe(1);
        // replay of the same event (new event id) and a late OrderRejected change nothing
        await event('DispenseCompleted', done);
        await event('OrderRejected', { orderId: partnerId, pharmacyId: 'ph_1', rejectedAt: NOW(), reason: 'x' });
        expect(await c.prisma.refund.count({ where: { paymentId: o.payment.paymentId } })).toBe(1);
        expect((await get(o.id)).status).toBe('PARTIALLY_FULFILLED');
        const notes = (await c.http().get('/api/v1/me/notifications').set(auth)).body.filter((n: any) => n.kind === 'PHARMACY_ORDER_PARTIAL_REFUND');
        expect(notes).toHaveLength(1);
        expect(JSON.stringify(notes[0])).toContain('50.00 EGP');
      });

      it('partial delivery order where the delivery is NOT made (deliveryMade=false): the delivery fee is refunded too', async () => {
        const { o, partnerId } = await place([{ sku: 'PARA500', qty: 2 }, { sku: 'VITC', qty: 1 }]);
        await event('DispenseCompleted', { orderId: partnerId, pharmacyId: 'ph_1', dispensedAt: NOW(), partial: true, deliveryMade: false, pharmacistSignoff: so, lines: [{ sku: 'PARA500', quantityRequested: 2, quantityDispensed: 2 }, { sku: 'VITC', quantityRequested: 1, quantityDispensed: 0 }] });
        const after = await get(o.id);
        expect(after.refund).toMatchObject({ goodsMinor: 4000, deliveryFeeMinor: 3000, totalMinor: 7000, fulfilledMinor: 5000 });
        expect(await balance('PAYABLE:ph:ph_1')).toBe(5000);
        expect((await c.get(PayService).reconcileDaily()).status).toBe('OK');
      });

      it('nothing dispensed in a partial event degrades to the ordinary full refund (REJECTED)', async () => {
        const { o, partnerId } = await place([{ sku: 'PARA500', qty: 1 }]);
        await event('DispenseCompleted', { orderId: partnerId, pharmacyId: 'ph_1', dispensedAt: NOW(), partial: true, pharmacistSignoff: so, lines: [{ sku: 'PARA500', quantityRequested: 1, quantityDispensed: 0 }] });
        expect(await get(o.id)).toMatchObject({ status: 'REJECTED', rejectionReason: 'NOTHING_DISPENSED', payment: { status: 'REFUNDED' } });
        expect(await balance('PAYABLE:ph:ph_1')).toBe(0);
      });

      it('policy is configurable per organisation: MANUAL_REVIEW parks the order, ops resolves it with the same pro-rata logic (corrected lines allowed)', async () => {
        await c.http().put('/api/v1/admin/policy/pharmacy.partial_fulfilment').set(admin).send({ scope: 'ORG', scopeId: 'ph_1', value: { mode: 'MANUAL_REVIEW', refundDeliveryFeeIfNotDelivered: true, releaseFulfilledToPharmacy: true }, note: 'test' }).expect(200);
        const { o, partnerId } = await place([{ sku: 'PARA500', qty: 2 }, { sku: 'VITC', qty: 1 }], 'PICKUP');
        await event('DispenseCompleted', { orderId: partnerId, pharmacyId: 'ph_1', dispensedAt: NOW(), partial: true, pharmacistSignoff: so, lines: [{ sku: 'PARA500', quantityRequested: 2, quantityDispensed: 2 }, { sku: 'VITC', quantityRequested: 1, quantityDispensed: 0 }] });
        expect((await get(o.id)).status).toBe('PARTIAL_REVIEW');
        expect(await balance('PAYABLE:ph:ph_1')).toBe(0);
        const r = await c.http().post(`/api/v1/admin/pharmacy/orders/${o.id}/resolve-partial`).set(admin).send({}).expect(200);
        expect(r.body.refundTotalMinor).toBe(4000);
        expect(r.body.order).toMatchObject({ status: 'PARTIALLY_FULFILLED', refund: { totalMinor: 4000, goodsMinor: 4000 } });
        expect(await balance('PAYABLE:ph:ph_1')).toBe(5000);
        await c.http().post(`/api/v1/admin/pharmacy/orders/${o.id}/resolve-partial`).set(admin).send({}).expect(409);
        await c.http().post(`/api/v1/admin/pharmacy/orders/${o.id}/resolve-partial`).set(auth).send({}).expect(403);
        // a PARTIAL_REVIEW without reported lines needs ops to supply them
        const p2 = await place([{ sku: 'PARA500', qty: 2 }], 'PICKUP');
        await event('DispenseCompleted', { orderId: p2.partnerId, pharmacyId: 'ph_1', dispensedAt: NOW(), partial: true, pharmacistSignoff: so });
        await c.http().post(`/api/v1/admin/pharmacy/orders/${p2.o.id}/resolve-partial`).set(admin).send({}).expect(400).expect((x) => expect(x.body.code).toBe('LINES_REQUIRED'));
        const fixed = await c.http().post(`/api/v1/admin/pharmacy/orders/${p2.o.id}/resolve-partial`).set(admin).send({ lines: [{ sku: 'PARA500', quantityDispensed: 1 }] }).expect(200);
        expect(fixed.body.refundTotalMinor).toBe(2500);
        expect((await c.get(PayService).reconcileDaily()).status).toBe('OK');
      });
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
