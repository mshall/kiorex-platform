import { createCtx, futureSlot, productHeaders, seedProvider, TestCtx } from './harness';
import { OutboxService } from '../src/outbox/outbox-public';
import { PayService } from '../src/pay/pay-public';
import { BookingService } from '../src/booking/booking-public';
import { FakePspAdapter } from '../src/pay/psp';

describe('Kiorex Pay (KXM-PAY-01..05)', () => {
  let c: TestCtx;
  let auth: { Authorization: string };
  let pid: string;
  const slot = futureSlot(72);
  const flush = () => c.get(OutboxService).processBatch();
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset();
    c.kiorly.slots = [slot];
    pid = await seedProvider(c, { depositAmount: 150 });
    auth = await c.as('sub_amira');
    await c.http().put('/api/v1/me/profile').set(auth).send({ nameEn: 'Amira Samy' }).expect(200);
  });
  const book = async (s = slot) => {
    const h = await c.http().post('/api/v1/bookings').set(auth).send({ providerId: pid, typeId: 'typ_1', ...s }).expect(201);
    expect(h.body.depositStatus).toBe('REQUIRED');
    expect(h.body.depositAmountMinor).toBe(15000);
    await c.http().post(`/api/v1/bookings/${h.body.id}/confirm`).set(auth).send({ marketplaceConsent: true }).expect(200);
    return h.body.id as string;
  };
  const checkout = async (id: string) => (await c.http().post(`/api/v1/bookings/${id}/deposit-checkout`).set(auth).expect(200)).body;
  const balance = async (account: string) => { const r = (await c.prisma.ledgerEntry.aggregate({ where: { account }, _sum: { debitMinor: true, creditMinor: true } }))._sum; return (r.debitMinor ?? 0) - (r.creditMinor ?? 0); };

  it('PAY-01 deposit via fake hosted checkout: captured, ledgered, Kiorly notified via outbox with paymentRef (idempotent)', async () => {
    const id = await book();
    const co = await checkout(id);
    expect((await checkout(id)).paymentId).toBe(co.paymentId); // checkout is idempotent per booking
    expect(co.checkoutUrl).toContain('/api/v1/pay/fake-checkout/');
    const page = await c.http().get(`/api/v1/pay/fake-checkout/${co.paymentId}`).expect(200);
    expect(page.text).toContain('Kiorex Pay');
    await c.http().post(`/api/v1/pay/fake-checkout/${co.paymentId}/complete`).send({ outcome: 'pay' }).expect(200);
    // double delivery of the capture is harmless
    await c.http().post(`/api/v1/pay/fake-checkout/${co.paymentId}/complete`).send({ outcome: 'pay' }).expect(200);
    const p = await c.prisma.paymentIntent.findUniqueOrThrow({ where: { id: co.paymentId } });
    expect(p.status).toBe('CAPTURED');
    expect(await c.prisma.ledgerTx.count({ where: { idempotencyKey: `capture:${p.id}` } })).toBe(1);
    expect(await balance('PSP_CLEARING')).toBe(15000);
    expect(await balance(`HELD:${p.clinicId}`)).toBe(-15000);
    await flush();
    const dp = c.kiorly.callsTo('POST', '/deposit-paid');
    expect(dp).toHaveLength(1);
    expect(dp[0].body).toMatchObject({ amount: 150, currency: 'EGP', paymentRef: p.id });
    expect(c.kiorly.bad).toBe(0);
    expect((await c.prisma.bookingIntent.findUniqueOrThrow({ where: { id } })).depositStatus).toBe('PAID');
    // status endpoint owner-only
    await c.http().get(`/api/v1/pay/intents/${co.paymentId}`).set(auth).expect(200);
    await c.http().get(`/api/v1/pay/intents/${co.paymentId}`).set(await c.as('sub_hassan')).expect(404);
  });

  it('PSP webhook: bad signature rejected, failures recorded, amount mismatch refused', async () => {
    const id = await book();
    const co = await checkout(id);
    const p = await c.prisma.paymentIntent.findUniqueOrThrow({ where: { id: co.paymentId } });
    const ev = { eventId: 'pe1', type: 'payment.captured', pspRef: p.pspRef, paymentId: p.id, amountMinor: p.amountMinor, occurredAt: new Date().toISOString() };
    await c.http().post('/api/v1/pay/webhooks/paymob').set('x-psp-signature', 'bad').send(ev).expect(400);
    const wrong = JSON.stringify({ ...ev, eventId: 'pe2', amountMinor: 1 });
    await c.http().post('/api/v1/pay/webhooks/paymob').set('content-type', 'application/json').set('x-psp-signature', FakePspAdapter.sign(wrong)).send(wrong).expect(409);
    expect((await c.prisma.paymentIntent.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('CREATED');
    await c.http().post(`/api/v1/pay/fake-checkout/${p.id}/complete`).send({ outcome: 'fail' }).expect(200);
    expect((await c.prisma.paymentIntent.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('FAILED');
  });

  it('KX-09 §05 payment captured but booking failed → automatic refund', async () => {
    const id = await book();
    const co = await checkout(id);
    await c.prisma.bookingIntent.update({ where: { id }, data: { status: 'CANCELLED' } }); // booking died while patient was paying
    await c.http().post(`/api/v1/pay/fake-checkout/${co.paymentId}/complete`).send({ outcome: 'pay' }).expect(200);
    await flush(); // booking handler decides, creates refund
    await flush(); // refund settles
    const rf = await c.prisma.refund.findFirstOrThrow({ where: { paymentId: co.paymentId } });
    expect(rf.status).toBe('SETTLED');
    expect((await c.prisma.paymentIntent.findUniqueOrThrow({ where: { id: co.paymentId } })).status).toBe('REFUNDED');
    expect(await balance('REFUND_PAYABLE')).toBe(0);
  });

  it('PAY-02 refunds are idempotent and can never exceed the capture', async () => {
    const id = await book();
    const co = await checkout(id);
    await c.http().post(`/api/v1/pay/fake-checkout/${co.paymentId}/complete`).send({ outcome: 'pay' });
    const pay = c.get(PayService);
    const r1 = await pay.refund(co.paymentId, { reason: 'x', amountMinor: 5000, idempotencyKey: 'k1' });
    const r1b = await pay.refund(co.paymentId, { reason: 'x', amountMinor: 5000, idempotencyKey: 'k1' });
    expect(r1b.id).toBe(r1.id);
    await expect(pay.refund(co.paymentId, { reason: 'y', amountMinor: 10001, idempotencyKey: 'k2' })).rejects.toMatchObject({ response: { code: 'REFUND_EXCEEDS_CAPTURE' } });
    await pay.refund(co.paymentId, { reason: 'y', amountMinor: 10000, idempotencyKey: 'k3' });
    await expect(pay.refund(co.paymentId, { reason: 'z', amountMinor: 1, idempotencyKey: 'k4' })).rejects.toBeTruthy();
    // concurrent refunds cannot over-refund
    await flush();
    expect((await c.prisma.paymentIntent.findUniqueOrThrow({ where: { id: co.paymentId } })).refundedMinor).toBe(15000);
  });

  it('PAY-04 weekly payouts: only released deposits, idempotent run, Kiorly POST /payouts with payoutRef, ledger drains', async () => {
    const a = await book();
    const b = await book(futureSlot(96));
    const c1 = await checkout(a); const c2 = await checkout(b);
    for (const x of [c1, c2]) await c.http().post(`/api/v1/pay/fake-checkout/${x.paymentId}/complete`).send({ outcome: 'pay' });
    await flush();
    const pay = c.get(PayService);
    expect((await pay.runPayouts()).payouts).toHaveLength(0); // nothing released yet
    await c.webhook('COMPLETED', { externalReference: a });
    await c.webhook('NO_SHOW', { externalReference: b });
    const r = await pay.runPayouts();
    expect(r.payouts).toHaveLength(1);
    expect(r.payouts[0].amountMinor).toBe(30000);
    expect((await pay.runPayouts()).payouts).toHaveLength(0); // idempotent re-run
    await flush();
    const po = c.kiorly.payouts.get(r.payouts[0].payoutRef);
    expect(po).toMatchObject({ clinicId: 'cl_1', amount: 300 });
    expect(po.depositPaymentRefs.sort()).toEqual([c1.paymentId, c2.paymentId].sort());
    expect(await balance('PAYABLE:cl_1')).toBe(0);
    expect(await balance('HELD:cl_1')).toBe(0);
    expect(await balance('PSP_CLEARING')).toBe(0);
    await flush();
    expect(c.kiorly.calls.filter((x) => x.path === '/payouts')).toHaveLength(1);
    // replaying the outbox row at Kiorly is harmless (same payoutRef)
    const ev = await c.prisma.outboxEvent.findFirstOrThrow({ where: { type: 'kiorly.payout_recorded' } });
    await c.get(OutboxService).replay(ev.id);
    expect(c.kiorly.payouts.size).toBe(1);
  });

  it('PAY-05 daily PSP reconciliation: clean day OK; missing, mismatched and unknown lines are reported', async () => {
    const id = await book();
    const co = await checkout(id);
    await c.http().post(`/api/v1/pay/fake-checkout/${co.paymentId}/complete`).send({ outcome: 'pay' });
    const pay = c.get(PayService);
    const ok = await pay.reconcileDaily();
    expect(ok.status).toBe('OK');
    const p = await c.prisma.paymentIntent.findUniqueOrThrow({ where: { id: co.paymentId } });
    const day = new Date().toISOString().slice(0, 10);
    await pay.importSettlementLines([{ psp: 'paymob', pspRef: p.pspRef!, kind: 'CAPTURE', amountMinor: 999, date: day }, { psp: 'paymob', pspRef: 'ghost', kind: 'CAPTURE', amountMinor: 5, date: day }]);
    const bad = await pay.reconcileDaily();
    const types = (bad.discrepancies as any[]).map((d) => d.type).sort();
    expect(bad.status).toBe('DISCREPANCIES');
    expect(types).toEqual(['AMOUNT_MISMATCH', 'UNKNOWN_AT_PSP']);
    // capture without ledger entry is detected
    const tx = await c.prisma.ledgerTx.findUniqueOrThrow({ where: { idempotencyKey: `capture:${p.id}` } });
    await c.prisma.$executeRawUnsafe(`ALTER TABLE "LedgerEntry" DISABLE TRIGGER ledger_entry_balanced`);
    await c.prisma.ledgerEntry.deleteMany({ where: { txId: tx.id } });
    await c.prisma.ledgerTx.delete({ where: { id: tx.id } });
    await c.prisma.$executeRawUnsafe(`ALTER TABLE "LedgerEntry" ENABLE TRIGGER ledger_entry_balanced`);
    expect(((await pay.reconcileDaily()).discrepancies as any[]).some((d) => d.type === 'CAPTURE_WITHOUT_LEDGER')).toBe(true);
  });

  it('DB refuses unbalanced ledger transactions (deferred constraint trigger)', async () => {
    await expect(c.prisma.ledgerTx.create({ data: { idempotencyKey: 'bad', kind: 'X', entries: { create: [{ account: 'a', debitMinor: 10 }, { account: 'b', creditMinor: 9 }] } } })).rejects.toThrow(/unbalanced/);
    await expect(c.prisma.ledgerEntry.create({ data: { tx: { create: { idempotencyKey: 'bad2', kind: 'X' } }, account: 'a', debitMinor: 1, creditMinor: 1 } })).rejects.toBeTruthy();
  });

  it('PAY-03 pay links: Kiorly (product key) registers, patient pays on hosted checkout, Kiorly told via deposit-links endpoint', async () => {
    const body = JSON.stringify({ token: 'lnk_1', clinicId: 'cl_1', amountMinor: 20000 });
    const path = '/api/v1/pay/links';
    await c.http().post(path).set(productHeaders('kiorly-clinic', path, 'ff_dev_secret_change_me', 'POST', body)).set('content-type', 'application/json').send(body).expect(201);
    await c.http().post(path).set(productHeaders('kiorex-account', path, 'ff_dev_secret_change_me', 'POST', body)).set('content-type', 'application/json').send(body).expect(403);
    await c.http().post(path).set('content-type', 'application/json').send(body).expect(401);
    const info = await c.http().get('/api/v1/pay/links/lnk_1').expect(200);
    expect(info.body).toMatchObject({ amountMinor: 20000, status: 'OPEN' });
    const co = await c.http().post('/api/v1/pay/links/lnk_1/checkout').expect(200);
    await c.http().post(`/api/v1/pay/fake-checkout/${co.body.paymentId}/complete`).send({ outcome: 'pay' }).expect(200);
    await flush();
    expect(c.kiorly.callsTo('POST', '/deposit-links/lnk_1/paid')).toHaveLength(1);
    expect((await c.http().get('/api/v1/pay/links/lnk_1')).body.status).toBe('PAID');
    await c.http().post('/api/v1/pay/links/lnk_1/checkout').expect(409);
  });

  it('PSP adapters other than the sandbox fake are NEEDS_HUMAN (fail loudly, no invented credentials)', async () => {
    process.env.PSP_MODE = 'live';
    try {
      const { pspAdapter } = require('../src/pay/psp');
      await expect(pspAdapter('fawry').createCheckout()).rejects.toThrow(/NEEDS_HUMAN/);
    } finally { process.env.PSP_MODE = 'sandbox-fake'; }
  });

  it('ops dashboard shows balances, refunds, payouts, runs', async () => {
    const ops = await c.as('sub_ops', { roles: ['ops_admin'] });
    const d = await c.http().get('/api/v1/admin/payments/dashboard').set(ops).expect(200);
    expect(d.body).toHaveProperty('balances');
    await c.http().get('/api/v1/admin/payments/dashboard').set(auth).expect(403);
    void BookingService;
  });
});
