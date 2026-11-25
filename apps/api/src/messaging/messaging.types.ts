export const MSG_CHANNELS = ['EMAIL', 'WHATSAPP', 'SMS', 'PUSH'] as const;
export type MsgChannel = (typeof MSG_CHANNELS)[number];
export type MsgStatus = 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'RECEIVED';
export const SIMULATABLE_STATES: MsgStatus[] = ['DELIVERED', 'READ', 'FAILED'];

export interface OutboundMessage {
  messageId?: string;
  channel: MsgChannel;
  sub?: string;
  /** E.164 phone (WHATSAPP/SMS), email address (EMAIL) or device token (PUSH). */
  to: string;
  templateId: string;
  locale: string;
  body: string;
  /** EMAIL subject / PUSH title (optional; vendors fall back to the brand string). */
  subject?: string;
  /** PUSH: opaque deep-link data (ids only, never PHI). WHATSAPP: `buttons` ([{id,title}], max 3, id = exact payload) or `list` ({buttonLabel,rows}) make it an interactive message. */
  data?: Record<string, unknown>;
  /** Market (ISO 3166-1 alpha-2, default EG): selects per-market sender id, quiet hours and overrides of the MESSAGING_CHANNELS config. */
  market?: string;
  /** Named template values (WHATSAPP template parameters, e.g. { doctor, time }); `body` is the fully rendered text. */
  variables?: Record<string, string>;
  /** Message class (failover order, List-Unsubscribe on MARKETING e-mail). Default TRANSACTIONAL. */
  messageClass?: 'TRANSACTIONAL' | 'SECURITY' | 'REMINDER' | 'MARKETING';
  /** A conversational reply inside an open WhatsApp session (assistant, booking state machine): free-form is preferred over a template while the 24 h window is open. */
  conversational?: boolean;
  /** EMAIL: one-click unsubscribe URL for MARKETING mail (List-Unsubscribe + List-Unsubscribe-Post). */
  unsubscribeUrl?: string;
  /** EMAIL: optional HTML alternative of `body`. */
  html?: string;
}
export interface SendResult {
  providerRef: string; ok: boolean; error?: string;
  /** PUSH: the device token is dead, the hub revokes it */ invalidToken?: boolean;
  /** true: the same message may succeed later or on another provider (throttle, 5xx, window); false: do not retry as is (bad recipient, unapproved template, bad payload) */ retryable?: boolean;
  /** the recipient or address itself is unusable: never fail over to another PROVIDER with the same address */ recipientRejected?: boolean;
  /** which provider key sent it (failover and ops evidence) */ provider?: string;
}
/** Per-send context handed to an adapter by the hub: the effective MESSAGING_CHANNELS configuration for the message's market. */
export interface SendContext { config: import('./messaging-config').MessagingChannelsConfig; market: string; now: number }

/** Adapter contract shared by every messaging provider. `mode` is mock|real (MESSAGING_MODE). */
export interface MessagingAdapter {
  readonly channel: MsgChannel;
  readonly mode: 'mock' | 'real';
  send(m: OutboundMessage, ctx?: SendContext): Promise<SendResult>;
}

export interface InboundMessage {
  channel: MsgChannel; from: string; text?: string; buttonPayload?: string; providerRef?: string;
  /** media | location | contacts arrive with NO content (assistant rule: fixed reply, never forwarded) */ kind?: string;
  /** when the provider says the customer sent it (epoch ms); drives the 24 h WhatsApp window */ occurredAtMs?: number;
  /** wamid this replies to */ contextRef?: string; market?: string;
}
export type InboundHandler = (m: InboundMessage & { logId: string }) => Promise<void>;

export function maskRecipient(channel: MsgChannel, to: string): string {
  if (channel === 'EMAIL') {
    const [u, d] = to.split('@');
    return d ? `${u.slice(0, 1)}***@${d}` : '***';
  }
  if (channel === 'PUSH') return 'push:****';
  return to.length > 6 ? `${to.slice(0, 4)}****${to.slice(-3)}` : '***';
}
