import { createHmac } from 'node:crypto';
import { CatalogService } from '../src/catalog/catalog-public';
import { createCtx, futureSlot, seedProvider, TestCtx } from './harness';

const PHONE = '+201000000001';

describe('WhatsApp booking channel (KXM-BK-11, mock messaging adapter)', () => {
  let c: TestCtx; let auth: { Authorization: string }; let admin: { Authorization: string };
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset();
    c.kiorly.slots = [futureSlot(72), futureSlot(73), futureSlot(74)];
    await seedProvider(c, { specialty: 'dermatology' });
    auth = await c.as('sub_amira'); admin = await c.as('adm1', { roles: ['super_admin', 'ops_admin'] });
    await c.http().put('/api/v1/me/profile').set(auth).send({ nameEn: 'Amira Samy', preferredLocale: 'en' }).expect(200);
  });
  afterEach(() => { delete process.env.KIORLY_ACCEPTS_WHATSAPP_CHANNEL; });

  /** Simulate a patient reply; returns the bodies of the replies the platform sent. */
  const say = async (text: string, from = PHONE) => {
    const r = await c.http().post('/api/v1/dev/messaging/inbound').send({ channel: 'WHATSAPP', from, text }).expect(200);
    return r.body.replies.map((m: any) => m.body as string);
  };
  const state = async (from = PHONE) => (await c.http().get(`/api/v1/dev/channels/whatsapp/conversation?phone=${encodeURIComponent(from)}`)).body.state;

  it('golden flow: hello -> specialty -> doctor -> slot -> hold -> YES confirms through the same holds/bookings API with source KIOREX_WHATSAPP', async () => {
    let r = await say('hi');
    expect(r[0]).toContain('Dermatology'); expect(await state()).toBe('CHOOSE_SPECIALTY');
    r = await say('1');
    expect(r[0]).toContain('Dr Sara Hassan'); expect(await state()).toBe('CHOOSE_DOCTOR');
    r = await say('1');
    expect(r[0]).toMatch(/1\. .*\d\d:\d\d/); expect(await state()).toBe('CHOOSE_SLOT');
    r = await say('2');
    expect(r[0]).toContain('holding'); expect(r[0]).toContain('TODO_NEEDS_HUMAN'); expect(await state()).toBe('CONFIRM');
    const held = await c.prisma.bookingIntent.findFirstOrThrow({});
    expect(held).toMatchObject({ status: 'HELD', channel: 'WHATSAPP', sub: 'sub_amira' });
    expect(held.startsAt.toISOString()).toBe(c.kiorly.slots[1].startsAt);
    expect(c.kiorly.callsTo('POST', '/holds')).toHaveLength(1);
    r = await say('yes');
    expect(r[0]).toContain('confirmed');
    const done = await c.prisma.bookingIntent.findUniqueOrThrow({ where: { id: held.id } });
    expect(done.status).toBe('CONFIRMED');
    const call = c.kiorly.callsTo('POST', '/bookings')[0];
    expect(call.headers['idempotency-key']).toBe(held.id);
    expect(call.body).toMatchObject({ channel: 'MARKETPLACE', attribution: { source: 'kiorex_whatsapp' }, marketplaceConsentGranted: true });
    expect(await state()).toBe('IDLE');
    expect((await c.http().get('/api/v1/me/consents').set(auth)).body.find((x: any) => x.purpose === 'MARKETPLACE_PROCESSING').granted).toBe(true);
    // the booking is the very same object the app sees
    expect((await c.http().get(`/api/v1/bookings/${held.id}`).set(auth)).body).toMatchObject({ status: 'CONFIRMED', channel: 'WHATSAPP' });
  });

  it('sends KIOREX_WHATSAPP to Kiorly only once Kiorly accepts that channel (KIORLY_ACCEPTS_WHATSAPP_CHANNEL)', async () => {
    process.env.KIORLY_ACCEPTS_WHATSAPP_CHANNEL = 'true';
    await say('rash'); await say('1'); await say('1'); await say('yes');
    expect(c.kiorly.callsTo('POST', '/bookings')[0].body.channel).toBe('KIOREX_WHATSAPP');
  });

  it('free-text symptoms jump straight to doctors; Arabic profile gets Arabic replies', async () => {
    const r = await say('I have a rash');
    expect(r[0]).toContain('Dr Sara Hassan');
    await c.http().put('/api/v1/me/profile').set(auth).send({ preferredLocale: 'ar' });
    await say('0');
    const ar = await say('مرحبا');
    expect(ar[0]).toContain('الجلدية');
  });

  it('NO or 0 releases the hold; replies are logged with TODO_NEEDS_HUMAN template ids and mock mode', async () => {
    await say('hi'); await say('1'); await say('1'); await say('1');
    expect((await c.prisma.bookingIntent.findFirstOrThrow({})).status).toBe('HELD');
    await say('no');
    expect((await c.prisma.bookingIntent.findFirstOrThrow({})).status).toBe('EXPIRED');
    expect(await state()).toBe('IDLE');
    const out = (await c.http().get('/api/v1/dev/messaging/outbox?channel=WHATSAPP')).body.items;
    expect(out.length).toBeGreaterThan(4);
    expect(out.every((m: any) => m.templateId.startsWith('TODO_NEEDS_HUMAN_wa_booking_') && m.mode === 'mock' && m.recipient === PHONE)).toBe(true);
    await say('hi'); await say('1'); await say('1'); await say('1');
    await say('0');
    expect((await c.prisma.bookingIntent.findMany({ orderBy: { createdAt: 'desc' } }))[0].status).toBe('EXPIRED');
  });

  it('SAFETY: emergency language at any step shows 123 guidance, frees the hold and blocks booking (never a flag)', async () => {
    await say('hi'); await say('1'); await say('1'); await say('1');
    expect(await state()).toBe('CONFIRM');
    const r = await say('I have chest pain');
    expect(r[0]).toContain('123'); expect(r[0]).toContain('NEEDS_HUMAN_APPROVAL');
    expect((await c.prisma.bookingIntent.findFirstOrThrow({})).status).toBe('EXPIRED');
    expect(await state()).toBe('IDLE');
    // still active with the booking flag OFF, and nothing about the symptom was stored in analytics
    await c.http().put('/api/v1/admin/flags/kiorex.whatsapp_booking/values').set(admin).send({ scope: 'GLOBAL', value: 'OFF', reason: 't', ticket: 'T-1' }).expect(200);
    expect((await say('cant breathe'))[0]).toContain('123');
    const ev = await c.prisma.analyticsEvent.findMany({ where: { name: 'emergency_guidance_shown' } });
    expect(ev.length).toBeGreaterThan(0);
    expect(JSON.stringify(ev)).not.toMatch(/chest pain|breathe/i);
  });

  it('unknown phone: no booking, sign-up link; STOP opts out of WhatsApp messages', async () => {
    const r = await say('hello', '+201555555555');
    expect(r[0]).toContain('could not find an account');
    expect(await c.prisma.bookingIntent.count()).toBe(0);
    const s = await say('stop');
    expect(s[0]).toContain('turned off');
    expect((await c.prisma.notificationPreference.findUniqueOrThrow({ where: { sub_channel: { sub: 'sub_amira', channel: 'WHATSAPP' } } })).enabled).toBe(false);
  });

  it('SLOT_TAKEN at hold time shows Kiorly alternatives and keeps the conversation; deposit link sent when a deposit is required', async () => {
    await say('hi'); await say('1'); await say('1');
    c.kiorly.holdMode = '409';
    const r = await say('1');
    expect(r[0]).toContain('just taken');
    expect(await state()).toBe('CHOOSE_SLOT');
    c.kiorly.holdMode = undefined;
    await c.reset(); // fresh world with a deposit-required doctor
    c.kiorly.slots = [futureSlot(72)];
    await seedProvider(c, { specialty: 'dermatology', depositAmount: 100 });
    await c.http().put('/api/v1/me/profile').set(auth).send({ nameEn: 'Amira Samy', preferredLocale: 'en' });
    process.env.DEPOSIT_DEFAULT_MINOR = '10000';
    try {
      await say('hi'); await say('1'); await say('1'); await say('1');
      const r2 = await say('yes');
      expect(r2.some((b: string) => /deposit is required/.test(b) && b.includes('/pay/fake-checkout/'))).toBe(true);
    } finally { delete process.env.DEPOSIT_DEFAULT_MINOR; }
  });

  it('no slots offers the waitlist (YES joins); stale sessions free the hold and restart', async () => {
    c.kiorly.slots = [];
    await say('hi'); await say('1');
    const r = await say('1');
    expect(r[0]).toContain('waitlist'); expect(await state()).toBe('OFFER_WAITLIST');
    expect((await say('yes'))[0]).toContain('waitlist');
    expect(await c.prisma.waitlistEntry.count({ where: { sub: 'sub_amira', status: 'WAITING' } })).toBe(1);
    c.kiorly.slots = [futureSlot(72)];
    c.get(CatalogService).invalidateSlots();
    await say('hi'); await say('1'); await say('1'); await say('1');
    await c.prisma.channelConversation.updateMany({ data: { expiresAt: new Date(Date.now() - 60_000) } });
    const again = await say('yes'); // session expired: NOT treated as a confirmation
    expect(again[0]).toContain('Dermatology');
    expect((await c.prisma.bookingIntent.findFirstOrThrow({ where: { status: { not: 'CONFIRMED' } }, orderBy: { createdAt: 'desc' } })).status).toBe('EXPIRED');
  });

  it('flag kiorex.whatsapp_booking OFF (market) => replies with the app link only; signed inbound webhook enforces HMAC and the flag', async () => {
    await c.http().put('/api/v1/admin/flags/kiorex.whatsapp_booking/values').set(admin).send({ scope: 'GLOBAL', value: 'OFF', reason: 't', ticket: 'T-1' }).expect(200);
    const r = await say('hi');
    expect(r[0]).toContain('book in the Kiorex app');
    expect(await state()).toBe('IDLE');
    expect(await c.prisma.bookingIntent.count()).toBe(0);
    await c.http().post('/api/v1/channels/whatsapp/booking-intents').send({ from: PHONE, text: 'hi' }).expect(403).expect((x) => expect(x.body).toMatchObject({ code: 'FEATURE_DISABLED', key: 'kiorex.whatsapp_booking' }));
    await c.http().put('/api/v1/admin/flags/kiorex.whatsapp_booking/values').set(admin).send({ scope: 'GLOBAL', value: 'ON', reason: 't', ticket: 'T-1' }).expect(200);
    const body = JSON.stringify({ from: PHONE, text: 'hi' });
    await c.http().post('/api/v1/channels/whatsapp/booking-intents').set('content-type', 'application/json').send(body).expect(401);
    const sig = 'sha256=' + createHmac('sha256', 'wa_dev_webhook_secret_change_me').update(body).digest('hex');
    await c.http().post('/api/v1/channels/whatsapp/booking-intents').set('content-type', 'application/json').set('x-kiorex-signature', sig).send(body).expect(200);
    expect(await state()).toBe('CHOOSE_SPECIALTY');
  });
});
