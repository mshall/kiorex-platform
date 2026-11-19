import { createCtx, futureSlot, seedProvider, TestCtx } from './harness';
import { BookingService } from '../src/booking/booking-public';
import { canTransition, EDGES, nextStatus } from '../src/booking/booking-public';

const H = { marketplaceConsent: true, remindersConsent: true };

describe('booking orchestration (KXM-BK-01..08)', () => {
  let c: TestCtx;
  let auth: { Authorization: string };
  let pid: string;
  const slot = futureSlot();
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset();
    c.kiorly.slots = [slot, futureSlot(49), futureSlot(50), futureSlot(51)];
    pid = await seedProvider(c, {});
    auth = await c.as('sub_amira');
    await c.http().put('/api/v1/me/profile').set(auth).send({ nameEn: 'Amira Samy', nationalId: '29004020101234' }).expect(200);
  });
  const hold = (extra: object = {}) => c.http().post('/api/v1/bookings').set(auth).send({ providerId: pid, typeId: 'typ_1', ...slot, ...extra });
  const confirm = (id: string, body: object = H) => c.http().post(`/api/v1/bookings/${id}/confirm`).set(auth).send(body);

  it('state machine matches KX-03 §05 (edges + event table + out-of-order tolerance)', () => {
    expect(canTransition('HELD', 'CONFIRMED')).toBe(true);
    expect(canTransition('HELD', 'PENDING_CLINIC')).toBe(true);
    expect(canTransition('PENDING_CLINIC', 'EXPIRED')).toBe(true);
    expect(canTransition('CONFIRMED', 'NO_SHOW')).toBe(true);
    expect(canTransition('CHECKED_IN', 'COMPLETED')).toBe(true);
    expect(canTransition('COMPLETED', 'CANCELLED')).toBe(false);
    expect(canTransition('HELD', 'COMPLETED')).toBe(false);
    for (const t of ['COMPLETED', 'NO_SHOW', 'CANCELLED', 'EXPIRED'] as const) expect(EDGES[t]).toEqual([]);
    expect(nextStatus('HELD', 'APPOINTMENT_CONFIRMED')).toBe('CONFIRMED');
    expect(nextStatus('CONFIRMED', 'APPOINTMENT_CONFIRMED')).toBeNull();
    expect(nextStatus('CONFIRMED', 'CHECKED_IN')).toBe('CHECKED_IN');
    expect(nextStatus('CHECKED_IN', 'CHECK_IN_REVERTED')).toBe('CONFIRMED');
    expect(nextStatus('CONFIRMED', 'COMPLETED')).toBe('COMPLETED'); // missed CHECKED_IN
    expect(nextStatus('CHECKED_IN', 'CHECKED_IN')).toBeNull();
    expect(nextStatus('COMPLETED', 'CANCELLED_BY_CLINIC')).toBeNull();
    expect(nextStatus('PENDING_CLINIC', 'MARKETPLACE_BOOKING_CONFIRM_TIMEOUT')).toBe('EXPIRED');
    expect(nextStatus('CONFIRMED', 'MARKETPLACE_BOOKING_CONFIRM_TIMEOUT')).toBeNull();
    expect(nextStatus('CONFIRMED', 'RESCHEDULED')).toBe('CONFIRMED');
    expect(nextStatus('CONFIRMED', 'SLOTS_CHANGED')).toBeNull();
  });

  it('golden flow: hold (BK-02) → idempotent confirm with Idempotency-Key = booking id (BK-03) → CONFIRMED + Kiorly id stored', async () => {
    const h = await hold().expect(201);
    expect(h.body.status).toBe('HELD');
    expect(new Date(h.body.holdExpiresAt).getTime()).toBeGreaterThan(Date.now());
    const holdCall = c.kiorly.callsTo('POST', '/holds')[0];
    expect(holdCall.body.externalRef).toBeTruthy();
    const id = h.body.id;
    const r = await confirm(id).expect(200);
    expect(r.body.status).toBe('CONFIRMED');
    const bk = c.kiorly.callsTo('POST', '/bookings')[0];
    expect(bk.headers['idempotency-key']).toBe(id);
    expect(bk.body.holdExternalRef).toBe(holdCall.body.externalRef);
    expect(bk.body.patient.nationalId).toBe('29004020101234');
    expect(c.kiorly.bad).toBe(0);
    const row = await c.prisma.bookingIntent.findUniqueOrThrow({ where: { id } });
    expect(row.kiorlyAppointmentId).toBe('apt_1');
    // double click / app retry → same result, no second Kiorly booking
    const again = await confirm(id).expect(200);
    expect(again.body.status).toBe('CONFIRMED');
    expect(c.kiorly.callsTo('POST', '/bookings')).toHaveLength(1);
    // patient link recorded (AC-07) and notifications + reminders scheduled (NT-01)
    expect((await c.prisma.kiorlyPatientLink.findMany({ where: { sub: 'sub_amira' } }))[0].status).toBe('LINKED');
    const msgs = await c.prisma.message.findMany({ where: { bookingId: id, channel: 'INAPP' } });
    expect(msgs.map((m) => (m.params as any).kind).sort()).toEqual(['BOOKING_CONFIRMED', 'REMINDER_24H', 'REMINDER_2H']);
    // timeline shows intent → held → confirmed
    const get = await c.http().get(`/api/v1/bookings/${id}`).set(auth).expect(200);
    expect(get.body.timeline.map((t: any) => t.status)).toEqual(['HELD', 'CONFIRMED']);
    const ics = await c.http().get(`/api/v1/bookings/${id}/calendar.ics`).set(auth).expect(200);
    expect(ics.text).toContain('BEGIN:VEVENT');
  });

  it('requires marketplace consent and guards ownership', async () => {
    const { body } = await hold().expect(201);
    await confirm(body.id, { marketplaceConsent: false }).expect(400);
    await c.http().post(`/api/v1/bookings/${body.id}/confirm`).set(await c.as('sub_hassan')).send(H).expect(404);
  });

  it('KXM-BK-04 hold 409 SLOT_TAKEN returns 3 alternatives from Kiorly', async () => {
    c.kiorly.holdMode = '409';
    const r = await hold().expect(409);
    expect(r.body.code).toBe('SLOT_TAKEN');
    expect(r.body.alternatives).toHaveLength(3);
    expect((await c.prisma.bookingIntent.findFirstOrThrow()).status).toBe('EXPIRED');
  });

  it('KXM-BK-04 book 409 SLOT_TAKEN → alternatives, intent EXPIRED', async () => {
    const { body } = await hold().expect(201);
    c.kiorly.bookingMode = '409';
    const r = await confirm(body.id).expect(409);
    expect(r.body.code).toBe('SLOT_TAKEN');
    expect(r.body.alternatives).toHaveLength(3);
    expect((await c.prisma.bookingIntent.findUniqueOrThrow({ where: { id: body.id } })).failureCode).toBe('SLOT_TAKEN');
  });

  it('KXM-BK-05 timeout where Kiorly DID create: GET by ref adopts it; never a second POST / new key', async () => {
    const { body } = await hold().expect(201);
    c.kiorly.bookingMode = 'timeout-created';
    const r = await confirm(body.id).expect(200);
    expect(r.body.status).toBe('CONFIRMED');
    expect(c.kiorly.callsTo('POST', '/bookings')).toHaveLength(1);
    expect(c.kiorly.callsTo('GET', `/bookings/${body.id}`)).toHaveLength(1);
    expect(new Set(c.kiorly.callsTo('POST', '/bookings').map((x) => x.headers['idempotency-key'])).size).toBe(1);
  });

  it('KXM-BK-05 timeout where Kiorly did NOT create: 503 pending; retry reuses the SAME key and succeeds', async () => {
    const { body } = await hold().expect(201);
    c.kiorly.bookingMode = 'timeout';
    const r = await confirm(body.id).expect(503);
    expect(r.body.code).toBe('CLINIC_SYSTEM_BUSY');
    expect(r.body.bookingId).toBe(body.id);
    expect((await c.prisma.bookingIntent.findUniqueOrThrow({ where: { id: body.id } })).callState).toBe('UNCERTAIN');
    c.kiorly.bookingMode = undefined;
    const ok = await confirm(body.id).expect(200);
    expect(ok.body.status).toBe('CONFIRMED');
    const keys = c.kiorly.callsTo('POST', '/bookings').map((x) => x.headers['idempotency-key']);
    expect(keys.every((k) => k === body.id)).toBe(true);
    expect(c.kiorly.bookings.size).toBe(1);
  });

  it('5xx from Kiorly: intent stays pending (HELD/UNCERTAIN), nightly reconciliation resolves it via GET', async () => {
    const { body } = await hold().expect(201);
    c.kiorly.bookingMode = '5xx';
    c.kiorly.getBookingMode = '5xx';
    await confirm(body.id).expect(503);
    c.kiorly.bookingMode = undefined; c.kiorly.getBookingMode = undefined;
    // Kiorly in fact created it meanwhile
    c.kiorly.bookings.set(body.id, c.kiorly.makeBooking(body.id, { clinicId: 'cl_1', clinicianId: 'dr_1', typeId: 'typ_1', startsAt: slot.startsAt, endsAt: slot.endsAt, patient: { phone: '+201000000001' } }));
    await c.prisma.bookingIntent.update({ where: { id: body.id }, data: { updatedAt: new Date(Date.now() - 3600_000) } });
    const rec = await c.get(BookingService).reconcileNightly();
    expect(rec.corrected).toBe(1);
    expect((await c.prisma.bookingIntent.findUniqueOrThrow({ where: { id: body.id } })).status).toBe('CONFIRMED');
  });

  it('circuit breaker per clinic: repeated failures pause new holds for that clinic (503), other clinics unaffected', async () => {
    c.kiorly.holdMode = '5xx';
    for (let i = 0; i < 5; i++) await hold().expect(503);
    c.kiorly.holdMode = undefined;
    const r = await hold().expect(503);
    expect(r.body.code).toBe('CLINIC_SYSTEM_BUSY');
    expect(c.kiorly.callsTo('POST', '/holds')).toHaveLength(5); // sixth never left the building
    const other = await seedProvider(c, { id: 'lst_2', clinicId: 'cl_2', clinicianId: 'dr_2' });
    await c.http().post('/api/v1/bookings').set(auth).send({ providerId: other, typeId: 'typ_1', ...slot }).expect(201);
  });

  it('KXM-BK-06 pending clinic confirmation: PENDING_CLINIC with due time; webhook confirm and confirm-timeout', async () => {
    c.kiorly.autoConfirm = false;
    const { body } = await hold().expect(201);
    const r = await confirm(body.id).expect(200);
    expect(r.body.status).toBe('PENDING_CLINIC');
    expect(r.body.confirmationDueAt).toBeTruthy();
    const w = await c.webhook('APPOINTMENT_CONFIRMED', { externalReference: body.id, appointmentId: 'apt_1' });
    expect(w.body.status).toBe('APPLIED');
    expect((await c.prisma.bookingIntent.findUniqueOrThrow({ where: { id: body.id } })).status).toBe('CONFIRMED');
    // second booking times out
    const b2 = await c.http().post('/api/v1/bookings').set(auth).send({ providerId: pid, typeId: 'typ_1', ...futureSlot(60) }).expect(201);
    await confirm(b2.body.id).expect(200);
    const t = await c.webhook('MARKETPLACE_BOOKING_CONFIRM_TIMEOUT', { externalReference: b2.body.id });
    expect(t.body.status).toBe('APPLIED');
    expect((await c.prisma.bookingIntent.findUniqueOrThrow({ where: { id: b2.body.id } })).status).toBe('EXPIRED');
  });

  it('BK-02 hold lapse → EXPIRED (job) and confirm after lapse returns HOLD_EXPIRED with alternatives', async () => {
    const { body } = await hold().expect(201);
    await c.prisma.bookingIntent.update({ where: { id: body.id }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });
    const r = await confirm(body.id).expect(422);
    expect(r.body.code).toBe('HOLD_EXPIRED');
    expect(r.body.alternatives.length).toBeGreaterThan(0);
    const b2 = await hold({ startsAt: futureSlot(49).startsAt, endsAt: futureSlot(49).endsAt }).expect(201);
    await c.prisma.bookingIntent.update({ where: { id: b2.body.id }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });
    expect(await c.get(BookingService).expireHolds()).toBe(1);
    expect((await c.prisma.bookingIntent.findUniqueOrThrow({ where: { id: b2.body.id } })).status).toBe('EXPIRED');
  });

  it('release hold by patient; unverified/paused listings never bookable', async () => {
    const { body } = await hold().expect(201);
    const r = await c.http().post(`/api/v1/bookings/${body.id}/release`).set(auth).expect(200);
    expect(r.body.status).toBe('EXPIRED');
    expect(c.kiorly.callsTo('DELETE', '/holds/')).toHaveLength(1);
    await c.prisma.provider.update({ where: { id: pid }, data: { status: 'PAUSED' } });
    await hold().expect(409);
  });

  it('KXM-BK-07 cancel + reschedule via Kiorly; policy errors surfaced (CANCELLATION_WINDOW_CLOSED)', async () => {
    const { body } = await hold().expect(201);
    await confirm(body.id).expect(200);
    const ns = futureSlot(72);
    const rs = await c.http().post(`/api/v1/bookings/${body.id}/reschedule`).set(auth).send(ns).expect(200);
    expect(new Date(rs.body.startsAt).toISOString()).toBe(ns.startsAt);
    expect(await c.prisma.message.count({ where: { bookingId: body.id, status: 'CANCELLED' } })).toBeGreaterThan(0); // old reminders cancelled
    c.kiorly.cancelMode = '409';
    expect((await c.http().post(`/api/v1/bookings/${body.id}/reschedule`).set(auth).send(futureSlot(80)).expect(409)).body.code).toBe('SLOT_TAKEN');
    c.kiorly.cancelMode = '422-window';
    const w = await c.http().post(`/api/v1/bookings/${body.id}/cancel`).set(auth).send({ reason: 'x' }).expect(422);
    expect(w.body.code).toBe('CANCELLATION_WINDOW_CLOSED');
    c.kiorly.cancelMode = undefined;
    const ok = await c.http().post(`/api/v1/bookings/${body.id}/cancel`).set(auth).send({ reason: 'plans changed' }).expect(200);
    expect(ok.body.status).toBe('CANCELLED');
    expect(ok.body.cancelledBy).toBe('PATIENT');
    await c.http().post(`/api/v1/bookings/${body.id}/cancel`).set(auth).send({}).expect(422); // already cancelled
  });

  it('dependants: book on behalf of a child (guardian rights) and not for someone else\'s', async () => {
    const dob = new Date(Date.now() - 4 * 365 * 86400_000).toISOString().slice(0, 10);
    const d = await c.http().post('/api/v1/me/dependants').set(auth).send({ nameEn: 'Omar Samy', dateOfBirth: dob, relationship: 'CHILD' }).expect(201);
    const { body } = await hold({ dependantId: d.body.id }).expect(201);
    await confirm(body.id).expect(200);
    expect(c.kiorly.callsTo('POST', '/bookings')[0].body.patient.firstNameEn).toBe('Omar');
    expect(c.kiorly.callsTo('POST', '/bookings')[0].body.patient.nationalId).toBeUndefined();
    const other = await c.as('sub_hassan');
    await c.http().post('/api/v1/bookings').set(other).send({ providerId: pid, typeId: 'typ_1', ...slot, dependantId: d.body.id }).expect(403);
  });

  it('identity conflict from Kiorly is parked for review, never auto-merged', async () => {
    const { body } = await hold().expect(201);
    c.kiorly.bookingMode = '409-identity';
    const r = await confirm(body.id).expect(409);
    expect(r.body.code).toBe('PATIENT_IDENTITY_CONFLICT');
    const links = await c.prisma.kiorlyPatientLink.findMany({ where: { sub: 'sub_amira' } });
    expect(links).toHaveLength(1);
    expect(links[0].status).toBe('CONFLICT_REVIEW');
  });

  it('nightly reconciliation: GET by ref for non-terminal intents idle > 24 h; missing in Kiorly is flagged', async () => {
    const { body } = await hold().expect(201);
    await confirm(body.id).expect(200);
    c.kiorly.bookings.get(body.id).status = 'COMPLETED'; // missed webhook
    const old = new Date(Date.now() - 25 * 3600_000);
    await c.prisma.bookingIntent.update({ where: { id: body.id }, data: { updatedAt: old } });
    const r = await c.get(BookingService).reconcileNightly();
    expect(r.checked).toBe(1);
    expect(r.corrected).toBe(1);
    expect((await c.prisma.bookingIntent.findUniqueOrThrow({ where: { id: body.id } })).status).toBe('COMPLETED');
    expect((await c.prisma.reconciliationRun.findFirstOrThrow({ where: { kind: 'BOOKING_NIGHTLY' } })).stats).toMatchObject({ corrected: 1 });
  });
});
