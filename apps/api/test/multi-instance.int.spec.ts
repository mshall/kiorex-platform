import { createCtx, futureSlot, seedProvider, TestCtx } from './harness';
import { BookingService } from '../src/booking/booking-public';

const H = { marketplaceConsent: true, remindersConsent: true };

/** A second API process: the same service with its own in-memory state (its own confirm chain), talking to the same database and the same Clinic. */
const secondInstance = (a: BookingService): BookingService => Object.assign(Object.create(Object.getPrototypeOf(a)), a, { confirming: new Map() });

describe('multi-instance safety: booking confirm (gap closure)', () => {
  let c: TestCtx; let auth: { Authorization: string }; let pid: string;
  const slot = futureSlot();
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset(); c.kiorly.slots = [slot, futureSlot(49)]; pid = await seedProvider(c, {}); auth = await c.as('sub_amira');
    await c.http().put('/api/v1/me/profile').set(auth).send({ nameEn: 'Amira Samy', nationalId: '29004020101234' }).expect(200);
  });
  const hold = async () => (await c.http().post('/api/v1/bookings').set(auth).send({ providerId: pid, typeId: 'typ_1', ...slot }).expect(201)).body.id as string;

  it('two instances confirming the same hold at the same moment send ONE booking to the Clinic and both answer the same booking', async () => {
    const id = await hold(); const a = c.get(BookingService); const b = secondInstance(a);
    c.kiorly.delayMs = 400; // the first Clinic call is slow enough for the second instance to arrive while it is in flight
    const [ra, rb] = await Promise.all([a.confirm('sub_amira', id, H), b.confirm('sub_amira', id, H)]);
    expect(c.kiorly.callsTo('POST', '/bookings')).toHaveLength(1);
    expect(ra.id).toBe(id); expect(rb.id).toBe(id);
    expect(['PENDING_CLINIC', 'CONFIRMED']).toContain(ra.status); expect(rb.status).toBe(ra.status);
    expect((await c.prisma.bookingIntent.findUniqueOrThrow({ where: { id } })).callState).toBe('NONE');
  });

  it('ten confirms spread over two instances are one Clinic booking and never expire the booking behind the Clinic', async () => {
    const id = await hold(); const a = c.get(BookingService); const b = secondInstance(a);
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => (i % 2 ? a : b).confirm('sub_amira', id, H)));
    expect(new Set(rs.map((r) => r.status)).size).toBe(1);
    expect(c.kiorly.callsTo('POST', '/bookings')).toHaveLength(1);
    expect((await c.prisma.bookingIntent.findUniqueOrThrow({ where: { id } })).status).not.toBe('EXPIRED');
  });

  it('a claim held by another instance that never finishes answers 503 CONFIRM_IN_PROGRESS (retryable) after the bounded wait, sends nothing to the Clinic and holds no connection while waiting', async () => {
    const id = await hold(); const a = c.get(BookingService);
    await c.prisma.bookingIntent.update({ where: { id }, data: { callState: 'IN_FLIGHT' } }); // a live claim of another instance
    const prevWait = a.confirmWaitMs; a.confirmWaitMs = 500;
    try {
      const t0 = Date.now();
      await expect(a.confirm('sub_amira', id, H)).rejects.toMatchObject({ code: 'CONFIRM_IN_PROGRESS' });
      expect(Date.now() - t0).toBeLessThan(3000);
      expect(c.kiorly.callsTo('POST', '/bookings')).toHaveLength(0);
      // the pool is free: many cheap reads still answer at once
      await Promise.all(Array.from({ length: 30 }, () => c.prisma.bookingIntent.count()));
    } finally { a.confirmWaitMs = prevWait; }
  });

  it('a claim whose lease ran out (the instance died mid-call) is taken over: the retry confirms the booking', async () => {
    const id = await hold(); const a = c.get(BookingService);
    await c.prisma.bookingIntent.update({ where: { id }, data: { callState: 'IN_FLIGHT' } });
    await c.prisma.$executeRaw`UPDATE "BookingIntent" SET "updatedAt" = (now() at time zone 'UTC') - interval '5 minutes' WHERE "id" = ${id}`;
    const r = await a.confirm('sub_amira', id, H);
    expect(['PENDING_CLINIC', 'CONFIRMED']).toContain(r.status);
    expect(c.kiorly.callsTo('POST', '/bookings')).toHaveLength(1);
  });
});
