import { createHash } from 'node:crypto';
import { outboundFetch } from '../common/outbound-http';
import { providerEnv, providerProblems } from '../common/providers/env';
import { HttpMessagingTransport, messagingKindOf } from '../common/providers/real-adapters';
import type { HttpDeps } from '../common/providers/http';
import { MessagingAdapter, MsgChannel, OutboundMessage, SendResult } from './messaging.types';

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

/**
 * MODE=real adapter for SMS / EMAIL / WHATSAPP: generic HTTP provider driven only by <KIND>_API_URL / _API_KEY / _SENDER_ID (see
 * common/providers + Docs/PROVIDERS.md). Timeouts, retries with backoff and an idempotency key (the message id) are built in.
 */
export class HttpMessagingAdapter implements MessagingAdapter {
  readonly mode = 'real' as const;
  private readonly transport: HttpMessagingTransport;
  constructor(public readonly channel: MsgChannel, deps: HttpDeps = { fetchImpl: outboundFetch }) {
    this.transport = new HttpMessagingTransport(messagingKindOf(channel)!, undefined, deps);
  }
  async send(m: OutboundMessage): Promise<SendResult> {
    return this.transport.send({ to: m.to, body: m.body, reference: m.messageId ?? `${m.channel}:${m.templateId}:${m.to}`, templateId: m.templateId, locale: m.locale });
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

/** Per-channel mode: SMS/EMAIL/WHATSAPP from <KIND>_MODE; PUSH has no HTTP provider yet (FCM/APNs) so it is mock unless legacy MESSAGING_MODE=real. */
export function channelMode(channel: MsgChannel): 'mock' | 'real' {
  const k = messagingKindOf(channel);
  if (k) return providerEnv(k).mode;
  return process.env.MESSAGING_MODE === 'real' ? 'real' : 'mock';
}

export function createMessagingAdapter(channel: MsgChannel): MessagingAdapter {
  if (channelMode(channel) === 'mock') return new MockAdapter(channel);
  const k = messagingKindOf(channel);
  if (!k || providerProblems(k).length) return new UnconfiguredAdapter(channel);
  return new HttpMessagingAdapter(channel);
}
