import { createServer, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { createCtx, futureSlot, seedProvider, TestCtx } from './harness';
import { clearPolicyOverrides, setPolicyOverride } from '../src/growth/policy/policy-registry';
import { OutboxService } from '../src/outbox/outbox-public';
import { PayService } from '../src/pay/pay-public';
import { MessagingHub } from '../src/messaging/messaging-public';
import { EngagementService } from '../src/engagement/engagement-public';
import { genericStatusBody } from '../src/common/providers/mapping-types';
import { signedWebhookHeaders } from '../src/common/providers/webhook';

/** Real-mode wiring end to end against a local fake vendor HTTP server; mock-mode dev simulators. */
describe('provider go-live wiring (SMS / WHATSAPP / EMAIL / PAYMENT)', () => {
  let c: TestCtx; let auth: { Authorization: string }; let admin: { Authorization: string };
  let vendor: Server; let base = '';
  let hits: Array<{ url: string; headers: Record<string, any>; body: any }> = [];
  let script: Array<(r: ServerResponse) => void> = [];
  const reply = (status: number, body: unknown) => (r: ServerResponse) => { r.writeHead(status, { 'content-type': 'application/json' }); r.end(JSON.stringify(body)); };
  const SECRET = 'whsec_integration_0123456789';
  const realVars = (kind: string) => ({ [`${kind}_MODE`]: 'real', [`${kind}_API_URL`]: base, [`${kind}_API_KEY`]: 'key_integration', [`${kind}_SENDER_ID`]: 'KIOREX', [`${kind}_WEBHOOK_SECRET`]: SECRET, [`${kind}_MAX_RETRIES`]: '2' });
  const setEnv = (v: Record<string, string>) => Object.assign(process.env, v);
  const clearEnv = (v: Record<string, string>) => Object.keys(v).forEach((k) => delete process.env[k]);
  const slot = futureSlot(72);
  const flush = () => c.get(OutboxService).processBatch();

  beforeAll(async () => {
    vendor = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (d) => chunks.push(d));
      req.on('end', () => { const raw = Buffer.concat(chunks).toString('utf8'); hits.push({ url: req.url ?? '', headers: req.headers, body: raw ? JSON.parse(raw) : undefined }); (script.shift() ?? reply(200, { id: `vendor_${hits.length}` }))(res); });
    });
    await new Promise<void>((r) => vendor.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(vendor.address() as AddressInfo).port}`;
    c = await createCtx();
  });
  afterAll(async () => { clearPolicyOverrides(); await c.close(); await new Promise<void>((r) => vendor.close(() => r())); });
  beforeEach(async () => {
    hits = []; script = [];
    await c.reset();
    c.kiorly.slots = [slot];
    admin = await c.as('adm1', { roles: ['ops_admin'] });
    auth = await c.as('sub_amira');
    process.env.QUIET_HOURS_START = '0'; process.env.QUIET_HOURS_END = '0';
    await c.http().put('/api/v1/me/profile').set(auth).send({ nameEn: 'Amira Samy', email: 'amira@example.test' }).expect(200);
    await c.http().put('/api/v1/me/consents/MARKETPLACE_PROCESSING').set(auth).send({ granted: true });
  });
  afterAll(() => { delete process.env.QUIET_HOURS_START; delete process.env.QUIET_HOURS_END; });

  describe('messaging, mock mode', () => {
    it('samples cover booking confirmation, reminder, waitlist offer and refund on WhatsApp/SMS/email; signed webhook simulation advances status', async () => {
      const s = await c.http().post('/api/v1/dev/messaging/samples').send({ phone: '+201000000009', locale: 'en' }).expect(200);
      expect(s.body.sent).toBe(12);
      const out = (await c.http().get('/api/v1/dev/messaging/outbox?to=%2B201000000009&limit=100').expect(200)).body.items;
      expect(out.filter((m: any) => m.channel === 'SMS').map((m: any) => m.body)).toEqual(expect.arrayContaining([expect.stringContaining('confirmed'), expect.stringContaining('Reminder'), expect.stringContaining('slot opened')]));
      const wa = out.find((m: any) => m.channel === 'WHATSAPP');
      const r = await c.http().post('/api/v1/dev/messaging/webhook-simulate').send({ id: wa.id, state: 'READ' }).expect(200);
      expect(r.body.status).toBe('READ');
      expect((await c.http().post('/api/v1/dev/messaging/webhook-simulate').send({ id: wa.id, state: 'DELIVERED' }).expect(200)).body.status).toBe('READ'); // forward only
    });
    it('the public status webhook rejects an unsigned / badly signed call even in mock mode', async () => {
      const raw = genericStatusBody('x', 'delivered');
      await c.http().post('/api/v1/messaging/webhooks/sms').set('content-type', 'application/json').send(raw).expect(401);
      await c.http().post('/api/v1/messaging/webhooks/push').set('content-type', 'application/json').send(raw).expect(404);
    });
  });

  describe('messaging, real mode against a fake vendor', () => {
    let vars: Record<string, string> = {};
    beforeEach(() => { vars = { ...realVars('SMS'), ...realVars('WHATSAPP') }; setEnv(vars); });
    afterEach(() => clearEnv(vars));

    it('sends through the vendor with key + idempotency, keeps no body/recipient, disables dev routes, applies signed delivery webhooks', async () => {
      script = [reply(503, {}), reply(200, { id: 'sms_vendor_1' })];
      const m = await c.get(MessagingHub).send({ messageId: 'msg_real_1', channel: 'SMS', to: '+201000000001', templateId: 'tpl', locale: 'en', body: 'private body' });
      expect(m).toMatchObject({ ok: true, status: 'SENT', mode: 'real', providerRef: 'sms_vendor_1', body: null, recipient: null });
      expect(hits).toHaveLength(2); // transient 503 retried
      expect(hits.map((h) => h.headers['idempotency-key'])).toEqual(['msg_real_1', 'msg_real_1']);
      expect(hits[1].headers.authorization).toBe('Bearer key_integration');
      await c.http().get('/api/v1/dev/messaging/outbox').expect(404);
      await c.http().post('/api/v1/dev/messaging/samples').send({}).expect(404);

      const post = (ch: string, raw: string, h: Record<string, string>) => c.http().post(`/api/v1/messaging/webhooks/${ch}`).set('content-type', 'application/json').set(h).send(raw);
      const del = genericStatusBody('sms_vendor_1', 'delivered');
      await post('sms', del, signedWebhookHeaders('wrong_secret_0123456789', del)).expect(401);
      await post('sms', del, { ...signedWebhookHeaders(SECRET, del, Math.floor(Date.now() / 1000) - 3600) }).expect(401); // replay window
      expect((await post('sms', del, signedWebhookHeaders(SECRET, del)).expect(200)).body).toEqual({ applied: 1, ignored: 0 });
      expect((await post('sms', del, signedWebhookHeaders(SECRET, del)).expect(200)).body).toEqual({ applied: 0, ignored: 1 }); // idempotent
      expect((await c.prisma.messageLog.findUniqueOrThrow({ where: { id: m.id } })).status).toBe('DELIVERED');
      // the same ref on another channel's endpoint matches nothing
      expect((await post('whatsapp', del, signedWebhookHeaders(SECRET, del)).expect(200)).body).toEqual({ applied: 0, ignored: 1 });
    });

    it('a vendor-reported failure marks the log and the linked notification FAILED; vendor rejection is a mapped error code', async () => {
      const eng = c.get(EngagementService);
      script = [reply(200, { id: 'wa_vendor_9' })];
      await eng.notify('sub_amira', { kind: 'BOOKING_CONFIRMED', params: { doctor: 'Dr X', time: 'T' }, dedupeKey: 'real1', channels: ['WHATSAPP'] });
      const log = await c.prisma.messageLog.findFirstOrThrow({ where: { channel: 'WHATSAPP' } });
      expect(hits[0].body.template).toMatchObject({ language: 'ar' }); // default locale ar
      const failed = genericStatusBody('wa_vendor_9', 'failed', 'NOT_ON_WHATSAPP');
      await c.http().post('/api/v1/messaging/webhooks/whatsapp').set('content-type', 'application/json').set(signedWebhookHeaders(SECRET, failed)).send(failed).expect(200);
      expect(await c.prisma.messageLog.findUniqueOrThrow({ where: { id: log.id } })).toMatchObject({ status: 'FAILED', error: 'NOT_ON_WHATSAPP' });
      expect((await c.prisma.message.findFirstOrThrow({ where: { channel: 'WHATSAPP' } })).status).toBe('FAILED');
      script = [reply(400, { error: 'bad' })];
      const rej = await c.get(MessagingHub).send({ channel: 'SMS', to: '+20', templateId: 't', locale: 'en', body: 'b' });
      expect(rej).toMatchObject({ ok: false, status: 'FAILED', error: 'PROVIDER_INVALID_REQUEST_400' });
    });
  });

  describe('payments', () => {
    const book = async () => {
      const pid = await seedProvider(c, { depositAmount: 150 });
      const h = await c.http().post('/api/v1/bookings').set(auth).send({ providerId: pid, typeId: 'typ_1', ...slot }).expect(201);
      await c.http().post(`/api/v1/bookings/${h.body.id}/confirm`).set(auth).send({ marketplaceConsent: true }).expect(200);
      return (await c.http().post(`/api/v1/bookings/${h.body.id}/deposit-checkout`).set(auth).expect(200)).body as { paymentId: string; checkoutUrl: string };
    };

    it('mock mode: dev simulator drives success, failure and refund through the verified webhook path', async () => {
      const ok = await book();
      expect((await c.http().post(`/api/v1/dev/payments/${ok.paymentId}/simulate`).send({ outcome: 'captured' }).expect(200)).body).toMatchObject({ webhookStatus: expect.any(String), payment: { status: 'CAPTURED' } });
      await c.get(PayService).refund(ok.paymentId, { reason: 'x', amountMinor: 5000, idempotencyKey: 'dev-rf' });
      const sim = await c.http().post(`/api/v1/dev/payments/${ok.paymentId}/simulate`).send({ outcome: 'refund_settled' }).expect(200);
      expect(sim.body.payment.refunds[0]).toMatch(/:SETTLED$/);
      expect((await c.http().get('/api/v1/dev/payments').expect(200)).body[0].id).toBe(ok.paymentId);
      await c.http().post(`/api/v1/dev/payments/nope/simulate`).send({ outcome: 'failed' }).expect(404);
      process.env.NODE_ENV = 'production';
      try { await c.http().get('/api/v1/dev/payments').expect(404); } finally { process.env.NODE_ENV = 'test'; }
    });

    it('mock mode: failure leaves the payment FAILED', async () => {
      const p = await book();
      expect((await c.http().post(`/api/v1/dev/payments/${p.paymentId}/simulate`).send({ outcome: 'failed' }).expect(200)).body.payment.status).toBe('FAILED');
    });

    it('real mode: checkout + refund hit the vendor with idempotency keys, signed webhooks capture once, bad signatures are refused', async () => {
      setPolicyOverride('INTEGRATION_MODES', { modes: { PAYMOB: 'real' } }, 1); // real mode needs the approved record (maker-checker); the guard itself is tested in mode-guard.unit.spec.ts
      const vars = realVars('PAYMENT'); setEnv(vars);
      try {
        script = [reply(200, { id: 'psp_ref_77', checkoutUrl: 'https://pay.vendor.example/c/77' })];
        const co = await book();
        expect(co.checkoutUrl).toBe('https://pay.vendor.example/c/77');
        expect(hits[0]).toMatchObject({ url: '/checkouts', body: { reference: co.paymentId, amountMinor: 15000, currency: 'EGP' } });
        expect(hits[0].headers['idempotency-key']).toBe(`checkout:${co.paymentId}`);
        await c.http().post(`/api/v1/dev/payments/${co.paymentId}/simulate`).send({ outcome: 'captured' }).expect(404); // dev routes off in real mode
        await c.http().post(`/api/v1/pay/fake-checkout/${co.paymentId}/complete`).send({ outcome: 'pay' }).expect(404);

        const ev = JSON.stringify({ id: 'evt_real_1', type: 'payment.captured', paymentRef: 'psp_ref_77', reference: co.paymentId, amountMinor: 15000, feeMinor: 300, occurredAt: new Date().toISOString() });
        const send = (raw: string, h: Record<string, string>) => c.http().post('/api/v1/pay/webhooks/paymob').set('content-type', 'application/json').set(h).send(raw);
        await send(ev, signedWebhookHeaders('wrong_secret_0123456789', ev)).expect(400);
        await send(ev, {}).expect(400);
        expect((await send(ev, signedWebhookHeaders(SECRET, ev)).expect(200)).body.status).toBeDefined();
        expect((await send(ev, signedWebhookHeaders(SECRET, ev)).expect(200)).body.status).toBe('DUPLICATE');
        const p = await c.prisma.paymentIntent.findUniqueOrThrow({ where: { id: co.paymentId } });
        expect(p).toMatchObject({ status: 'CAPTURED', feeMinor: 300 });
        expect(await c.prisma.ledgerTx.count({ where: { idempotencyKey: `capture:${p.id}` } })).toBe(1);

        script = [reply(200, { id: 'psp_rf_1' })];
        const rf = await c.get(PayService).refund(co.paymentId, { reason: 'cancel', amountMinor: 5000, idempotencyKey: 'real-rf' });
        await flush();
        const refundHit = hits.find((h) => h.url === '/refunds')!;
        expect(refundHit.body).toEqual({ paymentRef: 'psp_ref_77', reference: rf.id, amountMinor: 5000 });
        expect(refundHit.headers['idempotency-key']).toBe(`refund:${rf.id}`);
        expect((await c.prisma.refund.findUniqueOrThrow({ where: { id: rf.id } })).status).toBe('SETTLED');
        const rs = JSON.stringify({ id: 'evt_real_2', type: 'refund.settled', paymentRef: 'psp_rf_1', reference: co.paymentId, amountMinor: 5000, occurredAt: new Date().toISOString() });
        expect((await send(rs, signedWebhookHeaders(SECRET, rs)).expect(200)).body.status).toBe('ALREADY_SETTLED');
        expect(await c.prisma.ledgerTx.count({ where: { idempotencyKey: `refund-settle:${rf.id}` } })).toBe(1);
      } finally { clearEnv(vars); }
    });
  });
});
