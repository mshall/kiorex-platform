import { createHash } from 'node:crypto';
import { outboundFetch } from '../common/outbound-http';
import { providerEnv } from '../common/providers/env';
import { HttpMessagingTransport, messagingKindOf, type MessagingKind } from '../common/providers/real-adapters';
import type { HttpDeps } from '../common/providers/http';
import { gateErrorCode, realModeGate } from '../common/providers/real-mode-gate';
import { buildDeepLink, isExpoToken, PushSender, pushConfigFromEnv, pushProblems, type PushConfig } from '../common/providers/vendors/push';
import { effectiveMessagingConfig } from './messaging-config';
import { providerEnvFor, providerOrder, providerProblemsFor } from './provider-select';
import { BackoffGate, RateBudget, type Clock } from './throttle';
import { MessagingAdapter, MsgChannel, OutboundMessage, SendContext, SendResult } from './messaging.types';
import { isApnsToken } from '../common/providers/vendors/apns';
import { MetaWhatsappAdapter, type MetaAdapterDeps } from './whatsapp/meta.adapter';

/**
 * MODE=mock adapter: deterministic fake provider. Exercises the same path as a real one (template rendered upstream,
 * consent checked upstream, DB log, delivery states). Recipients ending in `0000` simulate a hard bounce.
 */
export class MockAdapter implements MessagingAdapter {
  readonly mode = 'mock' as const;
  constructor(public readonly channel: MsgChannel) {}
  async send(m: OutboundMessage): Promise<SendResult> {
    if (m.to.endsWith('0000')) return { ok: false, providerRef: '', error: 'MOCK_BOUNCE' };
    return { ok: true, providerRef: `mock_${this.channel.toLowerCase()}_${createHash('sha1').update(`${m.messageId ?? ''}${m.to}${m.templateId}${Date.now()}`).digest('hex').slice(0, 12)}` };
  }
}

/** Failure classes of the generic HTTP transport (stored error codes, see common/providers/http.ts). */
export function classifyTransportError(error: string | undefined): { retryable: boolean; providerLevel: boolean } {
  const e = error ?? '';
  return {
    providerLevel: /^PROVIDER_(TIMEOUT|NETWORK|RATE_LIMITED|UNAUTHORIZED|PROVIDER_UNAVAILABLE|BAD_RESPONSE)|^THROTTLED|^RATE_BUDGET|NOT_CONFIGURED|^PROVIDER_ERROR/.test(e),
    retryable: /^PROVIDER_(TIMEOUT|NETWORK|RATE_LIMITED|PROVIDER_UNAVAILABLE)|^THROTTLED|^RATE_BUDGET/.test(e),
  };
}

/**
 * MODE=real adapter for SMS / EMAIL / WHATSAPP (gateway wire format, Twilio, SES, the config-driven Egyptian aggregator): provider chosen by env + MESSAGING_CHANNELS config,
 * driven by the vendor mapping. Adds per-market sender id, retry policy from config, a rate budget, a throttle gate and the unsubscribe rule for marketing e-mail.
 */
export class HttpMessagingAdapter implements MessagingAdapter {
  readonly mode = 'real' as const;
  private readonly budgets = new Map<string, RateBudget>();
  private readonly gate: BackoffGate;
  constructor(public readonly channel: MsgChannel, private readonly deps: HttpDeps = { fetchImpl: outboundFetch }, public readonly provider?: string, now: Clock = Date.now) {
    this.gate = new BackoffGate([30, 120, 600], now);
    this.now = now;
  }
  private readonly now: Clock;
  async send(m: OutboundMessage, ctx?: SendContext): Promise<SendResult> {
    const kind = messagingKindOf(this.channel)!;
    const cfg = ctx?.config ?? effectiveMessagingConfig(undefined, m.market);
    const provider = this.provider ?? providerEnv(kind).provider;
    const fail = (error: string): SendResult => ({ ok: false, providerRef: '', error }); // same shape as before MSG-REAL: `retryable` is derived by the hub from the stored error code
    if (cfg.channels?.[this.channel]?.enabled === false) return fail('CHANNEL_DISABLED');
    const env = providerEnvFor(kind, provider, cfg);
    const unsub = cfg.channels?.EMAIL?.unsubscribe;
    // compliance: marketing e-mail never leaves without a one-click unsubscribe (RFC 8058); transactional mail never carries the header
    const marketingMail = this.channel === 'EMAIL' && m.messageClass === 'MARKETING';
    if (marketingMail && !m.unsubscribeUrl) return fail('EMAIL_UNSUBSCRIBE_MISSING');
    if (this.gate.remainingMs() > 0) return fail('THROTTLED');
    const b = cfg.channels?.[this.channel]?.rateBudget ?? {};
    const bk = `${provider}|${b.perSecond ?? ''}|${b.perMinute ?? ''}|${b.perDay ?? ''}`;
    let budget = this.budgets.get(bk); if (!budget) { budget = new RateBudget(b, this.now); this.budgets.set(bk, budget); }
    if (!budget.tryTake()) return fail('RATE_BUDGET');
    const transport = new HttpMessagingTransport(kind, env, this.deps);
    const r = await transport.send({
      to: m.to, body: m.body, reference: m.messageId ?? `${m.channel}:${m.templateId}:${m.to}`, templateId: m.templateId, locale: m.locale, subject: m.subject, variables: m.variables, html: m.html,
      senderId: env.senderId, ...(marketingMail ? { unsubscribeUrl: m.unsubscribeUrl, unsubscribeMailto: unsub?.mailto } : {}),
    });
    if (r.ok) return { ok: true, providerRef: r.providerRef };
    if (/RATE_LIMITED/.test(r.error ?? '')) this.gate.trip();
    return fail(r.error ?? 'SEND_FAILED');
  }
}

/** Fail-closed adapter for a real channel with no usable provider config (startup check normally prevents reaching it). */
export class UnconfiguredAdapter implements MessagingAdapter {
  readonly mode = 'real' as const;
  constructor(public readonly channel: MsgChannel) {}
  async send(): Promise<SendResult> {
    throw new Error(`NEEDS_HUMAN: ${this.channel} real provider not configured (set ${this.channel}_API_URL / _API_KEY / _SENDER_ID / _WEBHOOK_SECRET; see Docs/PROVIDERS.md)`);
  }
}

/**
 * Several providers for one channel (config `channels.<CH>.providers`): the first that accepts the message wins. The next provider is tried only for a PROVIDER-level
 * failure (network, 5xx, rate limit, our credential refused, not configured); a rejected recipient or a bad payload would fail identically elsewhere and is returned as is.
 */
export class FailoverAdapter implements MessagingAdapter {
  readonly mode = 'real' as const;
  constructor(public readonly channel: MsgChannel, private readonly chain: Array<{ provider: string; adapter: MessagingAdapter }>) {}
  get providers(): string[] { return this.chain.map((c) => c.provider); }
  async send(m: OutboundMessage, ctx?: SendContext): Promise<SendResult> {
    let last: SendResult = { ok: false, providerRef: '', error: 'NO_PROVIDER' };
    for (const { provider, adapter } of this.chain) {
      try { last = { ...(await adapter.send(m, ctx)), provider }; } catch { last = { ok: false, providerRef: '', error: 'PROVIDER_ERROR', provider }; }
      if (last.ok || last.recipientRejected || !classifyTransportError(last.error).providerLevel) return last;
    }
    return last;
  }
}

/** Android notification channel (created by the app at start, see apps/mobile/src/lib/notificationChannels.ts) per template family; ids come from config `push.androidChannels`. */
export function pushChannelFor(templateId: string, channels: Record<string, string> = {}): string {
  const pick = (k: string, d: string) => channels[k] || d;
  if (/^(BOOKING|WAITLIST|DEPOSIT|TELE_SESSION)/.test(templateId)) return pick('bookings', 'kiorex-bookings');
  if (/^(FOLLOW_UP|REVIEW|CARE_PLAN)/.test(templateId)) return pick('reminders', 'kiorex-reminders');
  if (/^(PHARMACY|LAB|HOME_VISIT|RECORD)/.test(templateId)) return pick('orders', 'kiorex-orders');
  return process.env.PUSH_ANDROID_CHANNEL_ID || pick('default', 'kiorex-default');
}

/** Deep link for a push: explicit `data.deepLink` wins (validated against the configured schemes), else derived from the ids the app already routes on. */
export function pushDeepLink(data: Record<string, unknown> | undefined, schemes?: Record<string, string>): string | undefined {
  const product = data?.product === 'kiorly' ? 'kiorly' : 'kiorex';
  const explicit = typeof data?.deepLink === 'string' ? data.deepLink : undefined;
  if (explicit) { const m = /^([a-z][a-z0-9+.-]*):\/\/(.+)$/.exec(explicit); return m && m[1] === (schemes?.[product] ?? product) ? buildDeepLink(product, m[2], schemes) ?? undefined : undefined; }
  const id = (k: string) => (typeof data?.[k] === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(data[k] as string) ? (data[k] as string) : '');
  const booking = id('bookingId') || id('appointmentId'); const order = id('pharmacyOrderId') || id('orderId'); const lab = id('labBookingId');
  const path = booking ? `appointment/${booking}` : lab ? `lab/booking/${lab}` : order ? `pharmacy/order/${order}` : '';
  return path ? buildDeepLink(product, path, schemes) ?? undefined : undefined;
}

/**
 * MODE=real PUSH adapter: FCM HTTP v1 (Android native tokens), APNs (token-based .p8, native iOS tokens) and the Expo push service (Expo tokens), chosen by token shape;
 * credentials only from PUSH_FCM_SERVICE_ACCOUNT_JSON / PUSH_APNS_KEY_P8 (+ ids) / PUSH_EXPO_ACCESS_TOKEN (see common/providers/vendors/push.ts). A dead token comes back as `invalidToken`
 * so the hub revokes it. Always one device token per request: no topics, no conditions, no segments, no silent pushes, and the data payload is a closed allow-list of ids.
 */
export class PushAdapter implements MessagingAdapter {
  readonly mode = 'real' as const;
  readonly channel = 'PUSH' as const;
  private readonly tickets = new Map<string, { token: string; at: number }>();
  private readonly budgets = new Map<string, RateBudget>();
  constructor(private readonly sender: PushSender = new PushSender(pushConfigFromEnv(process.env), outboundFetch), private readonly now: Clock = Date.now) {}
  async send(m: OutboundMessage, ctx?: SendContext): Promise<SendResult> {
    const cfg = ctx?.config ?? effectiveMessagingConfig(undefined, m.market);
    const fail = (error: string, extra: Partial<SendResult> = {}): SendResult => ({ ok: false, providerRef: '', error, provider: 'push', ...extra });
    if (cfg.channels?.PUSH?.enabled === false) return fail('CHANNEL_DISABLED', { retryable: false });
    const rb = cfg.channels?.PUSH?.rateBudget ?? {}; const key = `${rb.perSecond ?? ''}|${rb.perMinute ?? ''}|${rb.perDay ?? ''}`;
    let budget = this.budgets.get(key); if (!budget) { budget = new RateBudget(rb, this.now); this.budgets.set(key, budget); }
    if (!budget.tryTake()) return fail('RATE_BUDGET', { retryable: true });
    const push = cfg.push ?? {};
    const deepLink = pushDeepLink(m.data, push.deepLinkSchemes);
    const badge = push.badge !== false && typeof m.data?.badge === 'number' ? (m.data.badge as number) : undefined;
    const r = await this.sender.send({
      token: m.to, title: m.subject ?? 'Kiorex', body: m.body, data: { ...(m.data ?? {}), templateId: m.templateId, ...(deepLink ? { deepLink } : { deepLink: undefined }) },
      channelId: pushChannelFor(m.templateId, push.androidChannels), badge, ttlSeconds: push.ttlSeconds, collapseId: typeof m.data?.collapseId === 'string' ? m.data.collapseId : undefined,
    });
    if (r.ok && r.providerRef && isExpoToken(m.to)) { this.tickets.set(r.providerRef, { token: m.to, at: this.now() }); if (this.tickets.size > 20_000) this.tickets.delete(this.tickets.keys().next().value as string); }
    return { ok: r.ok, providerRef: r.providerRef ?? '', error: r.error, invalidToken: r.invalidToken, retryable: r.retryable, provider: 'push' };
  }
  /** Tokens of Expo tickets older than `minAgeMs` (default 15 min) whose receipt says DeviceNotRegistered. Called by the hub's sweep. */
  async sweepExpoReceipts(minAgeMs = 15 * 60_000): Promise<{ revoke: string[]; checked: number }> {
    const cutoff = this.now() - minAgeMs;
    const due = [...this.tickets.entries()].filter(([, v]) => v.at <= cutoff);
    if (!due.length) return { revoke: [], checked: 0 };
    const r = await this.sender.expoReceipts(due.map(([id]) => id));
    for (const id of [...r.ok, ...r.invalid, ...r.failed]) this.tickets.delete(id);
    for (const [id, v] of due) if (v.at <= this.now() - 24 * 3_600_000) this.tickets.delete(id); // Expo keeps receipts 24 h
    return { revoke: r.invalid.map((id) => due.find(([d]) => d === id)?.[1].token).filter((t): t is string => !!t), checked: due.length };
  }
}

/** Per-channel mode: SMS/EMAIL/WHATSAPP from <KIND>_MODE; PUSH from PUSH_MODE (legacy MESSAGING_MODE=real still switches it on). Mode is env-only: configuration can never turn a channel real. */
export function channelMode(channel: MsgChannel): 'mock' | 'real' {
  const k = messagingKindOf(channel);
  if (k) return providerEnv(k).mode;
  const m = process.env.PUSH_MODE;
  if (m === 'real' || m === 'mock') return m;
  return process.env.MESSAGING_MODE === 'real' ? 'real' : 'mock';
}

/** Control Center key of what a message will use (push depends on the token shape). */
export function integrationKeyFor(channel: MsgChannel, to?: string): string {
  if (channel === 'WHATSAPP') return 'WHATSAPP_CLOUD';
  if (channel === 'SMS' || channel === 'EMAIL') return channel;
  return to && isExpoToken(to) ? 'PUSH_EXPO' : to && isApnsToken(to) ? 'PUSH_APNS' : 'PUSH_FCM';
}

/**
 * Real-mode gate (launch guide 13.4): a REAL adapter sends only while INTEGRATION_MODES approves real for its integration in this environment; otherwise it fails closed with
 * NEEDS_HUMAN and calls no vendor. Checked on every send (an approval can be withdrawn at runtime). Mock adapters are never wrapped.
 */
export class ApprovalGatedAdapter implements MessagingAdapter {
  readonly mode = 'real' as const;
  constructor(private readonly inner: MessagingAdapter) {}
  get channel(): MsgChannel { return this.inner.channel; }
  get unwrapped(): MessagingAdapter { return this.inner; }
  async send(m: OutboundMessage, ctx?: SendContext): Promise<SendResult> {
    const key = integrationKeyFor(this.channel, m.to);
    if (!realModeGate(key).allowed) return { ok: false, providerRef: '', error: gateErrorCode(key), retryable: false };
    return this.inner.send(m, ctx);
  }
}

export interface AdapterDeps {
  meta?: MetaAdapterDeps;
  http?: HttpDeps;
  push?: Partial<PushConfig>;
  config?: import('./messaging-config').MessagingChannelsConfig;
}

export function createMessagingAdapter(channel: MsgChannel, deps: AdapterDeps = {}): MessagingAdapter {
  if (channelMode(channel) === 'mock') return new MockAdapter(channel);
  const inner = createRealAdapter(channel, deps);
  return inner instanceof UnconfiguredAdapter ? inner : new ApprovalGatedAdapter(inner);
}

function createRealAdapter(channel: MsgChannel, deps: AdapterDeps): MessagingAdapter {
  if (channel === 'PUSH') return pushProblems(process.env).length ? new UnconfiguredAdapter(channel) : new PushAdapter(new PushSender({ ...pushConfigFromEnv(process.env), ...(deps.push ?? {}) }, outboundFetch));
  const k = messagingKindOf(channel) as MessagingKind | undefined;
  if (!k) return new UnconfiguredAdapter(channel);
  const cfg = deps.config ?? effectiveMessagingConfig(undefined);
  const order = providerOrder(k, cfg);
  const build = (provider: string): MessagingAdapter | null => {
    if (providerProblemsFor(k, provider, cfg).length) return null;
    if (k === 'WHATSAPP' && provider === 'meta' && deps.meta) return new MetaWhatsappAdapter({ ...deps.meta, env: providerEnvFor(k, provider, cfg), http: deps.meta.http ?? deps.http });
    return new HttpMessagingAdapter(channel, deps.http ?? { fetchImpl: outboundFetch }, provider);
  };
  const chain = order.map((p) => ({ provider: p, adapter: build(p) })).filter((x): x is { provider: string; adapter: MessagingAdapter } => !!x.adapter);
  if (!chain.length) return new UnconfiguredAdapter(channel);
  return chain.length === 1 ? chain[0].adapter : new FailoverAdapter(channel, chain);
}
