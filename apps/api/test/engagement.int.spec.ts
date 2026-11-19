import { createCtx, futureSlot, seedProvider, TestCtx } from './harness';
import { EngagementService } from '../src/engagement/engagement-public';

describe('engagement (KXM-NT-01..03)', () => {
  let c: TestCtx;
  const sub = 'sub_amira';
  let auth: { Authorization: string };
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset();
    auth = await c.as(sub);
    await c.http().put('/api/v1/me/profile').set(auth).send({ nameEn: 'Amira Samy' }).expect(200);
    process.env.QUIET_HOURS_START = '0'; process.env.QUIET_HOURS_END = '0'; // no quiet hours unless a test sets them
  });
  afterAll(() => { delete process.env.QUIET_HOURS_START; delete process.env.QUIET_HOURS_END; });
  const svc = () => c.get(EngagementService);
  const send = (kind: any, key: string) => svc().notify(sub, { kind, params: { doctor: 'Dr X', time: 'T' }, dedupeKey: key });
  const status = async (channel: string) => (await c.prisma.message.findFirstOrThrow({ where: { channel }, orderBy: { createdAt: 'desc' } })).status;

  it('NT-02 consent gates external channels: no consent → SKIPPED_CONSENT, in-app still delivered', async () => {
    await send('REMINDER_24H', 'k1');
    expect(await status('WHATSAPP')).toBe('SKIPPED_CONSENT');
    expect(await status('INAPP')).toBe('SENT');
    await c.http().put('/api/v1/me/consents/REMINDERS').set(auth).send({ granted: true });
    await send('REMINDER_24H', 'k2');
    expect(await status('WHATSAPP')).toBe('SENT');
    expect((await c.prisma.message.findFirstOrThrow({ where: { dedupeKey: 'k2:WHATSAPP' } })).templateId).toMatch(/^TODO_NEEDS_HUMAN_/);
    await c.http().put('/api/v1/me/consents/REMINDERS').set(auth).send({ granted: false });
    await send('REMINDER_2H', 'k3');
    expect(await status('PUSH')).toBe('SKIPPED_CONSENT');
  });

  it('NT-02 opt-out per channel', async () => {
    await c.http().put('/api/v1/me/consents/MARKETPLACE_PROCESSING').set(auth).send({ granted: true });
    await c.http().put('/api/v1/me/notification-preferences/WHATSAPP').set(auth).send({ enabled: false }).expect(200);
    await send('BOOKING_CONFIRMED', 'o1');
    expect(await status('WHATSAPP')).toBe('SKIPPED_OPTOUT');
    expect(await status('PUSH')).toBe('SENT');
    await c.http().put('/api/v1/me/notification-preferences/FAX').set(auth).send({ enabled: false }).expect(400);
    expect((await c.http().get('/api/v1/me/notification-preferences').set(auth)).body.find((p: any) => p.channel === 'WHATSAPP').enabled).toBe(false);
  });

  it('NT-02 quiet hours defer external sends to the end of the window; scheduler delivers later', async () => {
    await c.http().put('/api/v1/me/consents/REMINDERS').set(auth).send({ granted: true });
    const localHour = (new Date().getUTCHours() + 2) % 24; // MARKET_TZ_OFFSET_HOURS default 2
    await c.http().put('/api/v1/me/notification-preferences/WHATSAPP').set(auth).send({ quietStart: localHour, quietEnd: (localHour + 3) % 24 });
    await send('REMINDER_24H', 'q1');
    const m = await c.prisma.message.findFirstOrThrow({ where: { dedupeKey: 'q1:WHATSAPP' } });
    expect(m.status).toBe('SCHEDULED');
    expect(m.reason).toBe('QUIET_HOURS_DEFERRED');
    expect(m.scheduledFor.getTime()).toBeGreaterThan(Date.now() + 2 * 3600_000);
    // after the window the scheduler sends it
    await c.prisma.message.update({ where: { id: m.id }, data: { scheduledFor: new Date(Date.now() - 1000) } });
    await c.http().put('/api/v1/me/notification-preferences/WHATSAPP').set(auth).send({ quietStart: null, quietEnd: null });
    process.env.QUIET_HOURS_START = '0'; process.env.QUIET_HOURS_END = '0';
    await svc().processDue();
    expect((await c.prisma.message.findUniqueOrThrow({ where: { id: m.id } })).status).toBe('SENT');
    // pure window maths
    const e = svc();
    expect(e.quietUntil(new Date('2027-01-01T21:00:00Z'), 22, 8)).not.toBeNull(); // 23:00 Cairo
    expect(e.quietUntil(new Date('2027-01-01T10:00:00Z'), 22, 8)).toBeNull(); // 12:00 Cairo
    expect(e.quietUntil(new Date('2027-01-01T04:00:00Z'), 22, 8)?.toISOString()).toBe('2027-01-01T06:00:00.000Z'); // 06:00 Cairo → ends 08:00 Cairo
  });

  it('dedupe: same key never sends twice; in-app inbox + mark read', async () => {
    await send('BOOKING_CONFIRMED', 'd1');
    await send('BOOKING_CONFIRMED', 'd1');
    expect(await c.prisma.message.count({ where: { channel: 'INAPP' } })).toBe(1);
    const inbox = await c.http().get('/api/v1/me/notifications').set(auth).expect(200);
    expect(inbox.body).toHaveLength(1);
    expect(inbox.body[0].body).toContain('تم تأكيد'); // Arabic-first
    await c.http().post(`/api/v1/me/notifications/${inbox.body[0].id}/read`).set(auth).expect(200);
    expect((await c.http().get('/api/v1/me/notifications').set(auth)).body[0].readAt).toBeTruthy();
  });

  it('NT-01 clinic-cancel notification bypasses quiet hours; NT-03 review invite is scheduled T+2h and de-duplicated by REVIEW_INVITATION_ELIGIBLE', async () => {
    const pid = await seedProvider(c, {});
    c.kiorly.slots = [futureSlot(72)];
    const h = await c.http().post('/api/v1/bookings').set(auth).send({ providerId: pid, typeId: 'typ_1', ...futureSlot(72) }).expect(201);
    await c.http().post(`/api/v1/bookings/${h.body.id}/confirm`).set(auth).send({ marketplaceConsent: true }).expect(200);
    await c.webhook('COMPLETED', { externalReference: h.body.id });
    const w = await c.webhook('REVIEW_INVITATION_ELIGIBLE', { externalReference: h.body.id, occurredAt: new Date().toISOString() });
    expect(w.body.status).toBe('APPLIED');
    expect(await c.prisma.message.count({ where: { bookingId: h.body.id, channel: 'INAPP', params: { path: ['kind'], equals: 'REVIEW_INVITATION' } } })).toBe(1);
  });
});
