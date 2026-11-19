import { signWebhook } from '@kiorex/contracts';
import request from 'supertest';
import { createCtx, futureSlot, seedProvider, TestCtx } from './harness';
import { OutboxService } from '../src/outbox/outbox-public';

describe('Kiorly webhooks → state machine + side effects (KX-03 §05)', () => {
  let c: TestCtx;
  let auth: { Authorization: string };
  let pid: string;
  const slot = futureSlot(72);
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset();
    c.kiorly.slots = [slot, futureSlot(73), futureSlot(74), futureSlot(75)];
    pid = await seedProvider(c, { depositAmount: 100 });
    auth = await c.as('sub_amira');
    await c.http().put('/api/v1/me/profile').set(auth).send({ nameEn: 'Amira Samy' }).expect(200);
    await c.http().put('/api/v1/me/consents/REMINDERS').set(auth).send({ granted: true });
  });
  const book = async () => {
    const h = await c.http().post('/api/v1/bookings').set(auth).send({ providerId: pid, typeId: 'typ_1', ...slot }).expect(201);
    await c.http().post(`/api/v1/bookings/${h.body.id}/confirm`).set(auth).send({ marketplaceConsent: true, remindersConsent: true }).expect(200);
    return h.body.id as string;
  };
  const status = async (id: string) => (await c.prisma.bookingIntent.findUniqueOrThrow({ where: { id } })).status;
  const payDeposit = async (id: string) => {
    const co = await c.http().post(`/api/v1/bookings/${id}/deposit-checkout`).set(auth).expect(200);
    await c.http().post(`/api/v1/pay/fake-checkout/${co.body.paymentId}/complete`).send({ outcome: 'pay' }).expect(200);
    await c.get(OutboxService).processBatch();
    return co.body.paymentId as string;
  };

  it('verifies the Kiorly signature: sha256=HMAC(ts.rawBody); rejects bad, missing and stale', async () => {
    const r = await c.webhook('NO_SHOW', { externalReference: 'x' }, { badSig: true });
    expect(r.status).toBe(401);
    const body = JSON.stringify({ eventId: 'e1', type: 'COMPLETED', aggregateType: 'Appointment', aggregateId: 'a', data: {} });
    await request(c.app.getHttpServer()).post('/api/v1/webhooks/kiorly').set('content-type', 'application/json').send(body).expect(401);
    const stale = signWebhook({ secret: 'kx_dev_webhook_secret', body, timestamp: Math.floor(Date.now() / 1000) - 3600 });
    await request(c.app.getHttpServer()).post('/api/v1/webhooks/kiorly').set({ ...stale.headers, 'content-type': 'application/json' }).send(body).expect(401);
    const good = signWebhook({ secret: 'kx_dev_webhook_secret', body });
    await request(c.app.getHttpServer()).post('/api/v1/webhooks/kiorly').set({ ...good.headers, 'content-type': 'application/json' }).send(body).expect(200);
  });

  it('de-duplicates on eventId', async () => {
    const id = await book();
    const a = await c.webhook('CHECKED_IN', { externalReference: id }, { eventId: 'dup_1' });
    expect(a.body.status).toBe('APPLIED');
    const b = await c.webhook('CHECKED_IN', { externalReference: id }, { eventId: 'dup_1' });
    expect(b.body.status).toBe('DUPLICATE');
    expect(await c.prisma.webhookReceipt.count({ where: { eventId: 'dup_1' } })).toBe(1);
  });

  it('CONFIRMED→CHECKED_IN→(revert)→CHECKED_IN→COMPLETED; completion schedules review invite T+2h; deposit released', async () => {
    const id = await book();
    await payDeposit(id);
    expect((await c.prisma.bookingIntent.findUniqueOrThrow({ where: { id } })).depositStatus).toBe('PAID');
    await c.webhook('CHECKED_IN', { externalReference: id });
    expect(await status(id)).toBe('CHECKED_IN');
    await c.webhook('CHECK_IN_REVERTED', { externalReference: id });
    expect(await status(id)).toBe('CONFIRMED');
    await c.webhook('CHECKED_IN', { externalReference: id });
    await c.webhook('COMPLETED', { externalReference: id });
    expect(await status(id)).toBe('COMPLETED');
    const inv = await c.prisma.message.findFirstOrThrow({ where: { bookingId: id, channel: 'INAPP', params: { path: ['kind'], equals: 'REVIEW_INVITATION' } } });
    const delta = inv.scheduledFor.getTime() - Date.now();
    expect(delta).toBeGreaterThan(2 * 3600_000 - 60_000);
    expect(delta).toBeLessThan(2 * 3600_000 + 60_000);
    const pay = await c.prisma.paymentIntent.findFirstOrThrow({ where: { bookingId: id } });
    expect(pay.releaseKind).toBe('COMPLETED');
    expect((await c.prisma.bookingIntent.findUniqueOrThrow({ where: { id } })).depositStatus).toBe('RELEASED');
    // late/stale events never move a terminal booking
    expect((await c.webhook('CANCELLED_BY_CLINIC', { externalReference: id })).body.status).toBe('IGNORED');
    expect(await status(id)).toBe('COMPLETED');
  });

  it('RESCHEDULED updates time and reminders', async () => {
    const id = await book();
    const ns = futureSlot(100);
    await c.webhook('RESCHEDULED', { externalReference: id, startsAt: ns.startsAt, endsAt: ns.endsAt });
    const b = await c.prisma.bookingIntent.findUniqueOrThrow({ where: { id } });
    expect(b.startsAt.toISOString()).toBe(ns.startsAt);
    expect(b.status).toBe('CONFIRMED');
    const kinds = (await c.prisma.message.findMany({ where: { bookingId: id, channel: 'INAPP', status: 'SENT' } })).map((m) => (m.params as any).kind);
    expect(kinds).toContain('BOOKING_CHANGED');
  });

  it('CANCELLED_BY_CLINIC: auto-refund of deposit, apology + alternatives notification', async () => {
    const id = await book();
    const paymentId = await payDeposit(id);
    const r = await c.webhook('CANCELLED_BY_CLINIC', { externalReference: id, cancelledBy: 'CLINIC', cancellationReason: 'doctor unavailable' });
    expect(r.body.status).toBe('APPLIED');
    const b = await c.prisma.bookingIntent.findUniqueOrThrow({ where: { id } });
    expect(b.status).toBe('CANCELLED');
    expect(b.cancelledBy).toBe('CLINIC');
    expect(b.depositStatus).toBe('REFUNDED');
    await c.get(OutboxService).processBatch();
    const rf = await c.prisma.refund.findFirstOrThrow({ where: { paymentId } });
    expect(rf.status).toBe('SETTLED');
    expect(rf.amountMinor).toBe(10000);
    const note = await c.prisma.message.findFirstOrThrow({ where: { bookingId: id, channel: 'INAPP', params: { path: ['kind'], equals: 'BOOKING_CANCELLED_BY_CLINIC' } } });
    expect((note.params as any).alternatives).toContain('T');
  });

  it('CANCELLED_BY_PATIENT: refunds only if depositRefundable; absent flag → asks Kiorly, else parked for review', async () => {
    const id = await book();
    await payDeposit(id);
    await c.webhook('CANCELLED_BY_PATIENT', { externalReference: id, depositRefundable: false });
    expect((await c.prisma.bookingIntent.findUniqueOrThrow({ where: { id } })).depositStatus).toBe('FORFEITED');
    expect(await c.prisma.refund.count()).toBe(0);
    // refundable true
    const slot2 = futureSlot(90);
    const h = await c.http().post('/api/v1/bookings').set(auth).send({ providerId: pid, typeId: 'typ_1', ...slot2 }).expect(201);
    await c.http().post(`/api/v1/bookings/${h.body.id}/confirm`).set(auth).send({ marketplaceConsent: true }).expect(200);
    await payDeposit(h.body.id);
    await c.webhook('CANCELLED_BY_PATIENT', { externalReference: h.body.id, depositRefundable: true });
    expect((await c.prisma.bookingIntent.findUniqueOrThrow({ where: { id: h.body.id } })).depositStatus).toBe('REFUNDED');
    // absent: Kiorly GET says refundable=undefined → ops review audit, no refund
    const slot3 = futureSlot(95);
    const h3 = await c.http().post('/api/v1/bookings').set(auth).send({ providerId: pid, typeId: 'typ_1', ...slot3 }).expect(201);
    await c.http().post(`/api/v1/bookings/${h3.body.id}/confirm`).set(auth).send({ marketplaceConsent: true }).expect(200);
    await payDeposit(h3.body.id);
    c.kiorly.bookings.get(h3.body.id).depositRefundable = null;
    await c.webhook('CANCELLED_BY_PATIENT', { externalReference: h3.body.id });
    expect(await c.prisma.auditLog.count({ where: { action: 'booking.refund_policy_review', resourceId: h3.body.id } })).toBe(1);
  });

  it('NO_SHOW: deposit forfeited to clinic, no-show score incremented', async () => {
    const id = await book();
    await payDeposit(id);
    await c.webhook('NO_SHOW', { externalReference: id });
    expect(await status(id)).toBe('NO_SHOW');
    expect((await c.prisma.paymentIntent.findFirstOrThrow({ where: { bookingId: id } })).releaseKind).toBe('FORFEITED');
    expect((await c.prisma.patientProfile.findUniqueOrThrow({ where: { sub: 'sub_amira' } })).noShowCount).toBe(1);
  });

  it('events for bookings Kiorex does not own are acknowledged and ignored; unknown types too', async () => {
    const r = await c.webhook('COMPLETED', { externalReference: 'someone_elses' }, { aggregateId: 'apt_x' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('UNKNOWN_BOOKING');
    expect((await c.webhook('PrescriptionIssued', {})).body.status).toBe('IGNORED');
  });

  it('webhook can arrive before the confirm response (HELD → CONFIRMED) without double side effects', async () => {
    const h = await c.http().post('/api/v1/bookings').set(auth).send({ providerId: pid, typeId: 'typ_1', ...slot }).expect(201);
    await c.webhook('APPOINTMENT_CONFIRMED', { externalReference: h.body.id, appointmentId: 'apt_1' });
    expect(await status(h.body.id)).toBe('CONFIRMED');
    await c.http().post(`/api/v1/bookings/${h.body.id}/confirm`).set(auth).send({ marketplaceConsent: true }).expect(200);
    const confirmed = await c.prisma.message.count({ where: { bookingId: h.body.id, channel: 'INAPP', params: { path: ['kind'], equals: 'BOOKING_CONFIRMED' } } });
    expect(confirmed).toBe(1);
  });

  it('COMMISSION_CHARGE_* are recorded for reporting only', async () => {
    const r = await c.webhook('COMMISSION_CHARGE_CREATED', { amount: 40 }, { aggregateId: 'apt_9' });
    expect(r.body.status).toBe('APPLIED');
    expect(await c.prisma.auditLog.count({ where: { action: 'finance.commission_charge_created' } })).toBe(1);
  });
});
