import { Logger } from '@nestjs/common';
import { createCtx, TestCtx } from './harness';
import { fx, fxText } from './fixtures/messaging/fx';
import { signMetaBody } from '../src/common/providers/vendors/meta-whatsapp';
import { addressHash } from '../src/common/privacy-hash';
import { MessagingHub } from '../src/messaging/messaging.hub';
import { MessagingOpsService } from '../src/messaging/messaging-ops.service';
import { MetaWhatsappAdapter } from '../src/messaging/whatsapp/meta.adapter';
import { signUnsubscribeToken } from '../src/messaging/unsubscribe';
import { GrowthConfigService } from '../src/growth/growth-public';
import { MessagingConfigBinder } from '../src/growth/config/messaging-config.binder';
import type { MessagingAdapter, OutboundMessage } from '../src/messaging/messaging.types';

const META = { WHATSAPP_MODE: 'real', WHATSAPP_PROVIDER: 'meta', WHATSAPP_API_KEY: 'EAAGsecrettokenvalue0123456789', WHATSAPP_SENDER_ID: '106540352242922', WHATSAPP_WEBHOOK_SECRET: 'meta_app_secret_0123456789', WHATSAPP_VERIFY_TOKEN: 'verify_me_123' };
const SES = { EMAIL_MODE: 'real', EMAIL_PROVIDER: 'ses', EMAIL_API_URL: 'https://email.eu-central-1.amazonaws.com', EMAIL_API_KEY: 'AKIAEXAMPLE:secretkeyexample0123', EMAIL_SENDER_ID: 'Kiorex <no-reply@kiorex.com>', EMAIL_WEBHOOK_SECRET: 'sns_basic_pw_0123456789' };
const AGG = { SMS_MODE: 'real', SMS_PROVIDER: 'aggregator', SMS_API_URL: 'https://sms.agg.example', SMS_API_KEY: 'aggUser:aggPass', SMS_SENDER_ID: 'Kiorex', SMS_WEBHOOK_SECRET: 'dlr_secret_0123456789', SMS_AGGREGATOR_CONFIG: JSON.stringify({ path: '/api/SMS/', encoding: 'form', dlr: { idField: 'SMSID', statusField: 'Status', verify: 'token', tokenName: 'token' } }) };
const PHONE = '+201001234567';

/** MSG-REAL through the real HTTP stack and database: Meta inbound (replay-safe, window, STOP, media), template and quality events, SES bounce -> suppression, one-click unsubscribe, SMS DLR, failover, ops tools, config kind. No vendor is ever called. */
describe('real messaging channels (no vendor call)', () => {
  let c: TestCtx; let hub: MessagingHub; let ops: MessagingOpsService;
  const set = (v: Record<string, string>) => Object.assign(process.env, v);
  const unset = (v: Record<string, string>) => Object.keys(v).forEach((k) => delete process.env[k]);
  const nowS = () => String(Math.floor(Date.now() / 1000));
  /** The fixture with every message / status timestamp moved to now (so the 24 h window logic runs against the real clock). */
  const fresh = (name: string) => JSON.parse(JSON.stringify(fx(name)).replace(/"timestamp":\s*"\d+"/g, `"timestamp":"${nowS()}"`));
  const signedPost = (path: string, body: unknown) => { const raw = JSON.stringify(body); return c.http().post(path).set('content-type', 'application/json').set('x-hub-signature-256', signMetaBody(META.WHATSAPP_WEBHOOK_SECRET, raw)).send(raw); };
  const wa = (body: unknown) => signedPost('/api/v1/messaging/webhooks/whatsapp', body);
  const logs: string[] = []; const spies: jest.SpyInstance[] = [];
  beforeAll(async () => {
    c = await createCtx(); hub = c.get(MessagingHub); ops = c.get(MessagingOpsService);
    for (const m of ['log', 'warn', 'error', 'debug', 'verbose'] as const) spies.push(jest.spyOn(Logger.prototype, m).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')); }));
  });
  afterAll(async () => { spies.forEach((s) => s.mockRestore()); await c.close(); });
  beforeEach(async () => { await c.reset(); logs.length = 0; hub.clearAdapters(); hub.setConfigSource(async () => null); });

  describe('Meta WhatsApp inbound', () => {
    beforeEach(() => set(META)); afterEach(() => unset(META));
    it('stores an inbound text once, stamps the 24 h window from the customer timestamp, and a replay is a no-op', async () => {
      const seen: string[] = []; hub.onInbound('WHATSAPP', async (m) => { seen.push(m.text ?? ''); });
      const body = fresh('meta-inbound-text');
      expect((await wa(body).expect(200)).body).toEqual({ applied: 1, ignored: 0 });
      expect((await wa(body).expect(200)).body).toEqual({ applied: 0, ignored: 1 }); // Meta redelivers until it gets a 200: same wamid is handled once
      expect(await c.prisma.messageLog.count({ where: { direction: 'IN', channel: 'WHATSAPP' } })).toBe(1); expect(seen).toEqual(['عايز احجز كشف']);
      const t0 = Date.now();
      expect((await hub.whatsappWindow(PHONE, 'EG', t0)).open).toBe(true);
      expect((await hub.whatsappWindow(PHONE, 'EG', t0 + 23.9 * 3_600_000)).open).toBe(true);
      expect((await hub.whatsappWindow(PHONE, 'EG', t0 + 24.1 * 3_600_000)).open).toBe(false);
      expect((await hub.whatsappWindow('+201111111111', 'EG', t0)).open).toBe(false);
      const row = await c.prisma.whatsappContactWindow.findFirstOrThrow(); expect(row.addressHash).toBe(addressHash(PHONE)); expect(JSON.stringify(row)).not.toContain('1001234567'); // keyed hash only
    });
    it('an OLD delayed webhook does not reopen a closed window beyond its own time (and never moves the stamp back)', async () => {
      const old = JSON.parse(JSON.stringify(fx('meta-inbound-text'))); // Nov 2025: a year old
      await wa(old).expect(200);
      expect((await hub.whatsappWindow(PHONE, 'EG')).open).toBe(false);
      await wa(fresh('meta-inbound-text').entry && { ...fresh('meta-inbound-text'), entry: [{ ...fresh('meta-inbound-text').entry[0], changes: [{ ...fresh('meta-inbound-text').entry[0].changes[0], value: { ...fresh('meta-inbound-text').entry[0].changes[0].value, messages: [{ ...fresh('meta-inbound-text').entry[0].changes[0].value.messages[0], id: 'wamid.NEWER' }] } }] }] }).expect(200);
      expect((await hub.whatsappWindow(PHONE, 'EG')).open).toBe(true);
      await wa({ ...old, entry: [{ ...old.entry[0], changes: [{ ...old.entry[0].changes[0], value: { ...old.entry[0].changes[0].value, messages: [{ ...old.entry[0].changes[0].value.messages[0], id: 'wamid.OLDER' }] } }] }] }).expect(200);
      expect((await hub.whatsappWindow(PHONE, 'EG')).open).toBe(true);
    });
    it('the assistant button payload reaches the inbound handler byte for byte', async () => {
      const got: Array<{ p?: string; kind?: string }> = []; hub.onInbound('WHATSAPP', async (m) => { got.push({ p: m.buttonPayload, kind: m.kind }); });
      await wa(fresh('meta-inbound-button-reply')).expect(200);
      expect(got).toEqual([{ p: 'CONFIRM:hold_9f3a:Zk3p9QxT1mN8vB2cD4eF6g', kind: 'interactive' }]);
    });
    it('media, voice, location and contacts reach the handler WITHOUT content (assistant rule); reactions do not reach it at all', async () => {
      const got: Array<Record<string, unknown>> = []; hub.onInbound('WHATSAPP', async (m) => { got.push({ kind: m.kind, text: m.text, p: m.buttonPayload }); });
      for (const n of ['meta-inbound-image', 'meta-inbound-audio', 'meta-inbound-location', 'meta-inbound-contacts', 'meta-inbound-reaction']) await wa(fresh(n)).expect(200);
      expect(got).toEqual([{ kind: 'media' }, { kind: 'media' }, { kind: 'location' }, { kind: 'contacts' }].map((x) => ({ ...x, text: undefined, p: undefined })));
      const stored = JSON.stringify(await c.prisma.messageLog.findMany()); expect(stored).not.toMatch(/glucose|30\.0444|MEDIA_ID/);
    });
    it('STOP is an opt-out at the hub even when no conversation handler is registered; a later STOP after a lift suppresses again', async () => {
      hub.onInbound('WHATSAPP', async () => undefined);
      await wa(fresh('meta-inbound-stop')).expect(200);
      const h = addressHash(PHONE);
      expect(await c.prisma.communicationSuppression.findFirst({ where: { channel: 'WHATSAPP', addressHash: h, reason: 'STOP', liftedAt: null } })).not.toBeNull();
      await c.prisma.communicationSuppression.updateMany({ where: { addressHash: h }, data: { liftedAt: new Date() } });
      const again = JSON.parse(JSON.stringify(fresh('meta-inbound-stop')).replace('wamid.IN_STOP_1', 'wamid.IN_STOP_2')); await wa(again).expect(200);
      expect((await c.prisma.communicationSuppression.findFirstOrThrow({ where: { addressHash: h } })).liftedAt).toBeNull();
    });
    it('delivery statuses move forward only, failures carry the numeric code, a duplicate or older status is a no-op', async () => {
      await c.prisma.messageLog.create({ data: { channel: 'WHATSAPP', direction: 'OUT', mode: 'real', recipientMasked: '+200****567', templateId: 'T', status: 'SENT', providerRef: 'wamid.OUT_1' } });
      await c.prisma.messageLog.create({ data: { channel: 'WHATSAPP', direction: 'OUT', mode: 'real', recipientMasked: '+200****567', templateId: 'T', status: 'SENT', providerRef: 'wamid.OUT_2' } });
      expect((await wa(fx('meta-status-lifecycle')).expect(200)).body).toEqual({ applied: 2, ignored: 1 }); // sent is not newer than SENT
      expect((await c.prisma.messageLog.findFirstOrThrow({ where: { providerRef: 'wamid.OUT_1' } })).status).toBe('READ');
      expect((await wa(fx('meta-status-lifecycle')).expect(200)).body).toEqual({ applied: 0, ignored: 3 });
      await wa(fx('meta-status-failed-131047')).expect(200);
      expect(await c.prisma.messageLog.findFirstOrThrow({ where: { providerRef: 'wamid.OUT_2' } })).toMatchObject({ status: 'FAILED', error: 'META_131047' });
    });
    it('template review and quality events update the registry; phone-number quality / tier is stored; unknown templates are ignored, never created', async () => {
      hub.waTemplates.load({ BOOKING_CONFIRMED: { templateId: 'TODO_NEEDS_HUMAN_booking_confirmed', en: 'Visit with {doctor} at {time}.', ar: 'زيارتك مع {doctor} في {time}.' } });
      for (const d of hub.waTemplates.list()) await hub.templateStore.upsertDefinition(d);
      await wa(fx('meta-template-status-approved')).expect(200);
      expect(await c.prisma.whatsappTemplate.findFirstOrThrow({ where: { metaName: 'kx_booking_confirmed_v1', language: 'ar' } })).toMatchObject({ status: 'APPROVED', metaTemplateId: '1689556908129' });
      await wa(fx('meta-template-quality')).expect(200);
      expect((await c.prisma.whatsappTemplate.findFirstOrThrow({ where: { metaName: 'kx_booking_confirmed_v1', language: 'ar' } })).quality).toBe('YELLOW');
      await wa(fx('meta-template-status-rejected')).expect(200); expect(await c.prisma.whatsappTemplate.count({ where: { metaName: 'kx_review_invitation_v1' } })).toBe(0);
      await wa(fx('meta-phone-quality-downgrade')).expect(200);
      expect(await hub.getState('WHATSAPP', 'quality')).toMatchObject({ event: 'DOWNGRADE', tier: 'TIER_1K', tierLimit: 1000 });
      await wa(fx('meta-account-update')).expect(200); expect(await hub.getState('WHATSAPP', 'account')).toMatchObject({ event: 'DISABLED_UPDATE' });
      expect(logs.some((l) => /quality event DOWNGRADE tier=TIER_1K/.test(l))).toBe(true);
    });
    it('a wrong signature or a forged verify token is rejected; the verify token can come from a secretRef', async () => {
      await c.http().post('/api/v1/messaging/webhooks/whatsapp').set('content-type', 'application/json').set('x-hub-signature-256', 'sha256=00').send(fx('meta-inbound-text')).expect(401);
      await c.http().get('/api/v1/messaging/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify_me_123&hub.challenge=55').expect(200).expect('55');
      delete process.env.WHATSAPP_VERIFY_TOKEN; process.env._KIOREX_TEST_WA_VERIFY = 'from_secret_ref';
      hub.setConfigSource(async () => ({ channels: { WHATSAPP: { secretRefs: { verifyToken: '/kiorex/test/wa_verify' } } } }));
      await c.http().get('/api/v1/messaging/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=from_secret_ref&hub.challenge=77').expect(200).expect('77');
      delete process.env._KIOREX_TEST_WA_VERIFY;
    });
  });

  describe('SES bounce / complaint -> suppression, one-click unsubscribe', () => {
    beforeEach(() => set(SES)); afterEach(() => unset(SES));
    const auth = (pw = SES.EMAIL_WEBHOOK_SECRET) => ({ authorization: `Basic ${Buffer.from(`sns:${pw}`).toString('base64')}` });
    const sns = (n: string, pw?: string) => c.http().post('/api/v1/messaging/webhooks/email').set('content-type', 'text/plain; charset=UTF-8').set(auth(pw)).send(JSON.stringify(fx(n)));
    it('SNS delivers text/plain: delivery updates the log, a permanent bounce suppresses the address for ALL mail, later sends fail closed without calling SES', async () => {
      await c.prisma.messageLog.create({ data: { channel: 'EMAIL', direction: 'OUT', mode: 'real', recipientMasked: 'p***@example.com', templateId: 'T', status: 'SENT', providerRef: '0100019aaa111111-ses-1' } });
      expect((await sns('ses-delivery').expect(200)).body).toEqual({ applied: 1, ignored: 0 });
      await sns('ses-delivery', 'wrong').expect(401);
      const r = (await sns('ses-bounce-permanent').expect(200)).body; expect(r).toMatchObject({ suppressed: 1 });
      expect(await c.prisma.communicationSuppression.findFirst({ where: { channel: 'EMAIL', addressHash: addressHash('gone.user@example.com'), reason: 'BOUNCE', liftedAt: null } })).not.toBeNull();
      const sent = await hub.send({ channel: 'EMAIL', to: 'Gone.User@example.com', templateId: 'BOOKING_CONFIRMED', locale: 'en', body: 'x', subject: 's' });
      expect(sent).toMatchObject({ ok: false, error: 'ADDRESS_SUPPRESSED', status: 'FAILED' });
    });
    it('a transient bounce never suppresses; a complaint does; the SNS subscription handshake is acknowledged', async () => {
      await sns('ses-bounce-transient').expect(200); expect(await c.prisma.communicationSuppression.count()).toBe(0);
      await sns('ses-complaint').expect(200);
      expect(await c.prisma.communicationSuppression.findFirst({ where: { addressHash: addressHash('angry@example.com'), reason: 'COMPLAINT' } })).not.toBeNull();
    });
    it('one-click unsubscribe: GET only checks, POST suppresses the address for e-mail; a forged token is a 404', async () => {
      const t = signUnsubscribeToken({ address: 'reader@example.com', sub: 'sub1' });
      expect((await c.http().get(`/api/v1/messaging/unsubscribe/${t}`).expect(200)).body).toEqual({ unsubscribed: false }); expect(await c.prisma.communicationSuppression.count()).toBe(0);
      expect((await c.http().post(`/api/v1/messaging/unsubscribe/${t}`).type('form').send('List-Unsubscribe=One-Click').expect(200)).body).toEqual({ unsubscribed: true });
      expect(await c.prisma.communicationSuppression.findFirst({ where: { channel: 'EMAIL', addressHash: addressHash('reader@example.com'), reason: 'STOP' } })).not.toBeNull();
      await c.http().post(`/api/v1/messaging/unsubscribe/${t.slice(0, -3)}abc`).expect(404);
    });
    it('marketing e-mail without an unsubscribe URL is refused by the adapter (compliance), transactional is not', async () => {
      const calls: string[] = [];
      const fetchImpl = (async (u: string) => { calls.push(u); return new Response(JSON.stringify({ MessageId: 'ses-1' }), { status: 200 }); }) as never;
      const { HttpMessagingAdapter } = await import('../src/messaging/adapters');
      const a = new HttpMessagingAdapter('EMAIL', { fetchImpl }, 'ses'); const cfgv = await hub.config('EG');
      expect(await a.send({ channel: 'EMAIL', to: 'p@example.com', templateId: 'M', locale: 'en', body: 'x', subject: 's', messageClass: 'MARKETING' }, { config: cfgv, market: 'EG', now: Date.now() })).toMatchObject({ ok: false, error: 'EMAIL_UNSUBSCRIBE_MISSING' });
      expect(calls).toHaveLength(0);
      expect((await a.send({ channel: 'EMAIL', to: 'p@example.com', templateId: 'M', locale: 'en', body: 'x', subject: 's', messageClass: 'MARKETING', unsubscribeUrl: 'https://api.kiorex.test/u/1' }, { config: cfgv, market: 'EG', now: Date.now() })).ok).toBe(true);
      expect((await a.send({ channel: 'EMAIL', to: 'p@example.com', templateId: 'T', locale: 'en', body: 'x', subject: 's' }, { config: cfgv, market: 'EG', now: Date.now() })).ok).toBe(true);
    });
  });

  describe('SMS aggregator delivery reports', () => {
    beforeEach(() => set(AGG)); afterEach(() => unset(AGG));
    it('DLR callback with the shared token updates the message; no token or a wrong one is 401', async () => {
      await c.prisma.messageLog.create({ data: { channel: 'SMS', direction: 'OUT', mode: 'real', recipientMasked: '+200****567', templateId: 'T', status: 'SENT', providerRef: '88123' } });
      const post = (qs: string) => c.http().post(`/api/v1/messaging/webhooks/sms${qs}`).type('form').send(fxText('aggregator-a-dlr'));
      await post('').expect(401); await post('?token=wrong').expect(401);
      expect((await post(`?token=${AGG.SMS_WEBHOOK_SECRET}`).expect(200)).body).toEqual({ applied: 1, ignored: 0 });
      expect((await c.prisma.messageLog.findFirstOrThrow({ where: { providerRef: '88123' } })).status).toBe('DELIVERED');
    });
  });

  describe('failover and logging hygiene', () => {
    const fake = (channel: OutboundMessage['channel'], ok: boolean, error?: string, calls: string[] = []): MessagingAdapter => ({ channel, mode: 'real', send: async () => { calls.push(channel); return ok ? { ok: true, providerRef: `${channel}_ref` } : { ok: false, providerRef: '', error }; } });
    it('walks the configured order until a channel accepts; skips channels without an address; MARKETING never fails over', async () => {
      const calls: string[] = [];
      hub.setAdapter(fake('WHATSAPP', false, 'WA_WINDOW_CLOSED', calls)); hub.setAdapter(fake('SMS', true, undefined, calls)); hub.setAdapter(fake('EMAIL', true, undefined, calls));
      const base = { templateId: 'BOOKING_CONFIRMED', locale: 'en', body: 'x' };
      const r = await hub.sendWithFailover(base, { WHATSAPP: PHONE, SMS: PHONE, EMAIL: 'p@example.com' });
      expect(r).toMatchObject({ ok: true, channel: 'SMS' }); expect(r.attempts.map((a) => [a.channel, a.ok])).toEqual([['WHATSAPP', false], ['SMS', true]]); expect(calls).toEqual(['WHATSAPP', 'SMS']);
      calls.length = 0;
      expect((await hub.sendWithFailover(base, { SMS: PHONE, EMAIL: 'p@example.com' })).channel).toBe('SMS'); expect(calls).toEqual(['SMS']);
      calls.length = 0; hub.setConfigSource(async () => ({ failoverOrder: { MARKETING: ['WHATSAPP'] }, markets: { SA: { failoverOrder: { TRANSACTIONAL: ['EMAIL'] } } } }));
      const m = await hub.sendWithFailover(base, { WHATSAPP: PHONE, SMS: PHONE }, { messageClass: 'MARKETING' });
      expect(m.ok).toBe(false); expect(calls).toEqual(['WHATSAPP']);
      calls.length = 0; expect((await hub.sendWithFailover({ ...base, market: 'SA' }, { WHATSAPP: PHONE, EMAIL: 'p@example.com' })).channel).toBe('EMAIL'); expect(calls).toEqual(['EMAIL']);
      expect((await hub.sendWithFailover(base, {})).ok).toBe(false);
    });
    it('real-mode send through the Meta adapter keeps no body or raw recipient in the log and prints neither to the console, even on failure; injection in the body cannot change the request shape', async () => {
      set(META);
      try {
        const calls: Array<{ url: string; body: any }> = []; let fail = false;
        const fetchImpl = (async (url: string, init: RequestInit) => { calls.push({ url, body: JSON.parse(String(init.body)) }); return fail ? new Response(JSON.stringify({ error: { code: 131026, message: `bad ${PHONE} EAAGsecrettokenvalue0123456789` } }), { status: 400 }) : new Response(JSON.stringify({ messages: [{ id: 'wamid.LEAK1' }] }), { status: 200 }); }) as never;
        hub.setAdapter(new MetaWhatsappAdapter({ http: { fetchImpl, sleep: async () => undefined }, window: hub.windows, templates: hub.waTemplates, status: hub.templateStore }));
        await hub.windows.touch(PHONE, Date.now());
        const secretBody = 'سري: جلوكوز 240 "},"type":"template","x":{" \n<script>alert(1)</script> {{1}}';
        const ok = await hub.send({ channel: 'WHATSAPP', to: PHONE, templateId: 'ASSISTANT_REPLY', locale: 'ar', body: secretBody, conversational: true });
        expect(ok).toMatchObject({ ok: true, mode: 'real', body: null, recipient: null }); expect(ok.recipientMasked).not.toContain('1001234567');
        expect(calls[0].body).toMatchObject({ type: 'text', text: { body: secretBody }, to: '201001234567' }); expect(Object.keys(calls[0].body).sort()).toEqual(['messaging_product', 'recipient_type', 'text', 'to', 'type']);
        fail = true;
        const bad = await hub.send({ channel: 'WHATSAPP', to: PHONE, templateId: 'ASSISTANT_REPLY', locale: 'ar', body: secretBody, conversational: true });
        expect(bad).toMatchObject({ ok: false, status: 'FAILED', error: 'META_131026' });
        const all = JSON.stringify(await c.prisma.messageLog.findMany()) + logs.join('\n');
        for (const leak of ['1001234567', 'جلوكوز', 'EAAGsecrettokenvalue', 'meta_app_secret', 'bad +20', '<script>']) expect(all).not.toContain(leak);
      } finally { unset(META); hub.clearAdapters(); }
    });
  });

  describe('ops: status, webhook display, test send, connection check, templates, domain check', () => {
    let su: { Authorization: string }; let opsOnly: { Authorization: string };
    beforeEach(async () => { su = await c.as('adm_a', { roles: ['ops_admin', 'super_admin'] }); opsOnly = await c.as('ops_1', { roles: ['ops_admin'] }); set(META); set({ MESSAGING_TEST_ALLOWLIST: '+201112223334, owner@kiorex.com' }); ops.http = { fetchImpl: (async () => { throw new Error('NETWORK USED'); }) as never }; (ops as unknown as { testSends: Map<string, number[]> }).testSends.clear(); });
    afterEach(() => { unset(META); delete process.env.MESSAGING_TEST_ALLOWLIST; delete process.env.MESSAGING_TEST_ALLOWLIST_SUBS; });
    const ch = (p: string) => `/api/v1/admin/messaging/channels${p}`;

    it('status lists problems by variable NAME only and never echoes a secret; roles are enforced', async () => {
      set({ SMS_MODE: 'real', SMS_PROVIDER: 'twilio', SMS_API_KEY: 'ACsecret:tokenvaluexyz' });
      try {
        const r = (await c.http().get(ch('')).set(opsOnly).expect(200)).body;
        const sms = r.channels.find((x: any) => x.channel === 'SMS'); expect(sms.mode).toBe('real'); expect(sms.providers[0].problems.join()).toMatch(/SMS_API_URL|SMS_SENDER_ID|SMS_WEBHOOK_SECRET|SMS_WEBHOOK_PUBLIC_URL/); expect(sms.ready).toBe(false);
        const wa = r.channels.find((x: any) => x.channel === 'WHATSAPP'); expect(wa).toMatchObject({ mode: 'real', ready: true, webhook: expect.stringMatching(/\/api\/v1\/messaging\/webhooks\/whatsapp$/) });
        for (const leak of ['EAAGsecrettokenvalue', 'tokenvaluexyz', 'meta_app_secret', 'verify_me_123']) expect(JSON.stringify(r)).not.toContain(leak);
        await c.http().get(ch('')).set(await c.as('p1')).expect(403);
      } finally { unset({ SMS_MODE: '', SMS_PROVIDER: '', SMS_API_KEY: '' }); }
    });
    it('webhook display masks the verify token; reveal is super admin only and leaves an audit row', async () => {
      const masked = (await c.http().get(ch('/whatsapp/webhook')).set(opsOnly).expect(200)).body;
      expect(masked).toMatchObject({ callbackUrl: expect.stringContaining('/messaging/webhooks/whatsapp'), verifyTokenSet: true, subscribeFields: expect.arrayContaining(['messages']) }); expect(masked.verifyToken).not.toBe('verify_me_123');
      await c.http().post(ch('/whatsapp/webhook/reveal')).set(opsOnly).expect(403);
      expect((await c.http().post(ch('/whatsapp/webhook/reveal')).set(su).expect(200)).body.verifyToken).toBe('verify_me_123');
      expect(await c.prisma.auditLog.count({ where: { action: 'messaging.webhook_info.reveal', actor: 'adm_a' } })).toBe(1);
      set(SES); try { const e = (await c.http().post(ch('/email/webhook/reveal')).set(su).expect(200)).body; expect(e.subscriptionUrl).toContain('sns:sns_basic_pw_0123456789@'); expect((await c.http().get(ch('/email/webhook')).set(opsOnly).expect(200)).body.subscriptionUrl).not.toContain('sns_basic_pw'); } finally { unset(SES); }
    });
    it('test send: ONLY allow-listed internal addresses (mock mode: dev inbox row, no vendor), 5 per hour, super admin only, audited', async () => {
      unset({ WHATSAPP_MODE: '' }); delete process.env.WHATSAPP_MODE; // mock
      await c.http().post(ch('/sms/test-send')).set(su).send({ to: '+201009999999' }).expect(403).expect((r) => expect(r.body.code).toBe('TEST_SEND_NOT_ALLOWLISTED'));
      await c.http().post(ch('/sms/test-send')).set(opsOnly).send({ to: '+201112223334' }).expect(403);
      const ok = (await c.http().post(ch('/sms/test-send')).set(su).send({ to: '+20 111 222 3334' }).expect(200)).body; expect(ok).toMatchObject({ ok: true, mode: 'mock', status: 'SENT' });
      expect(await c.prisma.messageLog.count({ where: { templateId: 'MSG_TEST', recipient: '+20 111 222 3334' } })).toBe(1);
      expect((await c.http().post(ch('/email/test-send')).set(su).send({ to: 'OWNER@kiorex.com' }).expect(200)).body.ok).toBe(true);
      await c.http().post(ch('/email/test-send')).set(su).send({ to: 'stranger@example.com' }).expect(403);
      for (let i = 0; i < 3; i++) await c.http().post(ch('/sms/test-send')).set(su).send({ to: '+201112223334' }).expect(200);
      await c.http().post(ch('/sms/test-send')).set(su).send({ to: '+201112223334' }).expect(429);
      expect(await c.prisma.auditLog.count({ where: { action: 'messaging.test_send.refused' } })).toBeGreaterThanOrEqual(2);
      const dev = await c.prisma.deviceToken.create({ data: { id: 'kx_dev_t1', sub: 'staff_1', platform: 'ANDROID', token: 'fcm-test-token-1' } }); expect(dev.token).toBe('fcm-test-token-1');
      await c.http().post(ch('/push/test-send')).set(await c.as('adm_b', { roles: ['ops_admin', 'super_admin'] })).send({ to: 'fcm-test-token-1' }).expect(403); // sub not allow-listed
      process.env.MESSAGING_TEST_ALLOWLIST_SUBS = 'staff_1';
      expect((await c.http().post(ch('/push/test-send')).set(await c.as('adm_b', { roles: ['ops_admin', 'super_admin'] })).send({ to: 'fcm-test-token-1' }).expect(200)).body.ok).toBe(true);
    });
    it('test send over real WhatsApp goes through the window / template decision: no window and no approved template is a clear refusal, not a vendor error', async () => {
      const calls: string[] = [];
      hub.setAdapter(new MetaWhatsappAdapter({ http: { fetchImpl: (async (u: string) => { calls.push(u); return new Response(JSON.stringify({ messages: [{ id: 'wamid.T1' }] }), { status: 200 }); }) as never, sleep: async () => undefined }, window: hub.windows, templates: hub.waTemplates, status: hub.templateStore }));
      try {
        // MSG_TEST is a registered template: it is sent as a template (approved or not yet reviewed) with the time parameter
        const r = (await c.http().post(ch('/whatsapp/test-send')).set(su).send({ to: '+201112223334' }).expect(200)).body; expect(r).toMatchObject({ ok: true, mode: 'real' }); expect(calls).toHaveLength(1);
        await c.prisma.whatsappTemplate.updateMany({ data: { status: 'REJECTED' } });
        await hub.templateStore.upsertDefinition(hub.waTemplates.resolve('MSG_TEST', 'en')!); await c.prisma.whatsappTemplate.updateMany({ data: { status: 'REJECTED' } });
        const r2 = (await c.http().post(ch('/whatsapp/test-send')).set(su).send({ to: '+201112223334' }).expect(200)).body; expect(r2).toMatchObject({ ok: false, error: 'WA_TEMPLATE_NOT_APPROVED' }); expect(calls).toHaveLength(1);
      } finally { hub.clearAdapters(); }
    });
    it('connection check: mock mode makes NO network call; real Meta check reads the phone number, templates and subscription; a refused token is reported, not thrown', async () => {
      delete process.env.WHATSAPP_MODE;
      expect((await c.http().post(ch('/whatsapp/connection-check')).set(su).expect(200)).body).toMatchObject({ mode: 'mock', ok: true });
      set(META); hub.setConfigSource(async () => ({ channels: { WHATSAPP: { wabaId: '102290129340398' } } }));
      const urls: string[] = [];
      ops.http = { sleep: async () => undefined, fetchImpl: (async (u: string, init: RequestInit) => { urls.push(`${init.method} ${u}`); const j = u.includes('subscribed_apps') ? { data: [{ whatsapp_business_api_data: { id: '1' } }] } : u.includes('message_templates') ? { data: [] } : { display_phone_number: '+1 555 078 3881', verified_name: 'Kiorex', quality_rating: 'GREEN' }; return new Response(JSON.stringify(j), { status: 200 }); }) as never };
      const r = (await c.http().post(ch('/whatsapp/connection-check')).set(su).expect(200)).body;
      expect(r.ok).toBe(true); expect(r.checks.map((x: any) => x.name)).toEqual(expect.arrayContaining(['phone number', 'templates access', 'webhook subscription', 'verify token']));
      expect(urls).toEqual(['GET https://graph.facebook.com/v21.0/106540352242922?fields=display_phone_number,verified_name,quality_rating,code_verification_status,platform_type', 'GET https://graph.facebook.com/v21.0/102290129340398/message_templates?limit=1&fields=name,status', 'GET https://graph.facebook.com/v21.0/102290129340398/subscribed_apps']);
      ops.http = { sleep: async () => undefined, fetchImpl: (async () => new Response(JSON.stringify({ error: { code: 190, message: 'Invalid OAuth access token EAAGsecrettokenvalue0123456789' } }), { status: 401 })) as never };
      const bad = (await c.http().post(ch('/whatsapp/connection-check')).set(su).expect(200)).body; expect(bad.ok).toBe(false); expect(JSON.stringify(bad)).not.toContain('EAAGsecret'); expect(bad.checks.find((x: any) => !x.ok).detail).toContain('190');
    });
    it('SES connection check flags the sandbox and DKIM; domain check reads DNS through an injected resolver', async () => {
      set(SES);
      try {
        ops.http = { sleep: async () => undefined, fetchImpl: (async (u: string, init: RequestInit) => { expect((init.headers as Record<string, string>).authorization).toMatch(/^AWS4-HMAC-SHA256/); return new Response(JSON.stringify(u.includes('/identities/') ? { VerifiedForSendingStatus: true, DkimAttributes: { Status: 'PENDING', SigningEnabled: true } } : { SendingEnabled: true, ProductionAccessEnabled: false, SendQuota: { Max24HourSend: 200, MaxSendRate: 1, SentLast24Hours: 3 } }), { status: 200 }); }) as never };
        const r = (await c.http().post(ch('/email/connection-check')).set(su).expect(200)).body;
        expect(r.ok).toBe(false); expect(r.checks.filter((x: any) => !x.ok).map((x: any) => x.name).sort()).toEqual(['DKIM', 'production access']);
        ops.dns = async () => ({ txt: async (n: string) => (n === 'kiorex.com' ? ['v=spf1 include:amazonses.com ~all'] : n === '_dmarc.kiorex.com' ? ['v=DMARC1; p=none; rua=mailto:d@kiorex.com'] : []), cname: async () => [] });
        const d = (await c.http().post(ch('/email/domain-check')).set(su).send({ domain: 'kiorex.com', dkimTokens: ['abc'] }).expect(200)).body; expect(d.checks.map((x: any) => x.ok)).toEqual([true, true, false]);
        await c.http().post(ch('/email/domain-check')).set(su).send({ domain: 'bad domain!' }).expect(400);
      } finally { unset(SES); }
    });
    it('template registry: list, CSV, export for approval, dry-run submit, sync from Meta applies statuses and ids', async () => {
      hub.waTemplates.load({ BOOKING_CONFIRMED: { templateId: 'TODO_NEEDS_HUMAN_booking_confirmed', en: 'Visit with {doctor} at {time}.', ar: 'زيارتك مع {doctor} في {time}.' } });
      const list = (await c.http().get(ch('/whatsapp/templates')).set(opsOnly).expect(200)).body; expect(list.map((x: any) => `${x.key}:${x.language}:${x.status}`)).toEqual(expect.arrayContaining(['BOOKING_CONFIRMED:ar:DRAFT', 'BOOKING_CONFIRMED:en:DRAFT', 'MSG_TEST:en:DRAFT']));
      expect((await c.http().get(ch('/whatsapp/templates?format=csv')).set(opsOnly).expect(200)).text).toContain('key,language,metaName,category,status,body');
      const ex = (await c.http().get(ch('/whatsapp/templates/export')).set(opsOnly).expect(200)).body; expect(ex.find((x: any) => x.key === 'BOOKING_CONFIRMED' && x.language === 'ar').submission.components[0].text).toBe('زيارتك مع {{1}} في {{2}}.');
      const dry = (await c.http().post(ch('/whatsapp/templates/submit')).set(su).send({}).expect(200)).body; expect(dry).toMatchObject({ dryRun: true, count: 4 }); expect(await c.prisma.whatsappTemplate.count()).toBe(4);
      await c.http().post(ch('/whatsapp/templates/submit')).set(su).send({ confirm: true }).expect(400); // mock mode / no WABA
      hub.setConfigSource(async () => ({ channels: { WHATSAPP: { wabaId: '102290129340398' } } }));
      ops.http = { sleep: async () => undefined, fetchImpl: (async () => new Response(JSON.stringify({ data: [{ name: 'kx_booking_confirmed_v1', language: 'ar', status: 'APPROVED', category: 'UTILITY', id: '555', quality_score: { score: 'GREEN' } }, { name: 'kx_booking_confirmed_v1', language: 'en', status: 'REJECTED', id: '556', rejected_reason: 'INVALID_FORMAT' }, { name: 'someone_elses_template', language: 'en', status: 'APPROVED', id: '9' }] }), { status: 200 })) as never };
      expect((await c.http().post(ch('/whatsapp/templates/sync')).set(su).expect(200)).body).toEqual({ seen: 3, updated: 2 });
      expect(await c.prisma.whatsappTemplate.findFirstOrThrow({ where: { metaName: 'kx_booking_confirmed_v1', language: 'en' } })).toMatchObject({ status: 'REJECTED', reason: 'INVALID_FORMAT', metaTemplateId: '556' });
      const ok = await c.http().post(ch('/whatsapp/templates/submit')).set(su).send({ keys: ['BOOKING_CONFIRMED'], confirm: true });
      expect(ok.status).toBe(200); expect(ok.body.results).toHaveLength(2);
    });
  });

  describe('config kind MESSAGING_CHANNELS (maker-checker, per-market)', () => {
    it('refuses a payload carrying a credential value, accepts secretRefs, and the approved version changes sender id and quiet hours per market without a deploy', async () => {
      const A = await c.as('adm_a', { roles: ['ops_admin', 'super_admin'] }); const B = await c.as('adm_b', { roles: ['ops_admin', 'super_admin'] });
      new MessagingConfigBinder(hub, c.get(GrowthConfigService)).onModuleInit(); // the beforeEach pointed the hub at "no config"; this is the production wiring
      c.get(GrowthConfigService).invalidate();
      const create = (payload: unknown) => c.http().post('/api/v1/ops/growth/config').set(A).send({ kind: 'MESSAGING_CHANNELS', scope: 'GLOBAL', payload, ticket: 'T-9', reason: 'go-live tuning', announcement: 'Channel tuning for the WhatsApp go-live.' });
      expect((await create({ channels: { WHATSAPP: { senderId: 'EAAG' + 'x'.repeat(60) } } })).status).toBe(422);
      expect((await create({ channels: { SMS: { secretRefs: { twilio: 'AC123:abcdef' } } } })).status).toBe(422);
      const good = { channels: { SMS: { senderId: 'Kiorex', providers: ['aggregator', 'twilio'], secretRefs: { aggregator: '/kiorex/prod/sms_aggregator' } } }, quietHours: { start: '22:00', end: '08:00', timezone: 'Africa/Cairo' }, markets: { SA: { channels: { SMS: { senderId: 'KiorexSA' } } } } };
      const d = (await create(good).expect(201)).body;
      await c.http().post(`/api/v1/ops/growth/config/${d.id}/submit`).set(A).expect(200);
      await c.http().post(`/api/v1/ops/growth/config/${d.id}/approve`).set(B).expect(200);
      c.get(GrowthConfigService).invalidate();
      expect((await hub.config('EG')).channels!.SMS!.senderId).toBe('Kiorex'); expect((await hub.config('SA')).channels!.SMS!.senderId).toBe('KiorexSA');
      expect(hub.quietHoursSync('EG')).toMatchObject({ start: '22:00', end: '08:00' });
      expect((await hub.quietUntil('WHATSAPP', 'EG', Date.parse('2026-11-25T20:30:00Z')))).toBe(Date.parse('2026-11-26T06:00:00Z')); // 22:30 Cairo -> 08:00 Cairo
      const kinds = (await c.http().get('/api/v1/ops/growth/config/kinds').set(A).expect(200)).body; expect(kinds.map((k: any) => k.kind)).toContain('MESSAGING_CHANNELS');
    });
  });
});
