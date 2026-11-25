import { bypassProblem, gateErrorCode, realModeGate, setApprovedModesSource } from '../common/providers/real-mode-gate';
import { ApprovalGatedAdapter, createMessagingAdapter, HttpMessagingAdapter, integrationKeyFor, MockAdapter, PushAdapter, UnconfiguredAdapter } from './adapters';
import type { MessagingAdapter, OutboundMessage } from './messaging.types';

const base = { NODE_ENV: 'test' } as Record<string, string | undefined>;
afterEach(() => setApprovedModesSource(undefined));

describe('real-mode approval gate (launch guide 13.4)', () => {
  it('nothing is approved without a source; an approved record allows only the keys it names', () => {
    expect(realModeGate('SMS', base).allowed).toBe(false);
    expect(realModeGate('SMS', base).reason).toMatch(/^NEEDS_HUMAN: SMS real mode is not approved/);
    setApprovedModesSource(() => ({ SMS: 'real', EMAIL: 'mock' }));
    expect(realModeGate('SMS', base).allowed).toBe(true); expect(realModeGate('EMAIL', base).allowed).toBe(false); expect(realModeGate('WHATSAPP_CLOUD', base).allowed).toBe(false);
    setApprovedModesSource(() => { throw new Error('boom'); }); expect(realModeGate('SMS', base).allowed).toBe(false); // a failing reader fails closed
  });
  it('dev/test exemption only through the explicit flag and never in production', () => {
    expect(realModeGate('SMS', { ...base, INTEGRATION_MODE_GATE_BYPASS: 'true' }).allowed).toBe(true);
    expect(realModeGate('SMS', { ...base, INTEGRATION_MODE_GATE_BYPASS: '1' }).allowed).toBe(false);
    expect(realModeGate('SMS', { NODE_ENV: 'production', INTEGRATION_MODE_GATE_BYPASS: 'true' }).allowed).toBe(false);
    expect(bypassProblem({ NODE_ENV: 'production', INTEGRATION_MODE_GATE_BYPASS: 'true' })).toContain('not allowed in production'); expect(bypassProblem({ NODE_ENV: 'test', INTEGRATION_MODE_GATE_BYPASS: 'true' })).toBeNull();
    setApprovedModesSource(() => ({ SMS: 'real' })); expect(realModeGate('SMS', { NODE_ENV: 'production', INTEGRATION_MODE_GATE_BYPASS: 'true' }).allowed).toBe(true); // approved wins regardless
  });
});

describe('messaging adapters honour the gate', () => {
  const m = (o: Partial<OutboundMessage> = {}): OutboundMessage => ({ channel: 'SMS', to: '+201001234567', templateId: 'T', locale: 'en', body: 'x', ...o });
  it('keys: WhatsApp Cloud, SMS, EMAIL, and push by token shape', () => {
    expect(integrationKeyFor('WHATSAPP')).toBe('WHATSAPP_CLOUD'); expect(integrationKeyFor('SMS')).toBe('SMS'); expect(integrationKeyFor('EMAIL')).toBe('EMAIL');
    expect(integrationKeyFor('PUSH', 'ExponentPushToken[a]')).toBe('PUSH_EXPO'); expect(integrationKeyFor('PUSH', 'a'.repeat(64))).toBe('PUSH_APNS'); expect(integrationKeyFor('PUSH', 'fcm:token')).toBe('PUSH_FCM');
  });
  it('a real adapter without approval returns NEEDS_HUMAN and never calls the inner adapter; approval opens it; withdrawal closes it again at once', async () => {
    const saved = process.env.INTEGRATION_MODE_GATE_BYPASS; delete process.env.INTEGRATION_MODE_GATE_BYPASS;
    try {
      let calls = 0; const inner: MessagingAdapter = { channel: 'SMS', mode: 'real', send: async () => { calls++; return { ok: true, providerRef: 'r' }; } };
      const g = new ApprovalGatedAdapter(inner);
      expect(await g.send(m())).toEqual({ ok: false, providerRef: '', error: gateErrorCode('SMS'), retryable: false }); expect(calls).toBe(0);
      let approved = true; setApprovedModesSource(() => (approved ? { SMS: 'real' } : {}));
      expect((await g.send(m())).ok).toBe(true); approved = false; expect((await g.send(m())).ok).toBe(false); expect(calls).toBe(1);
      const push: MessagingAdapter = { channel: 'PUSH', mode: 'real', send: async () => ({ ok: true, providerRef: 'p' }) };
      setApprovedModesSource(() => ({ PUSH_EXPO: 'real' }));
      const pg = new ApprovalGatedAdapter(push);
      expect((await pg.send(m({ channel: 'PUSH', to: 'ExponentPushToken[a]' }))).ok).toBe(true); expect((await pg.send(m({ channel: 'PUSH', to: 'fcm-token' }))).error).toBe(gateErrorCode('PUSH_FCM'));
    } finally { if (saved !== undefined) process.env.INTEGRATION_MODE_GATE_BYPASS = saved; }
  });
  it('createMessagingAdapter: mock is never gated; real is gated; a misconfigured real channel stays the fail-closed Unconfigured adapter', () => {
    const saved = { ...process.env };
    try {
      for (const k of Object.keys(process.env)) if (/^(SMS|EMAIL|WHATSAPP|PUSH)_|^MESSAGING_MODE$/.test(k)) delete process.env[k];
      expect(createMessagingAdapter('SMS')).toBeInstanceOf(MockAdapter);
      expect(createMessagingAdapter('PUSH')).toBeInstanceOf(MockAdapter);
      Object.assign(process.env, { SMS_MODE: 'real' }); expect(createMessagingAdapter('SMS')).toBeInstanceOf(UnconfiguredAdapter);
      Object.assign(process.env, { SMS_API_URL: 'https://sms.example', SMS_API_KEY: 'k', SMS_SENDER_ID: 'K', SMS_WEBHOOK_SECRET: 'dlr_secret_0123456789' });
      const a = createMessagingAdapter('SMS'); expect(a).toBeInstanceOf(ApprovalGatedAdapter); expect((a as ApprovalGatedAdapter).unwrapped).toBeInstanceOf(HttpMessagingAdapter);
      Object.assign(process.env, { PUSH_MODE: 'real', PUSH_EXPO_ENABLED: 'true' }); const p = createMessagingAdapter('PUSH'); expect((p as ApprovalGatedAdapter).unwrapped).toBeInstanceOf(PushAdapter);
    } finally { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); }
  });
});
