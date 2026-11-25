import { createServer, IncomingMessage, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { assertProviderConfig, providerEnv, providerProblems, ProviderConfigError } from './env';
import { providerRequest, ProviderError } from './http';
import { signedWebhookHeaders, signWebhookBody, verifyWebhookBody } from './webhook';
import { HttpMessagingTransport } from './real-adapters';
import { genericStatusBody, parseGenericStatus } from './mapping-types';
import { paymentMapping } from './payment.mapping';
import { whatsappTemplateName } from './whatsapp.mapping';
import { verifyProviderStartup } from './startup';
import { HttpMessagingAdapter } from '../../messaging/adapters';
import { HttpPspAdapter } from '../../pay/psp';

interface Hit { method: string; url: string; headers: IncomingMessage['headers']; body: any }
let server: Server; let base = ''; let hits: Hit[] = []; let script: Array<(res: import('node:http').ServerResponse) => void> = [];
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => (res: import('node:http').ServerResponse) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      hits.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: raw ? JSON.parse(raw) : undefined });
      (script.shift() ?? json(200, { id: 'default_ref' }))(res);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => { hits = []; script = []; });

const realEnv = (kind: 'SMS' | 'EMAIL' | 'WHATSAPP' | 'PAYMENT', extra: Record<string, string> = {}) => ({
  [`${kind}_MODE`]: 'real', [`${kind}_API_URL`]: base, [`${kind}_API_KEY`]: 'key_test_123', [`${kind}_SENDER_ID`]: 'KIOREX', [`${kind}_WEBHOOK_SECRET`]: 'whsec_test_0123456789', [`${kind}_MAX_RETRIES`]: '2', ...extra,
});
const withEnv = async (e: Record<string, string>, fn: () => Promise<void>) => {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(e)) { prev[k] = process.env[k]; process.env[k] = e[k]; }
  try { await fn(); } finally { for (const k of Object.keys(e)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; } }
};
const noSleep = { sleep: async () => undefined, random: () => 0 };

describe('provider env + fail-fast', () => {
  it('defaults to mock and needs nothing', () => {
    expect(providerEnv('SMS', {}).mode).toBe('mock');
    expect(() => assertProviderConfig({})).not.toThrow();
  });
  it('MODE=real without URL / key / sender / webhook secret fails fast, naming variables only', () => {
    let err: ProviderConfigError | undefined;
    try { assertProviderConfig({ SMS_MODE: 'real', SMS_API_KEY: 'super-secret-key-value' }); } catch (e) { err = e as ProviderConfigError; }
    expect(err).toBeInstanceOf(ProviderConfigError);
    expect(err!.problems).toEqual(expect.arrayContaining(['SMS_API_URL is required when SMS_MODE=real', 'SMS_SENDER_ID is required when SMS_MODE=real', 'SMS_WEBHOOK_SECRET is required when SMS_MODE=real']));
    expect(err!.message).not.toContain('super-secret-key-value');
  });
  it('rejects plain http to a non-loopback host, bad mode values and short webhook secrets; PAYMENT needs no sender id', () => {
    expect(providerProblems('EMAIL', { ...realEnv('EMAIL'), EMAIL_API_URL: 'http://mail.example.com' })).toContain('EMAIL_API_URL must be https');
    expect(providerProblems('SMS', { SMS_MODE: 'live' })).toContain('SMS_MODE must be mock or real');
    expect(providerProblems('SMS', realEnv('SMS', { SMS_WEBHOOK_SECRET: 'short' }))).toContain('SMS_WEBHOOK_SECRET must be at least 16 characters');
    expect(providerProblems('PAYMENT', { ...realEnv('PAYMENT'), PAYMENT_SENDER_ID: '' })).toEqual([]);
  });
  it('honours legacy aliases (MESSAGING_MODE, PSP_MODE) only when the kind variable is unset', () => {
    expect(providerEnv('SMS', { MESSAGING_MODE: 'real' }).mode).toBe('real');
    expect(providerEnv('SMS', { MESSAGING_MODE: 'real', SMS_MODE: 'mock' }).mode).toBe('mock');
    expect(providerEnv('PAYMENT', { PSP_MODE: 'real' }).mode).toBe('real');
    expect(providerEnv('PAYMENT', { PSP_MODE: 'sandbox-fake' }).mode).toBe('mock');
  });
  it('startup also guards SAFETY_DELIVERY_MODE=real', () => {
    expect(() => verifyProviderStartup({ SAFETY_DELIVERY_MODE: 'real' })).toThrow(/SMS_MODE=real/);
    expect(verifyProviderStartup({})).toEqual(['sms=mock', 'email=mock', 'whatsapp=mock', 'push=mock', 'payment=mock', 'video=mock', 'maps=mock', 'ai=mock']);
  });
});

describe('providerRequest (fake HTTP server)', () => {
  const env = () => providerEnv('SMS', realEnv('SMS'));
  it('sends auth + idempotency headers and parses JSON', async () => {
    const r = await providerRequest(env(), { path: '/messages', body: { a: 1 }, idempotencyKey: 'k1' }, noSleep, { authorization: 'Bearer key_test_123' });
    expect(r.json).toEqual({ id: 'default_ref' });
    expect(hits[0].headers.authorization).toBe('Bearer key_test_123');
    expect(hits[0].headers['idempotency-key']).toBe('k1');
    expect(hits[0].body).toEqual({ a: 1 });
  });
  it('retries 5xx and 429 with the SAME idempotency key, then succeeds', async () => {
    script = [json(503, {}), json(429, {}, { 'retry-after': '0' }), json(200, { id: 'ok_after_retry' })];
    const sleeps: number[] = [];
    const r = await providerRequest(env(), { path: '/messages', body: {}, idempotencyKey: 'same-key' }, { sleep: async (ms) => { sleeps.push(ms); }, random: () => 0 });
    expect(r.attempts).toBe(3); expect(r.json.id).toBe('ok_after_retry');
    expect(hits.map((h) => h.headers['idempotency-key'])).toEqual(['same-key', 'same-key', 'same-key']);
    expect(sleeps[1]).toBeGreaterThan(sleeps[0]); // exponential backoff
  });
  it('gives up after maxRetries and maps the error; does NOT retry 4xx', async () => {
    script = [json(500, {}), json(500, {}), json(500, {})];
    await expect(providerRequest(env(), { path: '/m', body: {} }, noSleep)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', status: 500, attempts: 3 });
    expect(hits).toHaveLength(3);
    hits = []; script = [json(401, {})];
    await expect(providerRequest(env(), { path: '/m', body: {} }, noSleep)).rejects.toMatchObject({ code: 'UNAUTHORIZED', retryable: false });
    expect(hits).toHaveLength(1);
    hits = []; script = [json(400, {})];
    await expect(providerRequest(env(), { path: '/m', body: {} }, noSleep)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(hits).toHaveLength(1);
  });
  it('times out (aborts) and maps to TIMEOUT; network failure maps to NETWORK', async () => {
    script = [() => undefined, () => undefined];
    const slow = providerEnv('SMS', realEnv('SMS', { SMS_TIMEOUT_MS: '60', SMS_MAX_RETRIES: '1' }));
    await expect(providerRequest(slow, { path: '/m', body: {} }, noSleep)).rejects.toMatchObject({ code: 'TIMEOUT', attempts: 2 });
    const dead = providerEnv('SMS', realEnv('SMS', { SMS_API_URL: 'http://127.0.0.1:1', SMS_MAX_RETRIES: '0' }));
    await expect(providerRequest(dead, { path: '/m', body: {} }, noSleep)).rejects.toMatchObject({ code: 'NETWORK' });
  });
  it('error messages never contain the key or the body', async () => {
    script = [json(400, { echo: 'key_test_123' })];
    const e = await providerRequest(env(), { path: '/m', body: { code: '123456' } }, noSleep, { authorization: 'Bearer key_test_123' }).catch((x) => x as ProviderError) as ProviderError;
    expect(JSON.stringify([e.message, e.stack?.split('\n')[0]])).not.toMatch(/key_test_123|123456/);
  });
});

describe('webhook signature (HMAC)', () => {
  const secret = 'whsec_test_0123456789'; const raw = '{"events":[]}';
  it('accepts a correct signature and rejects tampering, wrong secret, missing headers and stale timestamps', () => {
    const h = signedWebhookHeaders(secret, raw);
    expect(verifyWebhookBody({ secret, rawBody: raw, headers: h })).toBe(true);
    expect(verifyWebhookBody({ secret, rawBody: raw + ' ', headers: h })).toBe(false);
    expect(verifyWebhookBody({ secret: 'another_secret_0123456', rawBody: raw, headers: h })).toBe(false);
    expect(verifyWebhookBody({ secret, rawBody: raw, headers: {} })).toBe(false);
    expect(verifyWebhookBody({ secret: '', rawBody: raw, headers: h })).toBe(false);
    const old = Math.floor(Date.now() / 1000) - 3600;
    expect(verifyWebhookBody({ secret, rawBody: raw, headers: { 'x-webhook-timestamp': String(old), 'x-webhook-signature': signWebhookBody(secret, old, raw) } })).toBe(false);
  });
});

describe('messaging real adapters (mapping + wiring)', () => {
  it('SMS / EMAIL / WHATSAPP POST the documented neutral payload with sender id, key and idempotency reference', async () => {
    for (const [kind, expectField] of [['SMS', 'body'], ['EMAIL', 'text'], ['WHATSAPP', 'template']] as const) {
      hits = []; script = [json(200, { id: `${kind}_ref_1` })];
      await withEnv(realEnv(kind, { WHATSAPP_TEMPLATE_MAP: '{"tpl_a":"approved_a"}' }), async () => {
        const a = new HttpMessagingAdapter(kind, { sleep: noSleep.sleep, random: noSleep.random });
        const r = await a.send({ messageId: 'msg_1', channel: kind, to: '+201000000001', templateId: 'tpl_a', locale: 'en', body: 'hello' });
        expect(r).toEqual({ ok: true, providerRef: `${kind}_ref_1` });
      });
      expect(hits[0].url).toBe('/messages');
      expect(hits[0].headers.authorization).toBe('Bearer key_test_123');
      expect(hits[0].headers['idempotency-key']).toBe('msg_1');
      expect(hits[0].body.to).toBe('+201000000001'); expect(hits[0].body.from).toBe('KIOREX'); expect(hits[0].body.reference).toBe('msg_1');
      expect(hits[0].body[expectField]).toBeDefined();
      if (kind === 'WHATSAPP') expect(hits[0].body.template).toMatchObject({ name: 'approved_a', language: 'en', variables: { body: 'hello' } });
    }
  });
  it('maps vendor failures to a safe error code (no throw, no body leak) and retries through a transient 503', async () => {
    await withEnv(realEnv('SMS'), async () => {
      const a = new HttpMessagingAdapter('SMS', noSleep);
      script = [json(503, {}), json(200, { id: 'after_503' })];
      expect(await a.send({ messageId: 'm2', channel: 'SMS', to: '+201000000001', templateId: 't', locale: 'en', body: 'Your code is 424242' })).toEqual({ ok: true, providerRef: 'after_503' });
      hits = []; script = [json(400, { error: 'bad number' })];
      const bad = await a.send({ messageId: 'm3', channel: 'SMS', to: 'x', templateId: 't', locale: 'en', body: 'Your code is 424242' });
      expect(bad).toEqual({ ok: false, providerRef: '', error: 'PROVIDER_INVALID_REQUEST_400' });
      script = [json(200, { nothing: true })];
      expect((await a.send({ messageId: 'm4', channel: 'SMS', to: '+2', templateId: 't', locale: 'en', body: 'b' })).error).toBe('PROVIDER_BAD_RESPONSE');
    });
  });
  it('transport used by Passport shape: HttpMessagingTransport returns ok/providerRef', async () => {
    script = [json(200, { data: { id: 'nested_ref' } })];
    const t = new HttpMessagingTransport('SMS', providerEnv('SMS', realEnv('SMS')), noSleep);
    expect(await t.send({ to: '+201000000001', body: 'x', reference: 'r1', templateId: 't', locale: 'ar' })).toEqual({ ok: true, providerRef: 'nested_ref' });
  });
  it('status webhook mapping: neutral events, unknown statuses ignored', () => {
    const ev = parseGenericStatus(JSON.stringify({ events: [{ id: 'a', status: 'delivered' }, { id: 'b', status: 'failed', error: 'NO_ROUTE' }, { id: 'c', status: 'weird' }, { status: 'read' }] }));
    expect(ev).toEqual([{ providerRef: 'a', status: 'DELIVERED' }, { providerRef: 'b', status: 'FAILED', error: 'NO_ROUTE' }]);
    expect(parseGenericStatus(genericStatusBody('z', 'read'))[0]).toMatchObject({ providerRef: 'z', status: 'READ' });
    expect(parseGenericStatus('not json')).toEqual([]);
    expect(whatsappTemplateName('x', {})).toBe('x');
  });
});

describe('payment real adapter (mapping + wiring)', () => {
  it('creates a checkout idempotently on the payment id and refunds idempotently on the refund id', async () => {
    await withEnv(realEnv('PAYMENT'), async () => {
      const a = new HttpPspAdapter('paymob', paymentMapping, (u, i) => fetch(u, i));
      script = [json(503, {}), json(200, { id: 'psp_1', checkoutUrl: 'https://pay.example/c/1' })];
      expect(await a.createCheckout({ paymentId: 'pay_1', amountMinor: 15000, currency: 'EGP' })).toEqual({ pspRef: 'psp_1', checkoutUrl: 'https://pay.example/c/1' });
      expect(hits.map((h) => h.headers['idempotency-key'])).toEqual(['checkout:pay_1', 'checkout:pay_1']);
      expect(hits[1].body).toEqual({ reference: 'pay_1', amountMinor: 15000, currency: 'EGP', capture: true, threeDs: 'preferred', returnUrl: 'http://localhost:5180/pay/return?payment=pay_1', webhookUrl: 'http://localhost:4000/api/v1/pay/webhooks/paymob' });
      hits = []; script = [json(200, { id: 'rf_psp_1' })];
      expect(await a.refund({ pspRef: 'psp_1', refundId: 'rf_1', amountMinor: 5000 })).toEqual({ pspRefundRef: 'rf_psp_1' });
      expect(hits[0].headers['idempotency-key']).toBe('refund:rf_1');
      script = [json(200, { id: 'x' })];
      await expect(a.createCheckout({ paymentId: 'pay_2', amountMinor: 1, currency: 'EGP' })).rejects.toThrow(/no checkout/);
    });
  });
  it('webhook: valid HMAC -> normalised event; bad / missing signature -> null; malformed payload -> null', async () => {
    await withEnv(realEnv('PAYMENT'), async () => {
      const a = new HttpPspAdapter('paymob');
      const raw = JSON.stringify({ id: 'evt_1', type: 'payment.captured', paymentRef: 'psp_1', reference: 'pay_1', amountMinor: 15000, feeMinor: 300, occurredAt: '2026-11-22T10:00:00Z' });
      expect(a.verifyWebhook(raw, signedWebhookHeaders('whsec_test_0123456789', raw))).toEqual({ eventId: 'evt_1', type: 'payment.captured', pspRef: 'psp_1', paymentId: 'pay_1', amountMinor: 15000, feeMinor: 300, occurredAt: '2026-11-22T10:00:00.000Z' });
      expect(a.verifyWebhook(raw, signedWebhookHeaders('wrong_secret_0123456789', raw))).toBeNull();
      expect(a.verifyWebhook(raw, {})).toBeNull();
      const junk = JSON.stringify({ id: 'e', type: 'payment.unknown', amountMinor: 1, paymentRef: 'p' });
      expect(a.verifyWebhook(junk, signedWebhookHeaders('whsec_test_0123456789', junk))).toBeNull();
    });
  });
});
