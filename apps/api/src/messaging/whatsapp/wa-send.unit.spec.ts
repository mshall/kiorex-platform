import { effectiveMessagingConfig } from '../messaging-config';
import { providerEnv } from '../../common/providers/env';
import { MetaWhatsappAdapter } from './meta.adapter';
import { buildDef, MSG_TEST, WaTemplateRegistry, templatesCsv, type WaStatus } from './wa-templates';
import { decideWhatsappSend, MemoryWaWindowStore, windowState } from './wa-window';

const H = 3_600_000;
const T0 = Date.UTC(2026, 10, 25, 9, 0, 0);
const env = providerEnv('WHATSAPP', { WHATSAPP_MODE: 'real', WHATSAPP_PROVIDER: 'meta', WHATSAPP_API_KEY: 'EAAGtoken', WHATSAPP_SENDER_ID: '106540352242922', WHATSAPP_WEBHOOK_SECRET: 'app_secret_0123456789ab', WHATSAPP_VERIFY_TOKEN: 'vt' });

describe('24 h customer-service window (injected clock)', () => {
  it('open for exactly 24 hours after the last inbound, then closed; a stamp from the future is not trusted', () => {
    expect(windowState(T0, T0 + 23 * H + 59 * 60_000)).toMatchObject({ open: true, remainingMs: 60_000 });
    expect(windowState(T0, T0 + 24 * H).open).toBe(false);
    expect(windowState(T0, T0 + 25 * H)).toEqual({ open: false, closesAtMs: T0 + 24 * H, remainingMs: 0 });
    expect(windowState(null, T0).open).toBe(false);
    expect(windowState(T0 + 5 * H, T0).open).toBe(false);
    expect(windowState(T0, T0 + 5 * H, 4).open).toBe(false); // configurable (never above 24)
  });
  it('a replayed old inbound never shrinks the window', async () => {
    const s = new MemoryWaWindowStore();
    await s.touch('+201001234567', T0 + 10 * H); await s.touch('+201001234567', T0);
    expect(await s.lastInboundMs('+201001234567')).toBe(T0 + 10 * H);
  });
  it('decision table', () => {
    const d = (o: Partial<Parameters<typeof decideWhatsappSend>[0]>) => decideWhatsappSend({ interactive: false, windowOpen: false, templateAvailable: false, templateQuickReplyFits: false, conversational: false, ...o });
    expect(d({ interactive: true, windowOpen: true })).toEqual({ mode: 'SESSION_INTERACTIVE' });
    expect(d({ interactive: true, windowOpen: false })).toEqual({ refuse: 'WA_WINDOW_CLOSED' });
    expect(d({ interactive: true, templateAvailable: true, templateQuickReplyFits: true })).toEqual({ mode: 'TEMPLATE_QUICK_REPLY' });
    expect(d({ interactive: true, templateAvailable: true, templateQuickReplyFits: false })).toEqual({ refuse: 'WA_WINDOW_CLOSED' });
    expect(d({ conversational: true, windowOpen: true, templateAvailable: true })).toEqual({ mode: 'SESSION_TEXT' });
    expect(d({ windowOpen: true, templateAvailable: true })).toEqual({ mode: 'TEMPLATE' }); // notifications keep the approved wording
    expect(d({ templateAvailable: true })).toEqual({ mode: 'TEMPLATE' });
    expect(d({ windowOpen: true })).toEqual({ mode: 'SESSION_TEXT' });
    expect(d({})).toEqual({ refuse: 'WA_NO_TEMPLATE' });
    expect(d({ conversational: true })).toEqual({ refuse: 'WA_WINDOW_CLOSED' });
  });
});

describe('template registry', () => {
  const src = {
    BOOKING_CONFIRMED: { templateId: 'TODO_NEEDS_HUMAN_booking_confirmed', en: 'Your visit with {doctor} is confirmed for {time}.', ar: 'تم تأكيد زيارتك مع {doctor} في {time}.' },
    REMINDER_24H: { templateId: 'TODO_NEEDS_HUMAN_reminder_24h', reminder: true, en: 'Reminder: {doctor} at {time}.', ar: 'تذكير: {time} مع {doctor}.' },
    WINBACK: { templateId: 'TODO_NEEDS_HUMAN_winback', marketing: true, en: 'We miss you.', ar: 'وحشتنا.' },
  };
  const reg = () => { const r = new WaTemplateRegistry({}); r.load(src); return r; };
  it('names, per-language {{n}} numbering by first appearance, categories and examples', () => {
    const ar = reg().resolve('TODO_NEEDS_HUMAN_reminder_24h', 'ar')!;
    expect(ar).toMatchObject({ metaName: 'kx_reminder_24h_v1', body: 'تذكير: {{1}} مع {{2}}.', paramOrder: ['time', 'doctor'], category: 'UTILITY', language: 'ar' });
    expect(reg().resolve('REMINDER_24H', 'en')).toMatchObject({ body: 'Reminder: {{1}} at {{2}}.', paramOrder: ['doctor', 'time'] });
    expect(reg().resolve('WINBACK', 'en')!.category).toBe('MARKETING');
    expect(reg().resolve('NOPE', 'en')).toBeNull();
    expect(buildDef('X', { templateId: 'x', en: 'Hi {doctor}', ar: 'ا' }, 'en').examples).toEqual(['Dr. Sample']);
  });
  it('parameters are ordered per language and a missing value is named, never defaulted', () => {
    const def = reg().resolve('BOOKING_CONFIRMED', 'ar')!;
    expect(WaTemplateRegistry.params(def, { doctor: 'د. أمل', time: 'الاثنين 10:30' })).toEqual({ values: ['د. أمل', 'الاثنين 10:30'] });
    expect(WaTemplateRegistry.params(def, { doctor: 'x' })).toEqual({ missing: 'time' });
  });
  it('configuration overrides name, category and enabled; the legacy WHATSAPP_TEMPLATE_MAP still works', () => {
    const r = new WaTemplateRegistry({ WHATSAPP_TEMPLATE_MAP: JSON.stringify({ TODO_NEEDS_HUMAN_booking_confirmed: 'legacy_name' }) }); r.load(src);
    expect(r.resolve('BOOKING_CONFIRMED', 'en')!.metaName).toBe('legacy_name');
    r.configure({ templates: { BOOKING_CONFIRMED: { en: { name: 'kx_booking_ok_v2', category: 'UTILITY' } }, REMINDER_24H: { ar: { enabled: false } } } });
    expect(r.resolve('BOOKING_CONFIRMED', 'en')!.metaName).toBe('kx_booking_ok_v2');
    expect(r.resolve('REMINDER_24H', 'ar')!.enabled).toBe(false);
    expect(r.exportForSubmission().some((x) => x.key === 'REMINDER_24H' && x.language === 'ar')).toBe(false);
  });
  it('submit-for-approval export has one Graph payload per template and language, plus the ops test template', () => {
    const ex = reg().exportForSubmission();
    expect(ex).toHaveLength((3 + 1) * 2);
    const one = ex.find((x) => x.key === 'BOOKING_CONFIRMED' && x.language === 'en')!;
    expect(one.submission).toEqual({ name: 'kx_booking_confirmed_v1', language: 'en', category: 'UTILITY', components: [{ type: 'BODY', text: 'Your visit with {{1}} is confirmed for {{2}}.', example: { body_text: [['Dr. Sample', 'Mon 12 Jan 10:00']] } }] });
    expect(ex.every((x) => /^[a-z][a-z0-9_]{0,511}$/.test(x.metaName))).toBe(true);
    expect(templatesCsv([{ key: 'A', language: 'en', metaName: 'kx_a_v1', category: 'UTILITY', body: 'say "hi"' }])).toBe('key,language,metaName,category,status,body\nA,en,kx_a_v1,UTILITY,DRAFT,"say ""hi"""');
    expect(MSG_TEST.templateId).toBe('MSG_TEST');
  });
});

/** Meta adapter against a scripted fake Graph API (no network). */
function harness(o: { status?: Record<string, WaStatus>; now?: () => number; lastInbound?: number | null } = {}) {
  const calls: Array<{ url: string; body: any; headers: Record<string, string> }> = [];
  let script: Array<{ status?: number; json: unknown }> = [];
  const events: unknown[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body)), headers: init?.headers as Record<string, string> });
    const r = script.shift() ?? { json: { messages: [{ id: `wamid.OUT_${calls.length}` }] } };
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  };
  const window = new MemoryWaWindowStore();
  const templates = new WaTemplateRegistry({}); templates.load({ BOOKING_CONFIRMED: { templateId: 'TODO_NEEDS_HUMAN_booking_confirmed', en: 'Your visit with {doctor} is confirmed for {time}.', ar: 'تم تأكيد زيارتك مع {doctor} في {time}.' } });
  const status = { get: async (n: string) => (o.status?.[n] ? { status: o.status[n] } : null), apply: async () => true, upsertDefinition: async () => undefined };
  const now = o.now ?? (() => T0);
  const a = new MetaWhatsappAdapter({ env, http: { fetchImpl: fetchImpl as never, sleep: async () => undefined, random: () => 0 }, window, templates, status, now, onState: (e) => events.push(e) });
  if (o.lastInbound !== null && o.lastInbound !== undefined) void window.touch('+201001234567', o.lastInbound);
  return { a, calls, events, window, set: (s: typeof script) => { script = s; } };
}
const cfg = effectiveMessagingConfig(undefined);
const msg = (p: object = {}) => ({ channel: 'WHATSAPP' as const, to: '+201001234567', templateId: 'TODO_NEEDS_HUMAN_booking_confirmed', locale: 'ar', body: 'تم تأكيد زيارتك مع د. أمل في الاثنين 10:30.', variables: { doctor: 'د. أمل', time: 'الاثنين 10:30' }, messageId: 'm1', ...p });
const send = (h: ReturnType<typeof harness>, m: object = {}) => h.a.send(msg(m), { config: cfg, market: 'EG', now: T0 });

describe('Meta adapter: session vs template vs interactive (window decided from the stored inbound time)', () => {
  it('notification outside the window: approved template with ordered parameters, bearer token, graph path with the phone-number id', async () => {
    const h = harness({ lastInbound: T0 - 30 * H });
    const r = await send(h);
    expect(r).toMatchObject({ ok: true, providerRef: 'wamid.OUT_1', provider: 'meta' });
    expect(h.calls[0].url).toBe('https://graph.facebook.com/v21.0/106540352242922/messages');
    expect(h.calls[0].headers.authorization).toBe('Bearer EAAGtoken');
    expect(h.calls[0].body).toMatchObject({ type: 'template', to: '201001234567', template: { name: 'kx_booking_confirmed_v1', language: { code: 'ar' }, components: [{ type: 'body', parameters: [{ text: 'د. أمل' }, { text: 'الاثنين 10:30' }] }] } });
  });
  it('conversational reply inside the window: free text (no template needed); outside it: refused with a stable code and NO call', async () => {
    const open = harness({ lastInbound: T0 - 2 * H });
    expect(await send(open, { templateId: 'ASSISTANT_REPLY', conversational: true, variables: undefined })).toMatchObject({ ok: true });
    expect(open.calls[0].body).toMatchObject({ type: 'text', text: { body: expect.stringContaining('تم تأكيد') } });
    const closed = harness({ lastInbound: T0 - 25 * H });
    expect(await send(closed, { templateId: 'ASSISTANT_REPLY', conversational: true })).toMatchObject({ ok: false, error: 'WA_WINDOW_CLOSED', retryable: false });
    expect(closed.calls).toHaveLength(0);
    const never = harness();
    expect(await send(never, { templateId: 'NO_SUCH_TEMPLATE' })).toMatchObject({ ok: false, error: 'WA_NO_TEMPLATE' });
  });
  it('INTERACTIVE buttons inside the window: payload goes out untouched; outside the window they are refused, never degraded to text', async () => {
    const payload = 'CONFIRM:hold_9f3a:Zk3p9QxT1mN8vB2cD4eF6g';
    const h = harness({ lastInbound: T0 - H });
    const r = await send(h, { templateId: 'ASSISTANT_CONFIRM', conversational: true, data: { buttons: [{ id: payload, title: 'تأكيد' }, { id: 'DECLINE:hold_9f3a:Zk3p9QxT1mN8vB2cD4eF6g', title: 'إلغاء' }] } });
    expect(r.ok).toBe(true);
    expect(h.calls[0].body.interactive.action.buttons[0]).toEqual({ type: 'reply', reply: { id: payload, title: 'تأكيد' } });
    const c = harness({ lastInbound: T0 - 26 * H });
    expect(await send(c, { templateId: 'ASSISTANT_CONFIRM', data: { buttons: [{ id: payload, title: 'تأكيد' }] } })).toMatchObject({ ok: false, error: 'WA_WINDOW_CLOSED' });
    expect(c.calls).toHaveLength(0);
    expect(await send(h, { data: { buttons: [{ id: 'x'.repeat(300), title: 'a' }] } })).toMatchObject({ ok: false, error: 'WA_BUTTON_ID_TOO_LONG', retryable: false });
  });
  it('an unapproved (REJECTED / PAUSED / DISABLED) template fails fast without calling Meta; PENDING and APPROVED go through', async () => {
    for (const st of ['REJECTED', 'PAUSED', 'DISABLED'] as WaStatus[]) {
      const h = harness({ status: { kx_booking_confirmed_v1: st } });
      expect(await send(h)).toMatchObject({ ok: false, error: 'WA_TEMPLATE_NOT_APPROVED' }); expect(h.calls).toHaveLength(0);
    }
    expect((await send(harness({ status: { kx_booking_confirmed_v1: 'APPROVED' } }))).ok).toBe(true);
  });
  it('a missing template parameter is a clean refusal, not a half-filled message', async () => {
    const h = harness();
    expect(await send(h, { variables: { doctor: 'x' } })).toMatchObject({ ok: false, error: 'WA_TEMPLATE_PARAM_MISSING' }); expect(h.calls).toHaveLength(0);
  });
  it('window drift: Meta says 131047 although we thought the window was open -> one retry as an approved template', async () => {
    const h = harness({ lastInbound: T0 - H });
    h.set([{ status: 400, json: { error: { code: 131047, message: 'Re-engagement message' } } }]);
    const r = await send(h, { conversational: true });
    expect(r.ok).toBe(true); expect(h.calls).toHaveLength(2); expect(h.calls[0].body.type).toBe('text'); expect(h.calls[1].body.type).toBe('template');
  });
  it('sender (phone-number id) comes from the per-market configuration when set', async () => {
    const h = harness();
    await h.a.send(msg(), { config: effectiveMessagingConfig({ markets: { SA: { channels: { WHATSAPP: { senderId: '999000111' } } } } }, 'SA'), market: 'SA', now: T0 });
    expect(h.calls[0].url).toBe('https://graph.facebook.com/v21.0/999000111/messages');
  });
});

describe('Meta adapter: quality, rate limit and tier handling', () => {
  it('throttle codes (130429 / 131056 / 131048 / 80007) close the channel, walk the backoff ladder and reopen with the clock; one success resets it', async () => {
    let t = T0; const h = harness({ now: () => t });
    for (const code of [130429, 131056]) {
      h.set([{ status: 400, json: { error: { code, message: 'x' } } }]);
      expect(await send(h)).toMatchObject({ ok: false, error: `THROTTLED:META_${code}`, retryable: true });
      expect(await send(h)).toMatchObject({ ok: false, error: 'THROTTLED' }); // closed: no call
      t += code === 130429 ? 31_000 : 121_000; // first step 30 s, second step 120 s
    }
    expect(h.calls).toHaveLength(2);
    expect(h.events.filter((e: any) => e.type === 'THROTTLE')).toHaveLength(2);
    expect((await send(h)).ok).toBe(true);
  });
  it('a refused token (190) is not retried and raises AUTH_FAILED for ops; bad recipient (131026) is final', async () => {
    const h = harness();
    h.set([{ status: 401, json: { error: { code: 190, message: 'expired' } } }]);
    expect(await send(h)).toMatchObject({ ok: false, error: 'META_190', retryable: false });
    expect(h.events).toContainEqual({ type: 'AUTH_FAILED', code: '190' });
    h.set([{ status: 400, json: { error: { code: 131026 } } }]);
    expect(await send(h)).toMatchObject({ ok: false, error: 'META_131026', recipientRejected: true, retryable: false });
  });
  it('rate budget refuses over the per-second limit without calling Meta', async () => {
    const h = harness();
    const tight = effectiveMessagingConfig({ channels: { WHATSAPP: { rateBudget: { perSecond: 2 } } } });
    const r = await Promise.all([1, 2, 3].map(() => h.a.send(msg(), { config: tight, market: 'EG', now: T0 })));
    expect(r.map((x) => x.ok)).toEqual([true, true, false]); expect(r[2].error).toBe('RATE_BUDGET'); expect(h.calls).toHaveLength(2);
  });
  it('messaging tier from a quality webhook caps the unique people messaged outside the window per 24 h (returning people are not new conversations)', async () => {
    let t = T0; const h = harness({ now: () => t }); h.a.setTier('TIER_50');
    const loose = effectiveMessagingConfig({ channels: { WHATSAPP: { rateBudget: { perSecond: 1000, perDay: 100000 } } } });
    const to = (i: number) => `+2010000${String(i).padStart(5, '0')}`;
    for (let i = 0; i < 50; i++) expect((await h.a.send(msg({ to: to(i) }), { config: loose, market: 'EG', now: t })).ok).toBe(true);
    expect(await h.a.send(msg({ to: to(99) }), { config: loose, market: 'EG', now: t })).toMatchObject({ ok: false, error: 'WA_TIER_LIMIT', retryable: true });
    expect((await h.a.send(msg({ to: to(3) }), { config: loose, market: 'EG', now: t })).ok).toBe(true);
    t += 25 * H; expect((await h.a.send(msg({ to: to(99) }), { config: loose, market: 'EG', now: t })).ok).toBe(true);
  });
});
