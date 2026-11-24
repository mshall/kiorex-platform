import { PHONE, buttonsOf, createCtx, say, setupAssistant, TestCtx } from './assistant-helpers';
import { AssistantModelFactory } from '../src/ai-gateway/ai-gateway-public';

const confirmBody = (r: string[]) => r.find((b) => /\[(?:Confirm|تأكيد)\]/.test(b)) ?? '';
const btn = (r: string[], which: 'Confirm' | 'Cancel' | 'تأكيد' | 'إلغاء' | 'خليه' | 'Keep booking') => buttonsOf(confirmBody(r))[which];
const toolNames = async (c: TestCtx) => (await c.prisma.assistantToolCall.findMany({ orderBy: { createdAt: 'asc' } })).map((t) => `${t.tool}:${t.resultKind}`);

describe('GRW-P2-D WhatsApp assistant (mock model, mock messaging, real database and booking service)', () => {
  let c: TestCtx; let factory: AssistantModelFactory;
  beforeAll(async () => { c = await createCtx(); factory = c.get(AssistantModelFactory); });
  afterAll(async () => { await c.close(); });
  afterEach(() => { factory.setOverride(null); for (const k of Object.keys(process.env)) if (k.startsWith('ASSISTANT_TEST_') || k === 'ASSISTANT_MOCK_COST_PER_1K_MINOR') delete process.env[k]; });

  const book = async (opts: { start?: string; pickSlot?: string } = {}) => {
    await say(c, opts.start ?? 'I want to book dermatology');
    await say(c, '1');
    const r = await say(c, opts.pickSlot ?? '1');
    return r;
  };

  describe('booking by buttons', () => {
    beforeEach(async () => { await setupAssistant(c); });

    it('English: search, hold, button-confirmed booking exactly once (source WhatsApp), first message discloses the assistant', async () => {
      const first = await say(c, 'hello');
      expect(first[0]).toContain('automated assistant'); expect(first[0]).toContain('agent');
      const r1 = await say(c, 'I want to book dermatology');
      expect(r1[0]).toContain('Dr Sara Hassan'); expect(r1[0]).not.toContain('automated assistant'); // disclosed once
      const r2 = await say(c, '1'); expect(r2[0]).toMatch(/1\. .*\d\d:\d\d/);
      const r3 = await say(c, '2');
      expect(r3[0]).toContain('Held for 5 minutes'); expect(r3[0]).toContain('300 EGP'); expect(r3[0]).toContain('TODO_NEEDS_HUMAN');
      const held = await c.prisma.bookingIntent.findFirstOrThrow({});
      expect(held).toMatchObject({ status: 'HELD', channel: 'WHATSAPP', sub: 'sub_amira' });
      expect(held.startsAt.toISOString()).toBe(c.kiorly.slots[1].startsAt);
      expect(c.kiorly.callsTo('POST', '/holds')).toHaveLength(1);
      // typing yes does NOT confirm: only the button does
      const typed = await say(c, 'yes'); expect(typed[0]).toContain('press the Confirm or Cancel button');
      expect((await c.prisma.bookingIntent.findFirstOrThrow({})).status).toBe('HELD');
      const done = await say(c, '', { button: btn(r3, 'Confirm') });
      expect(done.some((b) => b.startsWith('Booked: Dr Sara Hassan'))).toBe(true);
      const b = await c.prisma.bookingIntent.findUniqueOrThrow({ where: { id: held.id } });
      expect(b.status).toBe('CONFIRMED');
      const call = c.kiorly.callsTo('POST', '/bookings');
      expect(call).toHaveLength(1); expect(call[0].headers['idempotency-key']).toBe(held.id);
      expect(call[0].body).toMatchObject({ channel: 'MARKETPLACE', attribution: { source: 'kiorex_whatsapp' } }); // the existing KIORLY_ACCEPTS_WHATSAPP_CHANNEL behaviour is kept
      expect(await toolNames(c)).toEqual(expect.arrayContaining(['search_providers:OK', 'get_slots:OK', 'hold_slot:OK', 'prepare_confirmation:OK', 'confirm_booking:OK:BOOK']));
      // one outbound assistant message per inbound turn
      const out = await c.prisma.assistantTurn.count({ where: { direction: 'OUT' } }); const inn = await c.prisma.assistantTurn.count({ where: { direction: 'IN' } });
      expect(out).toBe(inn);
    });

    it('Egyptian Arabic: "عايز أحجز عند دكتور جلدية" with Arabic-Indic numerals and colloquial replies', async () => {
      await c.http().put('/api/v1/me/profile').set(await c.as('sub_amira')).send({ preferredLocale: 'ar' });
      const r1 = await say(c, 'عايز أحجز عند دكتور جلدية');
      expect(r1[0]).toContain('أنا مساعد آلي'); expect(r1[0]).toContain('اختار الدكتور'); expect(r1[0]).toContain('د. سارة حسن');
      const r2 = await say(c, '١'); expect(r2[0]).toContain('المواعيد المتاحة');
      const r3 = await say(c, '٢');
      expect(r3[0]).toContain('محجوز لك لمدة ٥ دقايق'); expect(r3[0]).toContain('اضغط تأكيد');
      const done = await say(c, '', { button: btn(r3, 'تأكيد') });
      expect(done.join(' ')).toContain('تم الحجز');
      expect((await c.prisma.bookingIntent.findFirstOrThrow({})).status).toBe('CONFIRMED');
    });

    it('Modern Standard Arabic: formal register in the replies', async () => {
      await c.http().put('/api/v1/me/profile').set(await c.as('sub_amira')).send({ preferredLocale: 'ar' });
      const r1 = await say(c, 'أريد حجز موعد مع طبيب الجلدية من فضلك');
      expect(r1[0]).toContain('يساعدك في الحجز'); expect(r1[0]).toContain('اختر الطبيب'); // MSA wording, not "اختار"
      await say(c, '1'); const r3 = await say(c, '1');
      expect(r3[0]).toContain('تم حجز الموعد مؤقتاً');
      const done = await say(c, '', { button: btn(r3, 'تأكيد') });
      expect(done.join(' ')).toContain('تم الحجز');
    });

    it('same-day search and a price filter reach the catalogue; a budget nobody meets says so', async () => {
      const r = await say(c, 'محتاج دكتور جلدية النهارده');
      expect(r.join(' ')).toMatch(/اختر|اختار|Pick|ملقيتش|لم أجد/);
      const lowBudget = await say(c, 'I need a dermatology doctor under 100 EGP');
      expect(lowBudget[0]).toMatch(/found no doctors/);
      const ok = await say(c, 'dermatology under 400 EGP cheapest');
      expect(ok[0]).toContain('Dr Sara Hassan');
    });

    it('a symptom is never mapped to a specialty by the model: the patient gets the fixed specialty choice, and may pick', async () => {
      const r = await say(c, 'I have a rash on my arm');
      expect(r[0]).toContain('I cannot assess symptoms'); expect(r[0]).toContain('1. Dermatology');
      const spec = await say(c, '1'); expect(spec[0]).toContain('Dr Sara Hassan'); // named by NUMBER from the list we showed
    });

    it('double Confirm press is idempotent: one Clinic booking, the second press says it was already done', async () => {
      const r = await book(); const confirm = btn(r, 'Confirm');
      const a = await say(c, '', { button: confirm }); expect(a.join(' ')).toContain('Booked');
      const b = await say(c, '', { button: confirm }); expect(b.join(' ')).toContain('already done');
      expect(c.kiorly.callsTo('POST', '/bookings')).toHaveLength(1);
      expect(await c.prisma.bookingIntent.count({})).toBe(1);
    });

    it('Cancel button releases the hold; nothing is booked', async () => {
      const r = await book(); const out = await say(c, '', { button: btn(r, 'Cancel') });
      expect(out[0]).toContain('released the held time');
      expect((await c.prisma.bookingIntent.findFirstOrThrow({})).status).toBe('EXPIRED');
    });

    it('a confirm payload without a valid nonce, a typed payload and a payload for another subject are all refused', async () => {
      const r = await book(); const real = btn(r, 'Confirm'); const [, hold] = real.split(':');
      const bad = await say(c, '', { button: `CONFIRM:${hold}:AAAAAAAAAAAAAAAAAAAAAAAA` }); expect(bad[0]).toContain('not valid or has expired');
      const typed = await say(c, real); expect(typed[0]).not.toContain('Booked'); // the same words typed as TEXT are not a button press
      expect((await c.prisma.bookingIntent.findFirstOrThrow({})).status).toBe('HELD');
      // another verified patient with the consent presses the first patient's button
      const other = await c.as('sub_omar'); await c.http().put('/api/v1/me/profile').set(other).send({ nameEn: 'Omar Z', preferredLocale: 'en' }).expect(200);
      await c.prisma.patientProfile.updateMany({ where: { sub: 'sub_omar' }, data: { phone: '+201000000002' } });
      await c.http().put('/api/v1/me/consents/AI_PROCESSING').set(other).send({ granted: true }).expect(200);
      const foreign = await say(c, '', { from: '+201000000002', button: real }); expect(foreign[0]).toContain('not valid or has expired');
      expect((await c.prisma.bookingIntent.findFirstOrThrow({})).status).toBe('HELD');
      expect(c.kiorly.callsTo('POST', '/bookings')).toHaveLength(0);
      const ok = await say(c, '', { button: real }); expect(ok.join(' ')).toContain('Booked'); // the owner still can
    });

    it('hold expiry mid-conversation: pressing Confirm after the hold lapsed asks for a new time and keeps the list', async () => {
      const r = await book(); const confirm = btn(r, 'Confirm');
      await c.prisma.bookingIntent.updateMany({ where: { status: 'HELD' }, data: { holdExpiresAt: new Date(Date.now() - 60_000) } });
      c.kiorly.holds.clear?.();
      const out = await say(c, '', { button: confirm });
      expect(out.join(' ')).toMatch(/expired|taken/); expect(out.join(' ')).toContain('Pick');
      expect(c.kiorly.callsTo('POST', '/bookings')).toHaveLength(0);
    });
  });

  describe('manage bookings', () => {
    beforeEach(async () => { await setupAssistant(c); const r = await book(); await say(c, '', { button: btn(r, 'Confirm') }); expect((await c.prisma.bookingIntent.findFirstOrThrow({})).status).toBe('CONFIRMED'); });

    it('cancel: shows the booking, the refund consequence and needs its own Confirm button', async () => {
      const r = await say(c, 'cancel my booking');
      expect(r.join(' ')).toContain('Cancel your visit with'); expect(r.join(' ')).toContain('No deposit was paid');
      expect((await c.prisma.bookingIntent.findFirstOrThrow({})).status).toBe('CONFIRMED');
      const keep = await say(c, '', { button: btn(r, 'Keep booking') }); expect(keep[0]).toContain('Okay');
      expect((await c.prisma.bookingIntent.findFirstOrThrow({})).status).toBe('CONFIRMED');
      const again = await say(c, 'cancel my booking');
      const done = await say(c, '', { button: btn(again, 'Confirm') }); expect(done.join(' ')).toContain('cancelled');
      expect((await c.prisma.bookingIntent.findFirstOrThrow({})).status).toBe('CANCELLED');
    });

    it('reschedule: list, pick the booking, pick a new time, confirm with a button', async () => {
      const old = (await c.prisma.bookingIntent.findFirstOrThrow({})).startsAt.toISOString();
      const l = await say(c, 'I want to reschedule'); expect(l.join(' ')).toMatch(/Move|move|reschedul|Available times/);
      const slots = await c.prisma.assistantSession.findFirstOrThrow({}); expect(slots.state).toBe('RESCHEDULE_FLOW');
      const s = await say(c, '3'); expect(s.join(' ')).toContain('Move your visit');
      const done = await say(c, '', { button: btn(s, 'Confirm') }); expect(done.join(' ')).toContain('Moved');
      const nu = (await c.prisma.bookingIntent.findFirstOrThrow({})).startsAt.toISOString();
      expect(nu).not.toBe(old); expect(nu).toBe(c.kiorly.slots[2].startsAt);
    });

    it('"my bookings" lists only the patient\'s own upcoming bookings', async () => {
      const r = await say(c, 'my bookings'); expect(r[0]).toContain('Your upcoming bookings'); expect(r[0]).toContain('Dr Sara Hassan');
    });
  });

  describe('no free time: waitlist and the earliest slot', () => {
    beforeEach(async () => { await setupAssistant(c); });
    it('a provider with no free time offers the waitlist and joining needs the offer first', async () => {
      c.kiorly.slots = [];
      await say(c, 'I want to book dermatology'); const none = await say(c, '1');
      expect(none[0]).toContain('No times are free'); expect(none[0]).toContain('waitlist');
      const j = await say(c, 'waitlist please'); expect(j[0]).toContain('on the waitlist');
      expect(await c.prisma.waitlistEntry.count({ where: { sub: 'sub_amira', status: 'WAITING' } })).toBe(1);
    });
    it('"earliest" after a provider list shows only the first free time', async () => {
      await say(c, 'I want to book dermatology'); const r = await say(c, 'earliest available');
      expect(r[0]).toContain('Available times'); expect((r[0].match(/^\d\. /gm) ?? []).length).toBe(1);
    });
    it('a patient who never saw a list cannot join a waitlist by name', async () => {
      const r = await say(c, 'put me on the waitlist'); expect(r[0]).not.toContain('on the waitlist'); expect(await c.prisma.waitlistEntry.count()).toBe(0);
    });
  });

  describe('hand-off, consent, identity, flags', () => {
    it('"agent" opens an escalation with SLA and a redacted transcript, the assistant stays silent, closing resumes it', async () => {
      await setupAssistant(c);
      await say(c, 'hello'); const h = await say(c, 'I want to talk to an agent');
      expect(h[0]).toContain('passed your request'); expect(h[0]).toContain('30 minutes');
      const e = await c.prisma.assistantEscalation.findFirstOrThrow({}); expect(e.status).toBe('OPEN'); expect(e.slaDueAt.getTime()).toBeGreaterThan(Date.now());
      expect(JSON.stringify(e.transcript)).not.toMatch(/\+20|@/);
      expect(await say(c, 'hello?')).toEqual([]); // silent
      const admin = await c.as('adm1', { roles: ['support', 'ops_admin'] });
      await c.http().post(`/api/v1/admin/growth/assistant/escalations/${e.id}/ack`).set(admin).expect(200);
      await c.http().post(`/api/v1/admin/growth/assistant/escalations/${e.id}/close`).set(admin).expect(200);
      expect((await say(c, 'I want to book dermatology'))[0]).toContain('Dr Sara Hassan');
    });

    it('two failed understandings in a row escalate; Arabic trigger words escalate too', async () => {
      await setupAssistant(c);
      const a = await say(c, 'blah blah'); expect(a[0]).toContain('did not catch');
      const b = await say(c, 'what is the weather'); expect(b.join(' ')).toContain('passed your request');
      await c.prisma.assistantEscalation.deleteMany({}); await c.prisma.assistantSession.deleteMany({});
      const ar = await say(c, 'عايز اكلم حد'); expect(ar.join(' ')).toContain('حوّلت طلبك');
    });

    it('without the AI_PROCESSING consent the deterministic machine answers and no assistant turn runs', async () => {
      await setupAssistant(c, { consent: false });
      const r = await say(c, 'hi'); expect(r[0]).toContain('Pick a specialty by number'); expect(await c.prisma.assistantTurn.count()).toBe(0);
    });

    it('flag OFF (launch-locked, no gate evidence): the deterministic machine answers exactly as before', async () => {
      await setupAssistant(c); await c.prisma.flagGateEvidence.deleteMany({ where: { flagKey: 'kiorex.whatsapp_ai_assistant' } }); c.flags.invalidate();
      const r = await say(c, 'hi'); expect(r[0]).toContain('Pick a specialty by number'); expect(await c.prisma.assistantSession.count()).toBe(0);
      expect((await c.http().post('/api/v1/growth/v1/assistant/link').send({ token: 'x'.repeat(30) })).status).toBe(403);
    });

    it('an unverified number gets search and a one-time verification link, never a booking in chat', async () => {
      await setupAssistant(c, { profile: false });
      const r1 = await say(c, 'I want to book dermatology', { from: '+201099999999' }); expect(r1[0]).toContain('Dr Sara Hassan');
      const r2 = await say(c, '1', { from: '+201099999999' }); expect(r2[0]).toContain('Available times');
      const r3 = await say(c, '1', { from: '+201099999999' });
      expect(r3[0]).toMatch(/verify your number first. Open this one-time link \(valid 15 minutes\): https?:\/\/\S+assistant\?al=kxa1\./);
      expect(await c.prisma.bookingIntent.count()).toBe(0);
      const token = /al=(kxa1\.\S+)/.exec(r3[0])![1];
      const v = await c.http().post('/api/v1/growth/v1/assistant/link').send({ token }).expect(200);
      expect(v.body.continuePath).toContain('/signin?next='); expect(JSON.stringify(v.body)).not.toMatch(/\+20|sub_/);
      expect((await c.http().post('/api/v1/growth/v1/assistant/link').send({ token })).body.code).toBe('ASSISTANT_LINK_USED');
      expect((await c.http().post('/api/v1/growth/v1/assistant/link').send({ token: 'kxa1.zzz.' + 'a'.repeat(30) + '.bad' })).body.code).toBe('ASSISTANT_LINK_INVALID');
      const tools = await toolNames(c); expect(tools.some((t) => t.startsWith('hold_slot'))).toBe(false);
    });

    it('the link TTL is 15 minutes: an expired token is 410', async () => {
      await setupAssistant(c, { profile: false });
      await say(c, 'I want to book dermatology', { from: '+201099999999' }); await say(c, '1', { from: '+201099999999' }); const r3 = await say(c, '1', { from: '+201099999999' });
      const token = /al=(kxa1\.\S+)/.exec(r3[0])![1];
      await c.prisma.assistantLink.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      const exp = parseInt(token.split('.')[1], 36) * 1000; expect(exp - Date.now()).toBeLessThanOrEqual(15 * 60_000 + 2000);
    });

    it('emergency language short-circuits before any model call, frees the hold and is never a flag', async () => {
      await setupAssistant(c); const r = await book(); expect(btn(r, 'Confirm')).toBeTruthy();
      const before = await c.prisma.auditLog.count({ where: { action: 'assistant.model_step' } });
      const em = await say(c, 'I have chest pain'); expect(em[0]).toContain('123'); expect(em[0]).toContain('NEEDS_HUMAN_APPROVAL');
      expect(await c.prisma.auditLog.count({ where: { action: 'assistant.model_step' } })).toBe(before);
      expect((await c.prisma.bookingIntent.findFirstOrThrow({})).status).toBe('EXPIRED');
      expect(await c.prisma.assistantEscalation.count()).toBe(0); // emergencies never go to the queue
    });

    it('media and over-long messages get fixed text and never reach the model', async () => {
      await setupAssistant(c); const before = await c.prisma.auditLog.count({ where: { action: 'assistant.model_step' } });
      expect((await say(c, undefined))[0]).toContain('only read text messages');
      const { MessagingHub } = await import('../src/messaging/messaging-public'); // the dev endpoint caps at 1000 itself; a provider webhook does not
      const row = await c.get(MessagingHub).receive({ channel: 'WHATSAPP', from: PHONE, text: 'a'.repeat(1001) });
      const out = await c.get(MessagingHub).list({ channel: 'WHATSAPP', direction: 'OUT', to: PHONE, since: row.createdAt });
      expect(out[0].body).toContain('too long');
      expect(await c.prisma.auditLog.count({ where: { action: 'assistant.model_step' } })).toBe(before);
    });
  });

  describe('model failures fall back to the deterministic machine without losing state', () => {
    const failing = (fn: () => Promise<any>) => ({ name: 'broken', mode: 'real' as const, step: fn });
    it.each([
      ['throws', () => Promise.reject(new Error('boom'))],
      ['times out', () => new Promise(() => undefined)],
      ['returns invalid JSON twice', () => Promise.resolve({ kind: 'tool', tool: 'drop_tables', args: {} })],
    ])('model %s', async (name, fn) => {
      await setupAssistant(c); await say(c, 'hello'); // session exists
      factory.setOverride(failing(fn as never));
      const first = await say(c, 'I want to book dermatology');
      const machine = /Pick a (specialty|doctor) by number/;
      if (name === 'returns invalid JSON twice') { expect(first[0]).toContain('did not catch'); const second = await say(c, 'book dermatology please'); expect(second[0]).toMatch(machine); }
      else expect(first[0]).toMatch(machine);
      expect(await c.prisma.assistantSession.count()).toBe(1);
    }, 60_000);

    it('a hold made before the model failed is kept; once the model is back the patient can still confirm', async () => {
      await setupAssistant(c); const r = await book(); const confirm = btn(r, 'Confirm');
      factory.setOverride(failing(() => Promise.reject(new Error('down')) as never)); expect((await say(c, 'thanks'))[0]).toContain('Pick a specialty');
      factory.setOverride(null);
      expect((await c.prisma.bookingIntent.findFirstOrThrow({})).status).toBe('HELD');
      expect((await say(c, '', { button: confirm })).join(' ')).toContain('Booked');
    });
  });

  describe('budgets, breaker and rate', () => {
    it('the per-conversation turn cap sends the patient to the deterministic machine', async () => {
      await setupAssistant(c); process.env.ASSISTANT_TEST_TURNS_PER_CONVERSATION = '2';
      await say(c, 'hello'); await say(c, 'I want to book dermatology');
      expect((await say(c, 'hello again'))[0]).toContain('Pick a specialty by number');
    });
    it('the per-conversation token cap does too', async () => {
      await setupAssistant(c); await say(c, 'hello');
      await c.prisma.assistantSession.updateMany({ data: { tokenBudgetUsed: 5000 } }); process.env.ASSISTANT_TEST_TOKENS_PER_CONVERSATION = '4000';
      expect((await say(c, 'hello again'))[0]).toContain('Pick a specialty by number');
    });
    it('and so does the per-subject daily token cap', async () => {
      await setupAssistant(c); await say(c, 'hello');
      await c.prisma.assistantTurn.updateMany({ data: { tokensIn: 100 } }); process.env.ASSISTANT_TEST_TOKENS_PER_SUBJECT_DAY = '50';
      expect((await say(c, 'hello again'))[0]).toContain('Pick a specialty by number');
    });

    it('the per-market daily cost breaker trips at 100 percent, the router returns the deterministic path, a super admin reset lets the assistant answer again', async () => {
      const { admin } = await setupAssistant(c);
      process.env.ASSISTANT_MOCK_COST_PER_1K_MINOR = '100000'; process.env.ASSISTANT_TEST_COST_PER_MARKET_DAY_MINOR = '5';
      const r = await say(c, 'hello'); expect(r[0]).toContain('automated assistant');
      const day = await c.prisma.assistantUsageDaily.findFirstOrThrow({}); expect(day.breakerTripped).toBe(true);
      expect(await c.prisma.auditLog.count({ where: { action: 'assistant.budget_breaker_tripped' } })).toBe(1);
      expect((await say(c, 'hello'))[0]).toContain('Pick a specialty by number');
      await c.http().post('/api/v1/admin/growth/assistant/budgets/reset-breaker').set(await c.as('adm_x', { roles: ['ops_admin'] })).expect(403);
      await c.http().post('/api/v1/admin/growth/assistant/budgets/reset-breaker').set(admin).expect(200);
      expect((await say(c, 'I want to book dermatology'))[0]).toContain('Dr Sara Hassan');
    });

    it('30 messages an hour per number: the next one gets one polite notice and then silence', async () => {
      await setupAssistant(c); process.env.ASSISTANT_TEST_MESSAGES_PER_HOUR = '3';
      await say(c, 'hello'); await say(c, 'I want to book dermatology'); await say(c, '1');
      const over = await say(c, '1'); expect(over[0]).toContain('very fast');
      expect(await say(c, 'hello')).toEqual([]);
    });
  });

  describe('privacy and erasure', () => {
    it('seeded PHI in the patient text is redacted in storage; outbound bodies, audit rows and the session hold no raw text', async () => {
      await setupAssistant(c);
      const phi = 'my name is Omar Hassan call me on 01001234567 or omar.h@example.com id 29801011234567 I want to book dermatology';
      await say(c, phi);
      await say(c, 'I have diabetes and chest tightness please book cardiology');
      const turns = await c.prisma.assistantTurn.findMany({}); const text = JSON.stringify(turns);
      for (const s of ['Omar Hassan', '01001234567', 'omar.h@example.com', '29801011234567', 'diabetes']) expect(text).not.toContain(s);
      expect(turns.filter((t) => t.direction === 'OUT').every((t) => t.redactedText === '')).toBe(true);
      expect(text).toContain('[HEALTH_TEXT]');
      const audit = JSON.stringify(await c.prisma.auditLog.findMany({ where: { action: { startsWith: 'assistant.' } } }));
      for (const s of ['Omar', '0100', 'example.com', 'diabetes', PHONE]) expect(audit).not.toContain(s);
      const sess = JSON.stringify(await c.prisma.assistantSession.findMany({}));
      expect(sess).not.toContain(PHONE); expect(sess).not.toContain('Omar');
    });

    it('subject erasure removes the sessions, turns, tool calls, confirmations and escalations of that subject', async () => {
      await setupAssistant(c); const r = await book(); expect(btn(r, 'Confirm')).toBeTruthy(); await say(c, 'agent');
      expect(await c.prisma.assistantSession.count()).toBe(1);
      const { GrowthMaintenanceService } = await import('../src/growth/growth-public');
      await c.get(GrowthMaintenanceService).eraseSubject('sub_amira');
      for (const t of ['assistantSession', 'assistantTurn', 'assistantToolCall', 'assistantConfirmation', 'assistantEscalation'] as const) expect(await (c.prisma as any)[t].count()).toBe(0);
    });

    it('retention: a session past its 24 h window releases its hold and revokes its buttons', async () => {
      await setupAssistant(c); const r = await book(); const confirm = btn(r, 'Confirm');
      await c.prisma.assistantSession.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      const { AssistantRetentionJob } = await import('../src/ai-gateway/ai-gateway-public');
      const res = await c.get(AssistantRetentionJob).runOnce(); expect(res.sessionsClosed).toBe(1);
      expect((await c.prisma.bookingIntent.findFirstOrThrow({})).status).toBe('EXPIRED');
      expect((await say(c, '', { button: confirm }))[0]).toContain('not valid or has expired');
    });
  });

  describe('no outbound network from the assistant', () => {
    it('a full booking, cancel and hand-off run makes no fetch outside the loopback Clinic fake', async () => {
      await setupAssistant(c);
      const hosts: string[] = []; const orig = globalThis.fetch;
      globalThis.fetch = ((u: any, init?: any) => { hosts.push(new URL(typeof u === 'string' ? u : u.url ?? String(u)).hostname); return orig(u, init); }) as typeof fetch;
      try { const r = await book(); await say(c, '', { button: btn(r, 'Confirm') }); await say(c, 'cancel my booking'); await say(c, 'agent'); }
      finally { globalThis.fetch = orig; }
      expect(hosts.length).toBeGreaterThan(0); expect(hosts.every((h) => ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(h))).toBe(true);
    });
  });

  describe('ops API', () => {
    it('status, conversations, transcript (redacted, audited), budgets and metrics (masked below 10)', async () => {
      const { admin } = await setupAssistant(c); await say(c, 'hello'); await say(c, 'agent');
      const st = (await c.http().get('/api/v1/admin/growth/assistant/status').set(admin).expect(200)).body;
      expect(st).toMatchObject({ mode: 'mock', flags: { assistant: { effective: true }, realModel: { effective: false } }, realModelConfigured: false, escalations: { open: 1 } });
      const list = (await c.http().get('/api/v1/admin/growth/assistant/conversations').set(admin).expect(200)).body; expect(list).toHaveLength(1); expect(JSON.stringify(list)).not.toMatch(/\+20|sub_amira|phoneHash/);
      const tr = (await c.http().get(`/api/v1/admin/growth/assistant/conversations/${list[0].id}`).set(admin).expect(200)).body; expect(tr.turns.length).toBeGreaterThan(1);
      expect(await c.prisma.auditLog.count({ where: { action: 'assistant.transcript_viewed' } })).toBe(1);
      await c.http().get(`/api/v1/admin/growth/assistant/conversations/${list[0].id}`).set(await c.as('fin', { roles: ['finance', 'ops_admin'] })).expect(403); // transcripts: support and super admin only
      const m = (await c.http().get('/api/v1/admin/growth/assistant/metrics').set(admin).expect(200)).body; expect(m.masked).toBe(true); expect(m.sessions).toBeNull();
      const bu = (await c.http().get('/api/v1/admin/growth/assistant/budgets').set(admin).expect(200)).body; expect(bu.budgets.tokensPerConversation).toBe(8000);
      await c.http().get('/api/v1/admin/growth/assistant/status').expect(401);
    });
  });
});
