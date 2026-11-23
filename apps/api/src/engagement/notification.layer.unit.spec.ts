import { createMockAdapters, MemoryAuditSink, NotificationService, MockChannelAdapter, type ChannelAdapter } from '@kiorex/contracts/notify';
import { HubChannelAdapter, InboxChannelAdapter, flattenBody } from '../messaging/messaging-public';
import { createPlatformRegistry, outcomeOf, PlatformPreferenceStore } from './notification.layer';
import { cfg } from '../common/config';
import { TEMPLATES, render, type NotifyKind } from './templates';

const recipient = { id: 'sub1', phone: '+201001234567', email: 'a@x.com', deviceIds: ['tok'], locale: 'ar' as const };
const sample = { doctor: 'د. عمر', time: '10:00', alternatives: 'د. س', until: '12:00', assignee: 'x', minutes: 5, patient: 'p', link: 'https://x.test/a', status: 'ok', count: 3 };

describe('platform notify registry', () => {
  const registry = createPlatformRegistry();
  it('registers every NotifyKind and renders ar + en on all five channels with the legacy copy', () => {
    expect(registry.types().sort()).toEqual(Object.keys(TEMPLATES).sort());
    for (const [kind, t] of Object.entries(TEMPLATES) as [NotifyKind, (typeof TEMPLATES)[NotifyKind]][]) {
      const allowed = registry.get(kind)!.allowedParams;
      const params = Object.fromEntries(allowed.map((k) => [k, (sample as any)[k] ?? 'x']));
      for (const [locale, text] of [['ar', t.ar], ['en', t.en]] as const) {
        const sms = registry.render(kind, 'SMS', locale, params);
        expect(sms).toEqual({ ok: true, body: { text: render(text, params) } });
        for (const ch of ['EMAIL', 'WHATSAPP', 'PUSH', 'INAPP'] as const) expect(registry.render(kind, ch, locale, params).ok).toBe(true);
        const wa = registry.render(kind, 'WHATSAPP', locale, params) as any;
        expect(wa.body.template.name).toBe(t.templateId);
        expect(flattenBody({ channel: 'WHATSAPP', body: wa.body } as any)).toBe(render(text, params));
      }
    }
  });
  it('rejects params a template did not declare and PHI in a push', () => {
    expect(registry.render('REMINDER_2H', 'SMS', 'en', { doctor: 'a', time: 'b', nationalId: '1' } as any)).toMatchObject({ ok: false, reason: 'PARAM_NOT_ALLOWED' });
    expect(registry.render('REMINDER_2H', 'PUSH', 'en', { doctor: 'Diabetes clinic', time: '1' })).toMatchObject({ ok: false, reason: 'PHI_BLOCKED' });
  });
});

describe('platform notifier end-to-end (fake hub)', () => {
  function setup(over: { consent?: boolean; enabled?: boolean; hour?: number } = {}) {
    const sent: any[] = [];
    const hub: any = {
      channelMode: () => 'mock',
      send: async (m: any) => { sent.push(m); return m.to.endsWith('0000') ? { ok: false, error: 'MOCK_BOUNCE', providerRef: null } : { ok: true, providerRef: `ref_${sent.length}`, error: null }; },
    };
    const prefs = new PlatformPreferenceStore({
      hasConsent: async () => over.consent ?? true,
      preference: async () => (over.enabled === false ? { enabled: false, quietStart: null, quietEnd: null } : null),
    });
    const audit = new MemoryAuditSink();
    const svc = new NotificationService({
      adapters: [new HubChannelAdapter('SMS', hub), new HubChannelAdapter('EMAIL', hub), new HubChannelAdapter('WHATSAPP', hub), new HubChannelAdapter('PUSH', hub), new InboxChannelAdapter()],
      registry: createPlatformRegistry(), preferences: prefs, audit, clock: { now: () => Date.UTC(2026, 10, 23, over.hour ?? 10, 0, 0) },
    });
    const go = (channel: string, kind = 'REMINDER_2H', rec = recipient) => svc.dispatch({ type: kind, recipient: rec, params: Object.fromEntries(createPlatformRegistry().get(kind)!.allowedParams.map((k) => [k, k === 'doctor' ? 'Dr A' : k === 'time' ? '10:00' : '5'])), severity: 'ROUTINE', channels: [channel as any], idempotencyKey: `${kind}:${channel}:${Math.random()}`, metadata: { messageId: 'm1', sub: 'sub1', templateId: 'tpl' } });
    return { sent, svc, go, audit };
  }
  it('sends through the hub with the legacy fields (messageId, sub, templateId, rendered body)', async () => {
    const { sent, go } = setup();
    const s = await go('SMS');
    expect(outcomeOf(s, 'SMS', 'REMINDER')).toEqual({ kind: 'SENT' });
    expect(sent[0]).toMatchObject({ messageId: 'm1', channel: 'SMS', sub: 'sub1', to: '+201001234567', templateId: 'tpl', locale: 'ar', body: 'تذكير: زيارتك مع Dr A بعد ساعتين (10:00).' });
    const push = await go('PUSH');
    expect(sent[1]).toMatchObject({ channel: 'PUSH', to: 'tok' });
    expect(outcomeOf(push, 'PUSH', 'REMINDER').kind).toBe('SENT');
    const inapp = await go('INAPP');
    expect(outcomeOf(inapp, 'INAPP', 'REMINDER').kind).toBe('SENT');
    expect(sent).toHaveLength(2); // the inbox adapter does not touch the hub
  });
  it('maps consent, opt-out, no address, bounce, quiet hours to the legacy statuses', async () => {
    expect(outcomeOf(await setup({ consent: false }).go('SMS'), 'SMS', 'REMINDER')).toEqual({ kind: 'SKIPPED_CONSENT', purpose: 'REMINDERS' });
    expect(outcomeOf(await setup({ consent: false }).go('SMS', 'BOOKING_CONFIRMED'), 'SMS', 'TRANSACTIONAL')).toEqual({ kind: 'SKIPPED_CONSENT', purpose: 'MARKETPLACE_PROCESSING' });
    expect(outcomeOf(await setup({ enabled: false }).go('EMAIL'), 'EMAIL', 'REMINDER')).toEqual({ kind: 'SKIPPED_OPTOUT' });
    const noDev = await setup().go('PUSH', 'REMINDER_2H', { ...recipient, deviceIds: [] });
    expect(outcomeOf(noDev, 'PUSH', 'REMINDER')).toEqual({ kind: 'FAILED', reason: 'NO_DEVICE' });
    const noPhone = await setup().go('SMS', 'REMINDER_2H', { ...recipient, phone: undefined } as any);
    expect(outcomeOf(noPhone, 'SMS', 'REMINDER')).toEqual({ kind: 'FAILED', reason: 'NO_RECIPIENT' });
    const bounce = await setup().go('SMS', 'REMINDER_2H', { ...recipient, phone: '+20100000000' + '0000' });
    expect(outcomeOf(bounce, 'SMS', 'REMINDER')).toEqual({ kind: 'FAILED', reason: 'MOCK_BOUNCE' });
    const phi = await setup().go('PUSH', 'BOOKING_CHANGED');
    expect(outcomeOf(phi, 'PUSH', 'TRANSACTIONAL').kind).toBe('SENT'); // clean params
    const tz = cfg().tzOffsetHours; // 23:00 local, default window 22-08
    const quiet = await setup({ hour: 23 - tz }).go('SMS');
    expect(outcomeOf(quiet, 'SMS', 'REMINDER')).toEqual({ kind: 'DEFERRED', until: new Date(Date.UTC(2026, 10, 24, cfg().quietEnd - tz, 0, 0)) });
    // bypassQuiet templates ignore the window (legacy)
    const bypass = await setup({ hour: 23 - tz }).go('SMS', 'HOME_VISIT_EN_ROUTE');
    expect(outcomeOf(bypass, 'SMS', 'TRANSACTIONAL').kind).toBe('SENT');
  });
  it('an unknown or rejected intent is a FAILED NOTIFY_REJECTED, never a throw', async () => {
    const { svc } = setup();
    const s = await svc.dispatch({ type: 'NOPE', recipient, severity: 'ROUTINE', idempotencyKey: 'x' });
    expect(outcomeOf(s, 'SMS', 'REMINDER')).toEqual({ kind: 'FAILED', reason: 'NOTIFY_REJECTED' });
  });
  it('reports PHI rejections with their code', async () => {
    const { svc } = setup();
    const s = await svc.dispatch({ type: 'REMINDER_2H', recipient, params: { doctor: 'HIV clinic', time: '1' }, severity: 'ROUTINE', channels: ['SMS'], idempotencyKey: 'p' });
    expect(outcomeOf(s, 'SMS', 'REMINDER')).toEqual({ kind: 'FAILED', reason: 'PHI_BLOCKED:DIAGNOSIS' });
  });
});

describe('webhooks through the normalized status', () => {
  it('HubChannelAdapter parses the neutral body via the vendor mapping and verifies HMAC; PUSH has no webhook', () => {
    const hub: any = { channelMode: () => 'mock', send: async () => ({ ok: true }) };
    const sms = new HubChannelAdapter('SMS', hub);
    const body = JSON.stringify({ events: [{ id: 'r1', status: 'delivered', occurredAt: '2026-11-23T10:00:00Z' }, { id: 'r2', status: 'failed', error: 'x' }, { id: 'r3', status: 'weird' }] });
    expect(sms.parseWebhook(body)).toEqual([{ providerRef: 'r1', status: 'DELIVERED', occurredAt: '2026-11-23T10:00:00Z' }, { providerRef: 'r2', status: 'FAILED', error: 'x' }]);
    expect(sms.verify(body, {})).toBe(false); // no signature headers
    const push = new HubChannelAdapter('PUSH', hub);
    expect(push.parseWebhook(body)).toEqual([]);
    expect(push.verify(body, {})).toBe(false);
    expect(sms.mode).toBe('mock');
  });
  it('InboxChannelAdapter acknowledges and has no webhook', async () => {
    const a: ChannelAdapter = new InboxChannelAdapter();
    expect((await a.send({ notificationId: 'n', metadata: { messageId: 'm' } } as any)).providerRef).toBe('inapp:m');
    expect((await a.send({ notificationId: 'n' } as any)).providerRef).toBe('inapp:n');
    expect(a.parseWebhook('{}')).toEqual([]);
    expect(a.verify('{}')).toBe(false);
  });
  it('the layer can run a status webhook end to end with mock adapters', async () => {
    const m = createMockAdapters();
    const svc = new NotificationService({ adapters: Object.values(m), registry: createPlatformRegistry(), preferences: { get: async () => ({}) }, audit: new MemoryAuditSink() });
    await svc.dispatch({ type: 'REMINDER_2H', recipient, params: { doctor: 'a', time: 'b' }, severity: 'ROUTINE', channels: ['SMS'], idempotencyKey: 'w' });
    const r = await svc.handleWebhook('SMS', MockChannelAdapter.webhookBody(m.SMS.lastRef!, 'delivered'), { 'x-mock-signature': 'mock-secret' });
    expect(r).toEqual({ verified: true, applied: 1, ignored: 0 });
  });
});

import { humanizeTimes } from './engagement.service';
describe('humanizeTimes (patient-facing date-times)', () => {
  it('renders ISO date-times in Cairo time and the patient language, leaves everything else alone', () => {
    const out = humanizeTimes({ doctor: 'د. تامر', time: '2026-11-23T16:45:00.000Z', until: '2026-11-23T17:00:00.000Z', count: 3 }, 'en');
    expect(out.time).toMatch(/Mon/);
    expect(out.time).toMatch(/6:45/);
    expect(out.time).not.toMatch(/2026-11-23T/);
    expect(out.doctor).toBe('د. تامر');
    expect(out.count).toBe(3);
    expect(humanizeTimes({ time: '2026-11-23T16:45:00.000Z' }, 'ar').time).not.toMatch(/T16/);
  });
});
