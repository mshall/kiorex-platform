import { createHash } from 'node:crypto';
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
 * MODE=real placeholder. Wiring real providers is the dedicated pre-launch pass (Docs/NEEDS_HUMAN.md, "Provider go-live"):
 *   EMAIL     provider + sending domain (SPF/DKIM)         WHATSAPP  Meta Cloud API + approved templates
 *   SMS       aggregator + sender id                        PUSH      FCM / APNs credentials
 */
export class UnconfiguredAdapter implements MessagingAdapter {
  readonly mode = 'real' as const;
  constructor(public readonly channel: MsgChannel) {}
  async send(): Promise<SendResult> {
    throw new Error(`NEEDS_HUMAN: ${this.channel} real provider not configured (see Docs/NEEDS_HUMAN.md, Provider go-live)`);
  }
}
