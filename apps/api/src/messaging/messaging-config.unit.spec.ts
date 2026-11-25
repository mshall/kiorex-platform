import { effectiveMessagingConfig, failoverOrderFor, MESSAGING_CHANNELS_DEFAULT, quietUntil, resolveSecretRef, retryFor, secretEnvName, SECRET_PATH, validateMessagingChannels } from './messaging-config';
import { providerEnvFor, providerOrder, providerProblemsFor } from './provider-select';
import { ApprovalGatedAdapter, createMessagingAdapter, FailoverAdapter, HttpMessagingAdapter, MockAdapter, UnconfiguredAdapter } from './adapters';
import type { MessagingAdapter, OutboundMessage } from './messaging.types';

process.env.INTEGRATION_MODE_GATE_BYPASS = 'true';
const ok = (p: unknown) => expect(validateMessagingChannels(p).errors).toEqual([]);
const bad = (p: unknown, frag: string) => expect(validateMessagingChannels(p).errors.join('\n')).toContain(frag);

describe('MESSAGING_CHANNELS config: validation', () => {
  it('the defaults and an empty payload are valid', () => { ok(MESSAGING_CHANNELS_DEFAULT()); ok({}); });
  it('a realistic production payload is valid (providers, secretRefs as Secrets Manager paths, per-market sender ids, failover, quiet hours, templates, push)', () => {
    ok({
      channels: {
        WHATSAPP: { providers: ['meta'], secretRefs: { meta: '/kiorex/prod/whatsapp_token', verifyToken: '/kiorex/prod/whatsapp_verify' }, senderId: '106540352242922', wabaId: '102290129340398', apiVersion: 'v21.0', rateBudget: { perSecond: 40, perDay: 1000 } },
        SMS: { providers: ['aggregator', 'twilio'], secretRefs: { aggregator: '/kiorex/prod/sms_aggregator', twilio: '/kiorex/prod/sms_twilio' }, senderId: 'Kiorex', retry: { maxRetries: 3, baseDelayMs: 500, maxDelayMs: 8000 }, aggregator: { path: '/api/SMS/', encoding: 'form' } },
        EMAIL: { providers: ['ses'], senderId: 'Kiorex <no-reply@kiorex.com>', unsubscribe: { baseUrl: 'https://kiorex.com/u', mailto: 'unsubscribe@kiorex.com' } },
        PUSH: { providers: ['fcm', 'apns', 'expo'], secretRefs: { apns: '/kiorex/prod/apns_p8' } },
      },
      failoverOrder: { TRANSACTIONAL: ['WHATSAPP', 'SMS', 'EMAIL'], SECURITY: ['SMS', 'WHATSAPP'], MARKETING: ['WHATSAPP'] },
      quietHours: { start: '22:00', end: '08:00', timezone: 'Africa/Cairo', channels: ['WHATSAPP', 'SMS', 'PUSH'] },
      whatsapp: { templates: { BOOKING_CONFIRMED: { ar: { name: 'kx_booking_confirmed_v2' } } }, throttleBackoffSeconds: [30, 120] },
      push: { badge: true, ttlSeconds: 3600, deepLinkSchemes: { kiorex: 'kiorex', kiorly: 'kiorly' }, apns: { teamId: 'ABCDE12345', keyId: 'ZYXWV98765', bundleId: 'com.kiorex.app', production: true } },
      markets: { SA: { channels: { SMS: { senderId: 'KiorexSA' } }, quietHours: { start: '23:00', end: '09:00', timezone: 'Asia/Riyadh' } } },
    });
  });
  it('refuses credential values and credential-looking keys (configuration holds secretRefs only)', () => {
    bad({ channels: { WHATSAPP: { senderId: 'EAAG' + 'x'.repeat(60) } } }, 'looks like a credential');
    bad({ channels: { SMS: { aggregator: { apiKey: 'abc' } } } }, 'credential-looking key');
    bad({ channels: { SMS: { aggregator: { password: 'abc' } } } }, 'credential-looking key');
    bad({ channels: { EMAIL: { senderId: 'AKIAABCDEFGHIJKLMNOP' } } }, 'looks like a credential');
    bad({ whatsapp: { templates: { X: { ar: { name: '-----BEGIN PRIVATE KEY-----' } } } } }, 'looks like a credential');
  });
  it('secretRefs must be /product/env/purpose paths (a bare value or a ref with other shapes is refused)', () => {
    bad({ channels: { SMS: { secretRefs: { twilio: 'AC123:token' } } } }, 'Secrets Manager path');
    bad({ channels: { SMS: { secretRefs: { twilio: '/only/two' } } } }, 'Secrets Manager path');
    bad({ channels: { SMS: { secretRefs: { twilio: '/Kiorex/Prod/Token' } } } }, 'Secrets Manager path');
    expect(SECRET_PATH.test('/kiorex/staging/whatsapp_token')).toBe(true);
  });
  it('structure and bounds: unknown keys, providers per channel, retry, rate budget, quiet hours, templates, deep links', () => {
    bad({ nope: 1 }, 'unknown key'); bad({ channels: { FAX: {} } }, 'unknown channel'); bad({ channels: { SMS: { providers: ['meta'] } } }, 'is not one of');
    bad({ channels: { SMS: { providers: ['twilio', 'twilio'] } } }, 'duplicate'); bad({ channels: { SMS: { retry: { maxRetries: 50 } } } }, 'maxRetries');
    bad({ channels: { SMS: { retry: { baseDelayMs: 9000, maxDelayMs: 100 } } } }, 'baseDelayMs must not exceed'); bad({ channels: { SMS: { rateBudget: { perSecond: 0 } } } }, 'perSecond');
    bad({ failoverOrder: { MARKETING: ['WHATSAPP', 'SMS'] } }, 'marketing never fails over'); bad({ failoverOrder: { TRANSACTIONAL: ['SMS', 'SMS'] } }, 'distinct');
    bad({ quietHours: { start: '21:30', end: '09:00' } }, 'whole hour'); bad({ quietHours: { timezone: 'Mars/Base' } }, 'IANA');
    bad({ whatsapp: { windowHours: 48 } }, 'windowHours'); bad({ whatsapp: { templates: { booking: { ar: {} } } } }, 'notification kind');
    bad({ whatsapp: { templates: { BOOKING_CONFIRMED: { ar: { name: 'Has Spaces' } } } } }, 'Meta template name');
    bad({ push: { deepLinkSchemes: { evil: 'x' } } }, 'kiorex or kiorly'); bad({ push: { apns: { teamId: 'short' } } }, 'teamId');
    bad({ markets: { egypt: {} } }, 'two-letter'); bad({ markets: { EG: { markets: {} } } }, 'unknown key'); bad({ channels: { EMAIL: { unsubscribe: { baseUrl: 'http://x' } } } }, 'https');
    bad('x', 'must be an object');
  });
});

describe('MESSAGING_CHANNELS config: resolution', () => {
  it('per-market overrides deep-merge over the global payload over the defaults; arrays replace', () => {
    const p = { channels: { SMS: { senderId: 'Kiorex', rateBudget: { perSecond: 5 } } }, failoverOrder: { TRANSACTIONAL: ['WHATSAPP', 'SMS', 'EMAIL'] }, markets: { SA: { channels: { SMS: { senderId: 'KiorexSA' } }, failoverOrder: { TRANSACTIONAL: ['SMS'] } } } } as never;
    const eg = effectiveMessagingConfig(p, 'EG'); const sa = effectiveMessagingConfig(p, 'SA');
    expect(eg.channels!.SMS).toMatchObject({ senderId: 'Kiorex', rateBudget: { perSecond: 5 }, enabled: true, retry: { maxRetries: 2 } });
    expect(sa.channels!.SMS).toMatchObject({ senderId: 'KiorexSA', rateBudget: { perSecond: 5 } });
    expect(failoverOrderFor(sa, 'TRANSACTIONAL')).toEqual(['SMS']); expect(failoverOrderFor(eg, 'TRANSACTIONAL')).toEqual(['WHATSAPP', 'SMS', 'EMAIL']); expect(failoverOrderFor(eg, 'MARKETING')).toEqual([]);
    expect(effectiveMessagingConfig(null).whatsapp!.windowHours).toBe(24); expect(retryFor(eg, 'EMAIL')).toEqual({ maxRetries: 2, baseDelayMs: 250, maxDelayMs: 5000 });
  });
  it('secretRefs resolve from the injected environment only; names are derived, values are never part of the config', () => {
    expect(secretEnvName('/kiorex/prod/whatsapp_token')).toBe('_KIOREX_PROD_WHATSAPP_TOKEN');
    expect(resolveSecretRef('/kiorex/prod/whatsapp_token', { _KIOREX_PROD_WHATSAPP_TOKEN: 'EAAG' })).toBe('EAAG');
    expect(resolveSecretRef('/kiorex/prod/whatsapp_token', {})).toBeNull(); expect(resolveSecretRef('not a path', { 'NOT A PATH': 'x' })).toBeNull();
  });
  it('quiet hours per market: inside (wrapping midnight) -> end instant; outside or channel not listed -> null; correct on the Cairo DST night', () => {
    const c = effectiveMessagingConfig({ quietHours: { start: '21:00', end: '09:00', timezone: 'Africa/Cairo', channels: ['WHATSAPP', 'SMS'] } } as never);
    const at = (iso: string) => Date.parse(iso);
    expect(quietUntil(c, 'WHATSAPP', at('2026-11-25T20:00:00Z'))).toBe(at('2026-11-26T07:00:00Z')); // 22:00 Cairo (UTC+2 in November) -> ends 09:00 Cairo = 07:00Z
    expect(quietUntil(c, 'WHATSAPP', at('2026-11-25T10:00:00Z'))).toBeNull(); // 12:00 Cairo
    expect(quietUntil(c, 'EMAIL', at('2026-11-25T20:00:00Z'))).toBeNull();
    expect(quietUntil(c, 'SMS', at('2026-07-10T19:30:00Z'))).toBe(at('2026-07-11T06:00:00Z')); // 22:30 Cairo (UTC+3 in July) -> 09:00 Cairo = 06:00Z
    const sa = effectiveMessagingConfig({ markets: { SA: { quietHours: { start: '23:00', end: '08:00', timezone: 'Asia/Riyadh' } } } } as never, 'SA');
    expect(quietUntil(sa, 'PUSH', at('2026-11-25T21:00:00Z'))).toBe(at('2026-11-26T05:00:00Z'));
  });
});

describe('provider selection (env-only mode, configurable order, secretRef credentials)', () => {
  const env = { SMS_MODE: 'real', SMS_PROVIDER: 'aggregator', SMS_API_URL: 'https://sms.agg.example', SMS_API_KEY: 'envuser:envpass', SMS_SENDER_ID: 'Kiorex', SMS_WEBHOOK_SECRET: 'dlr_secret_0123456789', SMS_TWILIO_API_URL: '', _KIOREX_PROD_SMS_TWILIO: 'ACabc:authtoken', SMS_TWILIO_WEBHOOK_SECRET: 'twilio_secret_0123456', SMS_TWILIO_WEBHOOK_PUBLIC_URL: 'https://api.kiorex.test/api/v1/messaging/webhooks/sms/twilio' };
  const cfg = effectiveMessagingConfig({ channels: { SMS: { providers: ['aggregator', 'twilio'], secretRefs: { twilio: '/kiorex/prod/sms_twilio' } } } } as never);
  it('order comes from config, defaults to the env provider; credentials from the secretRef win over env; a secondary provider reads its own variables', () => {
    expect(providerOrder('SMS', cfg, env)).toEqual(['aggregator', 'twilio']); expect(providerOrder('SMS', effectiveMessagingConfig(null), env)).toEqual(['aggregator']);
    expect(providerEnvFor('SMS', 'aggregator', cfg, env)).toMatchObject({ provider: 'aggregator', apiKey: 'envuser:envpass', apiUrl: 'https://sms.agg.example' });
    expect(providerEnvFor('SMS', 'twilio', cfg, env)).toMatchObject({ provider: 'twilio', apiKey: 'ACabc:authtoken', apiUrl: 'https://api.twilio.com', senderId: 'Kiorex', webhookSecret: 'twilio_secret_0123456' });
    expect(providerProblemsFor('SMS', 'twilio', cfg, env)).toEqual([]); expect(providerProblemsFor('SMS', 'aggregator', cfg, env)).toEqual([]);
    expect(providerProblemsFor('SMS', 'twilio', cfg, { ...env, _KIOREX_PROD_SMS_TWILIO: '' }).join()).toContain('SMS_TWILIO_API_KEY');
  });
  it('configuration can never switch a channel to real: mode is env-only', () => {
    expect(providerEnvFor('SMS', 'twilio', cfg, { ...env, SMS_MODE: 'mock' }).mode).toBe('mock');
  });
});

describe('adapter chains and failover', () => {
  const m: OutboundMessage = { channel: 'SMS', to: '+201001234567', templateId: 'T', locale: 'en', body: 'x' };
  const fake = (r: Partial<ReturnType<MessagingAdapter['send']> extends Promise<infer R> ? R : never>, calls: string[] = [], name = 'a'): MessagingAdapter => ({ channel: 'SMS', mode: 'real', send: async () => { calls.push(name); return { ok: false, providerRef: '', ...r } as never; } });
  it('provider-level failures move to the next provider; a rejected recipient or a bad request does not', async () => {
    for (const [err, next] of [['PROVIDER_TIMEOUT', true], ['PROVIDER_PROVIDER_UNAVAILABLE_503', true], ['PROVIDER_RATE_LIMITED_429', true], ['PROVIDER_UNAUTHORIZED_401', true], ['THROTTLED', true], ['PROVIDER_ERROR', true], ['PROVIDER_INVALID_REQUEST_400', false], ['PROVIDER_REJECTED_404', false]] as const) {
      const calls: string[] = []; const secondary: MessagingAdapter = { channel: 'SMS', mode: 'real', send: async () => { calls.push('b'); return { ok: true, providerRef: 'B1' }; } };
      const f = new FailoverAdapter('SMS', [{ provider: 'aggregator', adapter: fake({ error: err }, calls, 'a') }, { provider: 'twilio', adapter: secondary }]);
      const r = await f.send(m);
      expect(r.ok).toBe(next); expect(calls).toEqual(next ? ['a', 'b'] : ['a']); if (next) expect(r).toMatchObject({ provider: 'twilio', providerRef: 'B1' });
    }
    const calls: string[] = [];
    const f = new FailoverAdapter('SMS', [{ provider: 'a', adapter: fake({ error: 'PROVIDER_TIMEOUT', recipientRejected: true }, calls) }, { provider: 'b', adapter: fake({}, calls, 'b') }]);
    expect((await f.send(m)).ok).toBe(false); expect(calls).toEqual(['a']);
    const thrower: MessagingAdapter = { channel: 'SMS', mode: 'real', send: async () => { throw new Error('NEEDS_HUMAN: boom'); } };
    expect(await new FailoverAdapter('SMS', [{ provider: 'a', adapter: thrower }, { provider: 'b', adapter: { channel: 'SMS', mode: 'real', send: async () => ({ ok: true, providerRef: 'ok' }) } }]).send(m)).toMatchObject({ ok: true, provider: 'b' });
  });
  it('createMessagingAdapter: mock by default; real with config order builds a chain, drops unconfigured providers, and fails closed with none', () => {
    const saved = { ...process.env };
    try {
      for (const k of Object.keys(process.env)) if (/^(SMS|EMAIL|WHATSAPP|PUSH)_|^MESSAGING_MODE$|^_KIOREX/.test(k)) delete process.env[k];
      expect(createMessagingAdapter('SMS')).toBeInstanceOf(MockAdapter);
      Object.assign(process.env, { SMS_MODE: 'real', SMS_PROVIDER: 'aggregator', SMS_API_URL: 'https://sms.agg.example', SMS_API_KEY: 'u:p', SMS_SENDER_ID: 'Kiorex', SMS_WEBHOOK_SECRET: 'dlr_secret_0123456789', _KIOREX_PROD_SMS_TWILIO: 'ACabc:tok', SMS_TWILIO_WEBHOOK_SECRET: 'twilio_secret_0123456', SMS_TWILIO_WEBHOOK_PUBLIC_URL: 'https://api.kiorex.test/x' });
      const chain = effectiveMessagingConfig({ channels: { SMS: { providers: ['aggregator', 'twilio'], secretRefs: { twilio: '/kiorex/prod/sms_twilio' } } } } as never);
      const un = (x: unknown) => (x instanceof ApprovalGatedAdapter ? x.unwrapped : x);
      const a = un(createMessagingAdapter('SMS', { config: chain })); expect(a).toBeInstanceOf(FailoverAdapter); expect((a as FailoverAdapter).providers).toEqual(['aggregator', 'twilio']);
      delete process.env._KIOREX_PROD_SMS_TWILIO; expect(un(createMessagingAdapter('SMS', { config: chain }))).toBeInstanceOf(HttpMessagingAdapter); // twilio lost its key: dropped, aggregator remains
      delete process.env.SMS_API_KEY; expect(createMessagingAdapter('SMS', { config: chain })).toBeInstanceOf(UnconfiguredAdapter);
    } finally { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); }
  });
});
