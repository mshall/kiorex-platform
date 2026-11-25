import { createCtx, TestCtx } from './harness';
import { EngagementService } from '../src/engagement/engagement-public';
import { platformTemplate } from '../src/engagement/notification.layer';
import { TEMPLATES } from '../src/engagement/templates';
import { SuppressionService } from '../src/patient/patient-public';
import { activateConfig, unlockFlag } from './growth-helpers';
import { GROWTH_DEFAULT_PAYLOADS } from '../src/growth/growth-public';

const PHONE = '+201000000001'; // the phone in the default test token
const sub = 'sub_amira';

/** GRW-P1-I: consent records, preference centre, suppression, and the send gate for marketing (consent enforcement), against real Postgres. */
describe('consent and preference centre', () => {
  let c: TestCtx; let auth: { Authorization: string };
  beforeAll(async () => {
    c = await createCtx();
    // a marketing template exists only in tests: copy and licence are NEEDS_HUMAN, no shipped template is marketing
    (TEMPLATES as any).TEST_PROMO = { templateId: 'TODO_NEEDS_HUMAN_test_promo', reminder: false, marketing: true, en: 'A note from {doctor}', ar: 'رسالة من {doctor}' };
    (c.get(EngagementService) as any).notifier.registry.register(platformTemplate('TEST_PROMO' as any, (TEMPLATES as any).TEST_PROMO));
  });
  afterAll(async () => { delete (TEMPLATES as any).TEST_PROMO; await c.close(); });
  beforeEach(async () => {
    await c.reset(); c.flags.invalidate();
    auth = await c.as(sub);
    await c.http().put('/api/v1/me/profile').set(auth).send({ nameEn: 'Amira Samy', email: 'amira@example.com' }).expect(200);
    process.env.QUIET_HOURS_START = '0'; process.env.QUIET_HOURS_END = '0';
  });
  afterAll(() => { delete process.env.QUIET_HOURS_START; delete process.env.QUIET_HOURS_END; });
  const eng = () => c.get(EngagementService);
  const put = (purpose: string, granted: boolean, extra: object = {}) => c.http().put(`/api/v1/me/consents/${purpose}`).set(auth).send({ granted, ...extra });
  const prefs = (body: object) => c.http().put('/api/v1/me/preferences').set(auth).send(body);
  const noQuiet = () => prefs({ quietHours: { start: 0, end: 0 } }).expect(200);
  let k = 0;
  const promo = (channels = ['WHATSAPP']) => eng().notify(sub, { kind: 'TEST_PROMO' as any, params: { doctor: 'Dr X' }, dedupeKey: `promo${++k}`, channels });
  const status = async (channel: string, key = `promo${k}`) => (await c.prisma.message.findUniqueOrThrow({ where: { dedupeKey: `${key}:${channel}` } }));
  const allowMarketing = async () => { await unlockFlag(c, 'growth.marketing_messaging'); await put('MARKETING_WHATSAPP', true).expect(200); await noQuiet(); };

  describe('G-20 banner availability', () => {
    it('GET /growth/v1/consent/versions says available=false while growth.analytics_visitor is locked and true once a gate is recorded', async () => {
      expect((await c.http().get('/api/v1/growth/v1/consent/versions').expect(200)).body).toMatchObject({ available: false });
      await unlockFlag(c, 'growth.analytics_visitor');
      expect((await c.http().get('/api/v1/growth/v1/consent/versions').set('X-Kiorex-Market', 'EG').expect(200)).body).toMatchObject({ available: true });
    });
  });

  describe('consent records (audit trail)', () => {
    it('accepts the growth purposes; every record carries textVersion, source, at, ipHash and button evidence; channel only for marketing', async () => {
      await put('ANALYTICS_MEASUREMENT', true, { source: 'web', evidence: 'accept_all', textVersion: 'v7_ar_en' }).expect(200);
      await put('MARKETING_WHATSAPP', true, { source: 'app' }).expect(200);
      const rows = await c.prisma.consentRecord.findMany({ orderBy: { createdAt: 'asc' } });
      expect(rows[0]).toMatchObject({ sub, purpose: 'ANALYTICS_MEASUREMENT', granted: true, version: 'v7_ar_en', source: 'web', evidence: 'accept_all', channel: null });
      expect(rows[0]!.ipHash).toMatch(/^[A-Za-z0-9_-]{32}$/); expect(rows[0]!.createdAt).toBeInstanceOf(Date);
      expect(rows[1]).toMatchObject({ purpose: 'MARKETING_WHATSAPP', channel: 'WHATSAPP', version: 'TODO_NEEDS_HUMAN_v0', source: 'app' });
      expect(JSON.stringify(rows)).not.toMatch(/127\.0\.0\.1|::1/);
    });
    it('unknown purposes and sources are 400; the Rev 2.2 consent list is unchanged (five purposes)', async () => {
      expect((await put('NOPE', true).expect(400)).body.code).toBe('UNKNOWN_CONSENT_PURPOSE');
      await put('REMINDERS', true, { source: 'carrier-pigeon' }).expect(400);
      expect((await c.http().get('/api/v1/me/consents').set(auth).expect(200)).body.map((x: any) => x.purpose)).toEqual(['MARKETPLACE_PROCESSING', 'REMINDERS', 'RECORD_SHARING', 'AI_PROCESSING', 'VISIT_STATUS_SHARING']);
    });
    it('history is append-only: a withdrawal is a new row, the latest wins, and the database refuses UPDATE and DELETE', async () => {
      await put('MARKETING_EMAIL', true).expect(200); await put('MARKETING_EMAIL', false).expect(200); await put('MARKETING_EMAIL', true).expect(200);
      const rows = await c.prisma.consentRecord.findMany({ where: { purpose: 'MARKETING_EMAIL' }, orderBy: { createdAt: 'asc' } });
      expect(rows.map((r) => r.granted)).toEqual([true, false, true]);
      await expect(c.prisma.consentRecord.update({ where: { id: rows[0]!.id }, data: { granted: false } })).rejects.toThrow(/append-only/);
      await expect(c.prisma.consentRecord.delete({ where: { id: rows[0]!.id } })).rejects.toThrow(/append-only/);
      await expect(c.prisma.$executeRawUnsafe(`DELETE FROM "ConsentRecord"`)).rejects.toThrow(/append-only/);
      const hist = await c.http().get('/api/v1/me/consents/history').set(auth).expect(200);
      expect(hist.body.length).toBe(3);
    });
    it('every change enqueues a PatientConsentUpdated event in the same transaction: opaque subRef, no sub, phone or e-mail; it satisfies the contract fields and is consumed (never dead)', async () => {
      await put('MARKETING_SMS', true, { source: 'web', textVersion: 'v9' }).expect(200);
      const ev = await c.prisma.outboxEvent.findFirstOrThrow({ where: { type: 'PatientConsentUpdated' } });
      expect(ev).toMatchObject({ target: 'INTERNAL', aggregateType: 'PatientConsent' });
      expect(ev.payload).toMatchObject({ purpose: 'MARKETING_SMS', channel: 'SMS', granted: true, textVersion: 'v9', source: 'web', subRef: expect.any(String), at: expect.any(String) });
      expect(JSON.stringify(ev.payload) + ev.aggregateId).not.toMatch(/sub_amira|\+20|@/);
      const { OutboxService } = await import('../src/outbox/outbox-public');
      await c.get(OutboxService).processBatch();
      expect((await c.prisma.outboxEvent.findUniqueOrThrow({ where: { id: ev.id } })).status).toBe('SENT');
    });
    it('a legacy caller that passes its own source label (booking confirm) still works and is mapped for the event', async () => {
      const { PatientService } = await import('../src/patient/patient-public');
      await c.get(PatientService).setConsent(sub, 'MARKETPLACE_PROCESSING', true, 'booking');
      expect((await c.prisma.consentRecord.findFirstOrThrow({ where: { purpose: 'MARKETPLACE_PROCESSING' } })).source).toBe('booking');
      expect((await c.prisma.outboxEvent.findFirstOrThrow({ where: { type: 'PatientConsentUpdated' } })).payload).toMatchObject({ source: 'app' });
    });
  });

  describe('preference centre API', () => {
    it('GET shows required service messages, reminders, analytics, per-channel marketing (all OFF by default: nothing pre-ticked), quiet hours, caps and the draft-wording marker', async () => {
      const g = (await c.http().get('/api/v1/me/preferences').set(auth).expect(200)).body;
      expect(g.serviceMessages).toEqual([{ purpose: 'TRANSACTIONAL', required: true }, { purpose: 'SECURITY', required: true }, { purpose: 'CLINICAL', required: true }]);
      expect(g.reminders.consent).toBe(false); expect(g.analytics.consent).toBe(false);
      expect(g.marketing.channels.map((x: any) => [x.channel, x.marketingConsent])).toEqual([['WHATSAPP', false], ['SMS', false], ['EMAIL', false], ['PUSH', false]]);
      expect(g.marketing).toMatchObject({ available: false, anyConsent: false }); // launch-locked until counsel signs
      expect(g.caps).toEqual({ perDay: 1, perWeek: 3 }); expect(g.draftWording).toBe(true);
      expect(g.quietHours).toMatchObject({ defaultStart: 21, defaultEnd: 9, timezone: 'Africa/Cairo' });
    });
    it('PUT changes consents per channel, analytics, reminders, channel switches and quiet hours; unchanged values write no new audit row', async () => {
      const r = (await prefs({ analytics: true, reminders: true, marketing: { WHATSAPP: true, EMAIL: false }, channels: [{ channel: 'SMS', enabled: false }], quietHours: { start: 22, end: 7 }, source: 'web' }).expect(200)).body;
      expect(r.analytics.consent).toBe(true); expect(r.reminders.consent).toBe(true);
      expect(r.marketing.channels.find((x: any) => x.channel === 'WHATSAPP').marketingConsent).toBe(true);
      expect(r.marketing.channels.find((x: any) => x.channel === 'SMS').channelEnabled).toBe(false);
      expect(r.quietHours).toMatchObject({ start: 22, end: 7 });
      const before = await c.prisma.consentRecord.count();
      await prefs({ analytics: true, reminders: true, marketing: { WHATSAPP: true } }).expect(200);
      expect(await c.prisma.consentRecord.count()).toBe(before);
      await prefs({ quietHours: null }).expect(200);
      expect((await c.http().get('/api/v1/me/preferences').set(auth)).body.quietHours.start).toBeNull();
    });
    it('"unsubscribe from all marketing" withdraws every channel in one step and leaves reminders, analytics and service messages untouched', async () => {
      await prefs({ reminders: true, analytics: true, marketing: { WHATSAPP: true, SMS: true, EMAIL: true, PUSH: true } }).expect(200);
      const r = (await c.http().post('/api/v1/me/preferences/unsubscribe-marketing').set(auth).expect(200)).body;
      expect(r.marketing.channels.every((x: any) => x.marketingConsent === false)).toBe(true);
      expect(r.reminders.consent).toBe(true); expect(r.analytics.consent).toBe(true);
      expect((await c.prisma.consentRecord.findMany({ where: { purpose: { startsWith: 'MARKETING_' }, granted: false } })).length).toBe(4);
    });
    it('validation: unknown channel, quiet hours out of range, wrong types; requires sign-in', async () => {
      await prefs({ marketing: { FAX: true } }).expect(400);
      await prefs({ quietHours: { start: 24, end: 3 } }).expect(400);
      await prefs({ analytics: 'yes' }).expect(400);
      await prefs({ channels: [{ channel: 'FAX', enabled: true }] }).expect(400);
      await c.http().get('/api/v1/me/preferences').expect(401);
    });
    it('isolation: one patient can neither read nor change another\'s preferences', async () => {
      await prefs({ marketing: { WHATSAPP: true } }).expect(200);
      const other = await c.as('sub_other');
      await c.http().put('/api/v1/me/profile').set(other).send({ nameEn: 'Other Person' }).expect(200);
      expect((await c.http().get('/api/v1/me/preferences').set(other)).body.marketing.anyConsent).toBe(false);
    });
  });

  describe('marketing sends are blocked without consent (enforcement)', () => {
    it('no consent: WhatsApp AND the in-app inbox are skipped (SKIPPED_CONSENT); nothing reaches the dev outbox', async () => {
      await unlockFlag(c, 'growth.marketing_messaging'); await noQuiet();
      await promo(['WHATSAPP', 'SMS']);
      expect((await status('WHATSAPP')).status).toBe('SKIPPED_CONSENT');
      expect((await status('SMS')).status).toBe('SKIPPED_CONSENT');
      expect((await status('INAPP')).status).toBe('SKIPPED_CONSENT');
      expect((await status('WHATSAPP')).reason).toBe('MARKETING_WHATSAPP');
      expect(await c.prisma.messageLog.count({ where: { templateId: 'TODO_NEEDS_HUMAN_test_promo' } })).toBe(0);
    });
    it('consent but the counsel gate (growth.marketing_messaging) not satisfied: still blocked, on every channel', async () => {
      await put('MARKETING_WHATSAPP', true).expect(200); await noQuiet();
      await promo();
      expect((await status('WHATSAPP')).status).toBe('SKIPPED_CONSENT');
    });
    it('consent for ONE channel does not allow another: SMS consent does not open WhatsApp', async () => {
      await unlockFlag(c, 'growth.marketing_messaging'); await put('MARKETING_SMS', true).expect(200); await noQuiet();
      await promo(['WHATSAPP', 'SMS']);
      expect((await status('WHATSAPP')).status).toBe('SKIPPED_CONSENT');
      expect((await status('SMS')).status).toBe('SENT');
    });
    it('flag + channel consent + outside quiet hours: sent; in-app marketing rides the push consent', async () => {
      await allowMarketing();
      await promo(['WHATSAPP']);
      expect((await status('WHATSAPP')).status).toBe('SENT');
      expect((await status('INAPP')).status).toBe('SKIPPED_CONSENT'); // MARKETING_PUSH not granted
      await put('MARKETING_PUSH', true).expect(200);
      await promo(['WHATSAPP']);
      expect((await status('INAPP')).status).toBe('SKIPPED_FREQUENCY_CAP'); // the first promo already used today's cap of 1 (the second message of the same logical send is not counted against itself)
    });
    it('withdrawal is effective for the very next send (well inside the 60 s SLO)', async () => {
      await allowMarketing();
      await promo(); expect((await status('WHATSAPP')).status).toBe('SENT');
      await put('MARKETING_WHATSAPP', false).expect(200);
      await c.prisma.message.updateMany({ data: { sentAt: new Date(Date.now() - 2 * 86_400_000) } }); // keep the daily cap out of the way
      const t0 = Date.now(); await promo();
      expect((await status('WHATSAPP')).status).toBe('SKIPPED_CONSENT'); expect(Date.now() - t0).toBeLessThan(60_000);
    });
    it('suppression list blocks marketing even with consent (STOP, bounce, complaint); lifting needs a fresh action; the raw phone number is never stored', async () => {
      await allowMarketing();
      const sup = c.get(SuppressionService);
      await sup.add({ address: PHONE, channel: 'WHATSAPP', reason: 'STOP', source: 'test' });
      await promo(); expect((await status('WHATSAPP')).status).toBe('SKIPPED_OPTOUT');
      const rows = await c.prisma.communicationSuppression.findMany();
      expect(rows).toHaveLength(1); expect(JSON.stringify(rows)).not.toContain('1000000001');
      expect(await sup.isSuppressed(['+20 100 000 0001'], 'WHATSAPP')).toBe(true); // formatting differences still match
      expect(await sup.isSuppressed([PHONE], 'SMS')).toBe(false);
      await sup.lift(PHONE, 'WHATSAPP');
      await promo(); expect((await status('WHATSAPP')).status).toBe('SENT');
      await sup.add({ address: PHONE, channel: 'ALL', reason: 'COMPLAINT' }); // ALL covers every channel
      await c.prisma.message.updateMany({ data: { sentAt: new Date(Date.now() - 2 * 86_400_000) } });
      await promo(); expect((await status('WHATSAPP')).status).toBe('SKIPPED_OPTOUT');
    });
    it('suppression is per market: an AE suppression does not touch an EG patient', async () => {
      await allowMarketing();
      await c.get(SuppressionService).add({ address: PHONE, channel: 'WHATSAPP', market: 'AE' });
      await promo(); expect((await status('WHATSAPP')).status).toBe('SENT');
    });
    it('quiet hours: a marketing message inside the person\'s window is deferred to its end, not sent and not dropped', async () => {
      await unlockFlag(c, 'growth.marketing_messaging'); await put('MARKETING_WHATSAPP', true).expect(200);
      const h = (new Date().getUTCHours() + 2) % 24; // MARKET_TZ_OFFSET_HOURS / Cairo (UTC+2 in winter; DST shifts one hour)
      await prefs({ quietHours: { start: (h + 23) % 24, end: (h + 3) % 24 } }).expect(200);
      await promo();
      const m = await status('WHATSAPP');
      expect(m.status).toBe('SCHEDULED'); expect(m.reason).toBe('QUIET_HOURS_DEFERRED'); expect(m.scheduledFor.getTime()).toBeGreaterThan(Date.now());
    });
    it('default marketing quiet hours (21:00 to 09:00 Cairo) apply when the person set none', async () => {
      await unlockFlag(c, 'growth.marketing_messaging'); await put('MARKETING_WHATSAPP', true).expect(200);
      const cairoHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', hour12: false }).format(new Date()));
      const inside = cairoHour >= 21 || cairoHour < 9;
      await promo();
      expect((await status('WHATSAPP')).status).toBe(inside ? 'SCHEDULED' : 'SENT');
    });
    it('frequency caps (defaults 1 per day, 3 per week across channels): the second marketing message the same day is SKIPPED_FREQUENCY_CAP; a raised cap through maker-checker config lets it through; the weekly cap applies', async () => {
      await allowMarketing();
      await promo(); expect((await status('WHATSAPP')).status).toBe('SENT');
      await promo(); expect((await status('WHATSAPP')).status).toBe('SKIPPED_FREQUENCY_CAP'); expect((await status('WHATSAPP')).reason).toBe('FREQUENCY_CAP_DAY');
      await activateConfig(c, 'CONSENT_DEFAULTS', { ...(GROWTH_DEFAULT_PAYLOADS.CONSENT_DEFAULTS as object), maxMarketingPerDay: 5, maxMarketingPerWeek: 2 });
      await promo(); expect((await status('WHATSAPP')).status).toBe('SENT'); // day cap 5, one already sent today, week cap 2 not yet reached
      await promo(); expect((await status('WHATSAPP')).reason).toBe('FREQUENCY_CAP_WEEK');
    });
    it('service messages are NOT affected by marketing state: withdraw every marketing consent and suppress the phone, a booking confirmation and a reminder still go out', async () => {
      await put('MARKETPLACE_PROCESSING', true).expect(200); await put('REMINDERS', true).expect(200);
      await c.get(SuppressionService).add({ address: PHONE, channel: 'ALL', reason: 'COMPLAINT' });
      await c.http().post('/api/v1/me/preferences/unsubscribe-marketing').set(auth).expect(200);
      await eng().notify(sub, { kind: 'BOOKING_CONFIRMED', params: { doctor: 'Dr X', time: 'T' }, dedupeKey: 'svc1' });
      await eng().notify(sub, { kind: 'REMINDER_24H', params: { doctor: 'Dr X', time: 'T' }, dedupeKey: 'svc2' });
      const s = async (key: string, channel: string) => (await c.prisma.message.findUniqueOrThrow({ where: { dedupeKey: `${key}:${channel}` } })).status;
      expect(await s('svc1', 'WHATSAPP')).toBe('SENT'); expect(await s('svc1', 'PUSH')).toBe('SENT'); expect(await s('svc1', 'INAPP')).toBe('SENT'); expect(await s('svc2', 'WHATSAPP')).toBe('SENT');
    });
    it('a transactional template can never be sent under the marketing rules and a marketing template can never bypass them: a TRANSACTIONAL consent does not unlock marketing', async () => {
      await unlockFlag(c, 'growth.marketing_messaging'); await put('MARKETPLACE_PROCESSING', true).expect(200); await put('REMINDERS', true).expect(200); await noQuiet();
      await promo(); expect((await status('WHATSAPP')).status).toBe('SKIPPED_CONSENT');
    });
  });

  describe('WhatsApp STOP', () => {
    const say = (text: string, from = PHONE) => c.http().post('/api/v1/dev/messaging/inbound').send({ channel: 'WHATSAPP', from, text }).expect(200);
    it('STOP writes the suppression (hash only), turns the WhatsApp channel off and withdraws the WhatsApp marketing consent; STOP works even when WhatsApp booking is switched OFF', async () => {
      await put('MARKETING_WHATSAPP', true).expect(200);
      const admin = await c.as('adm1', { roles: ['super_admin', 'ops_admin'] });
      await c.http().put('/api/v1/admin/flags/kiorex.whatsapp_booking/values').set(admin).send({ reason: 't', ticket: 'T-1', emergency: true, scope: 'GLOBAL', value: 'OFF' }).expect(200);
      c.flags.invalidate();
      await say('STOP');
      expect(await c.prisma.communicationSuppression.count({ where: { channel: 'WHATSAPP', reason: 'STOP', source: 'whatsapp-inbound' } })).toBe(1);
      expect(JSON.stringify(await c.prisma.communicationSuppression.findMany())).not.toContain('1000000001');
      expect((await c.prisma.notificationPreference.findUniqueOrThrow({ where: { sub_channel: { sub, channel: 'WHATSAPP' } } })).enabled).toBe(false);
      expect((await c.prisma.consentRecord.findFirstOrThrow({ where: { purpose: 'MARKETING_WHATSAPP' }, orderBy: { createdAt: 'desc' } }))).toMatchObject({ granted: false, source: 'whatsapp', evidence: 'stop_keyword' });
      expect((await c.http().get('/api/v1/me/preferences').set(auth)).body.marketing.channels.find((x: any) => x.channel === 'WHATSAPP')).toMatchObject({ marketingConsent: false, suppressed: true, channelEnabled: false });
    });
    it('a fresh opt-in in the preference centre lifts the person\'s own STOP and re-enables the channel; a complaint or a bounce is never lifted by a consent', async () => {
      await say('stop');
      expect((await c.http().get('/api/v1/me/preferences').set(auth)).body.marketing.channels.find((x: any) => x.channel === 'WHATSAPP')).toMatchObject({ suppressed: true, channelEnabled: false });
      await prefs({ marketing: { WHATSAPP: true } }).expect(200);
      expect((await c.http().get('/api/v1/me/preferences').set(auth)).body.marketing.channels.find((x: any) => x.channel === 'WHATSAPP')).toMatchObject({ marketingConsent: true, suppressed: false, channelEnabled: true });
      await c.get(SuppressionService).add({ address: PHONE, channel: 'WHATSAPP', reason: 'COMPLAINT' });
      await prefs({ marketing: { WHATSAPP: false } }).expect(200); await prefs({ marketing: { WHATSAPP: true } }).expect(200);
      expect((await c.http().get('/api/v1/me/preferences').set(auth)).body.marketing.channels.find((x: any) => x.channel === 'WHATSAPP').suppressed).toBe(true);
    });
    it('STOP from an unknown number still suppresses it (no account needed); the Arabic stop words work', async () => {
      await say('stop', '+201555555555');
      expect(await c.get(SuppressionService).isSuppressed(['+201555555555'], 'WHATSAPP')).toBe(true);
      await say('ايقاف الرسائل', '+201666666666');
      expect(await c.get(SuppressionService).isSuppressed(['+201666666666'], 'WHATSAPP')).toBe(true);
    });
  });
});
