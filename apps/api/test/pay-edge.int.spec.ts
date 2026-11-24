import { createCtx, futureSlot, seedProvider, TestCtx } from './harness';
import { PayService } from '../src/pay/pay-public';
import { FakePspAdapter } from '../src/pay/psp';

/** EDGE 40 regression on the in-process API (Postgres test DB): webhook idempotency, retryable failures, concurrent checkout, refund after release. */
describe('Kiorex Pay edge cases', () => {
  let c: TestCtx; let auth: { Authorization: string }; let pid: string;
  const slot = futureSlot(72);
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.reset(); await c.close(); }); // leave the shared test database empty for the next spec
  beforeEach(async () => {
    await c.reset(); c.kiorly.slots = [slot];
    pid = await seedProvider(c, { depositAmount: 150 });
    auth = await c.as('sub_amira');
    await c.http().put('/api/v1/me/profile').set(auth).send({ nameEn: 'Amira Samy' }).expect(200);
  });
  const book = async () => {
    const h = await c.http().post('/api/v1/bookings').set(auth).send({ providerId: pid, typeId: 'typ_1', ...slot }).expect(201);
    await c.http().post(`/api/v1/bookings/${h.body.id}/confirm`).set(auth).send({ marketplaceConsent: true }).expect(200);
    return h.body.id as string;
  };
  const checkout = async (id: string) => (await c.http().post(`/api/v1/bookings/${id}/deposit-checkout`).set(auth).expect(200)).body;
  const deliver = (psp: string, ev: object, raw = JSON.stringify(ev)) => c.http().post(`/api/v1/pay/webhooks/${psp}`).set('content-type', 'application/json').set('x-psp-signature', FakePspAdapter.sign(raw)).send(raw);
  const ev = (p: { id: string; pspRef: string | null; amountMinor: number }, type = 'payment.captured', over = {}) => ({ eventId: `pspev_${Math.random()}`, type, pspRef: p.pspRef, paymentId: p.id, amountMinor: p.amountMinor, occurredAt: new Date().toISOString(), ...over });

  it('a capture event delivered 6x concurrently captures once and never answers 5xx', async () => {
    const co = await checkout(await book());
    const p = await c.prisma.paymentIntent.findUniqueOrThrow({ where: { id: co.paymentId } });
    const e = ev(p);
    const rs = await Promise.all(Array.from({ length: 6 }, () => deliver(p.psp, e)));
    expect(rs.map((r) => r.status)).toEqual(Array(6).fill(200));
    expect(rs.filter((r) => r.body.status === 'CAPTURED')).toHaveLength(1);
    expect(await c.prisma.ledgerTx.count({ where: { idempotencyKey: `capture:${p.id}` } })).toBe(1);
  });

  it('a delivery that fails (amount mismatch) leaves no receipt: the PSP retry of the same event id is processed', async () => {
    const co = await checkout(await book());
    const p = await c.prisma.paymentIntent.findUniqueOrThrow({ where: { id: co.paymentId } });
    const bad = ev(p, 'payment.captured', { amountMinor: p.amountMinor - 1 });
    expect((await deliver(p.psp, bad)).status).toBe(409);
    expect(await c.prisma.webhookReceipt.count({ where: { eventId: `psp:${bad.eventId}` } })).toBe(0);
    expect((await deliver(p.psp, { ...bad, amountMinor: p.amountMinor })).body.status).toBe('CAPTURED');
  });

  it('malformed signed bodies and a currency mismatch are 4xx', async () => {
    const co = await checkout(await book());
    const p = await c.prisma.paymentIntent.findUniqueOrThrow({ where: { id: co.paymentId } });
    expect((await deliver(p.psp, {}, '{nope')).status).toBe(400);
    expect((await deliver(p.psp, {}, '[]')).status).toBe(400);
    expect((await deliver(p.psp, { eventId: 'x', type: 'payment.captured', amountMinor: 'a' })).status).toBe(400);
    expect((await deliver(p.psp, ev(p, 'payment.captured', { currency: 'USD' }))).status).toBe(409);
  });

  it('six concurrent deposit checkouts create one intent', async () => {
    const id = await book();
    await Promise.all(Array.from({ length: 6 }, () => c.http().post(`/api/v1/bookings/${id}/deposit-checkout`).set(auth)));
    expect(await c.prisma.paymentIntent.count({ where: { bookingId: id } })).toBe(1);
  });

  it('a payment already released to the provider cannot be refunded (HELD would go negative)', async () => {
    const id = await book(); const co = await checkout(id);
    await c.http().post(`/api/v1/pay/fake-checkout/${co.paymentId}/complete`).send({ outcome: 'pay' }).expect(200);
    await c.get(PayService).releaseForBooking(id, 'COMPLETED');
    await expect(c.get(PayService).refund(co.paymentId, { reason: 'late', amountMinor: 100, idempotencyKey: 'late-1' })).rejects.toMatchObject({ response: { code: 'ALREADY_RELEASED' } });
  });
});
