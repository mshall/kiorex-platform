import type { Channel, ChannelAdapter, RenderedMessage, SendOutcome, StatusEvent } from '@kiorex/contracts/notify';
import { normalizeVendorStatus } from '@kiorex/contracts/notify';
import { providerEnv } from '../common/providers/env';
import { messagingKindOf, MESSAGING_MAPPINGS } from '../common/providers/real-adapters';
import type { MessagingHub } from './messaging.hub';
import type { MsgChannel } from './messaging.types';

/** Plain text the legacy MessagingAdapter transports carry for a channel-specific notify body. */
export function flattenBody(m: RenderedMessage): string {
  switch (m.channel) {
    case 'SMS': return (m.body as { text: string }).text;
    case 'EMAIL': return (m.body as { text: string }).text;
    case 'PUSH': return (m.body as { body: string }).body;
    case 'INAPP': return (m.body as { body: string }).body;
    case 'WHATSAPP': { const b = m.body as { text?: string; template?: { vars: Record<string, string> } }; return b.text ?? b.template?.vars.body ?? ''; }
  }
}

/**
 * notify ChannelAdapter over the existing MessagingHub: the hub still owns the MessageLog row, the mock/real adapter choice
 * (SMS_MODE / EMAIL_MODE / WHATSAPP_MODE) and the HTTP vendor mapping, so behaviour in mock and real mode is unchanged.
 * parseWebhook / verify reuse the vendor mapping, with statuses normalized through the shared status model.
 */
export class HubChannelAdapter implements ChannelAdapter {
  constructor(public readonly channel: Exclude<Channel, 'INAPP'>, private readonly hub: Pick<MessagingHub, 'send' | 'channelMode'>) {}
  get mode(): 'mock' | 'real' { return this.hub.channelMode(this.channel as MsgChannel); }

  async send(m: RenderedMessage): Promise<SendOutcome> {
    const r = await this.hub.send({
      messageId: m.metadata?.messageId, channel: this.channel as MsgChannel, sub: m.metadata?.sub, to: m.to,
      templateId: m.metadata?.templateId ?? m.type, locale: m.locale, body: flattenBody(m),
    });
    return { ok: r.ok, providerRef: r.providerRef ?? undefined, error: r.error ?? undefined };
  }

  parseWebhook(rawBody: string): StatusEvent[] {
    const kind = messagingKindOf(this.channel);
    if (!kind) return [];
    const out: StatusEvent[] = [];
    for (const e of MESSAGING_MAPPINGS[kind].parseStatusWebhook(rawBody)) {
      const status = normalizeVendorStatus(this.channel, e.status);
      if (status) out.push({ providerRef: e.providerRef, status, ...(e.error ? { error: e.error } : {}), ...(e.occurredAt ? { occurredAt: e.occurredAt } : {}) });
    }
    return out;
  }

  verify(rawBody: string, headers: Record<string, unknown> = {}): boolean {
    const kind = messagingKindOf(this.channel);
    if (!kind) return false;
    return MESSAGING_MAPPINGS[kind].verifyWebhook({ secret: providerEnv(kind).webhookSecret, rawBody, headers });
  }
}

/**
 * First-class in-app inbox channel. The inbox IS the engagement `Message` row (channel INAPP, read by GET /inbox), so storing
 * is already done by the caller: this adapter acknowledges it so the layer records an INAPP attempt like any other channel.
 */
export class InboxChannelAdapter implements ChannelAdapter {
  readonly channel = 'INAPP' as const;
  readonly mode = 'real' as const; // always on: there is no mock inbox, the table is the inbox
  async send(m: RenderedMessage): Promise<SendOutcome> { return { ok: true, providerRef: `inapp:${m.metadata?.messageId ?? m.notificationId}` }; }
  parseWebhook(): StatusEvent[] { return []; }
  verify(): boolean { return false; }
}
