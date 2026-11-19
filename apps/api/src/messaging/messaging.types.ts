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
}
export interface SendResult { providerRef: string; ok: boolean; error?: string }

/** Adapter contract shared by every messaging provider. `mode` is mock|real (MESSAGING_MODE). */
export interface MessagingAdapter {
  readonly channel: MsgChannel;
  readonly mode: 'mock' | 'real';
  send(m: OutboundMessage): Promise<SendResult>;
}

export interface InboundMessage { channel: MsgChannel; from: string; text?: string; buttonPayload?: string; providerRef?: string }
export type InboundHandler = (m: InboundMessage & { logId: string }) => Promise<void>;

export function maskRecipient(channel: MsgChannel, to: string): string {
  if (channel === 'EMAIL') {
    const [u, d] = to.split('@');
    return d ? `${u.slice(0, 1)}***@${d}` : '***';
  }
  if (channel === 'PUSH') return 'push:****';
  return to.length > 6 ? `${to.slice(0, 4)}****${to.slice(-3)}` : '***';
}
