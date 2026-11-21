import { providerEnv, providerProblems, type ProviderEnv, type ProviderKind } from './env';
import { providerRequest, ProviderError, type HttpDeps } from './http';
import type { MessagingMapping } from './mapping-types';
import { smsMapping } from './sms.mapping';
import { emailMapping } from './email.mapping';
import { whatsappMapping } from './whatsapp.mapping';

export type MessagingKind = 'SMS' | 'EMAIL' | 'WHATSAPP';
export const MESSAGING_MAPPINGS: Record<MessagingKind, MessagingMapping> = { SMS: smsMapping, EMAIL: emailMapping, WHATSAPP: whatsappMapping };
export const messagingKindOf = (channel: string): MessagingKind | undefined => (channel === 'SMS' || channel === 'EMAIL' || channel === 'WHATSAPP' ? channel : undefined);

export interface RealSend { to: string; body: string; reference: string; templateId: string; locale: string; variables?: Record<string, string> }
export interface RealSendResult { ok: boolean; providerRef: string; error?: string }

/** Real HTTP messaging transport for one kind, driven only by env + the mapping. Never logs bodies, recipients or keys. */
export class HttpMessagingTransport {
  readonly mode = 'real' as const;
  constructor(readonly kind: MessagingKind, private readonly env: ProviderEnv = providerEnv(kind), private readonly deps: HttpDeps = {}, private readonly mapping: MessagingMapping = MESSAGING_MAPPINGS[kind]) {}
  async send(m: RealSend): Promise<RealSendResult> {
    try {
      const wire = this.mapping.buildSend({ to: m.to, body: m.body, senderId: this.env.senderId, reference: m.reference, templateId: m.templateId, locale: m.locale, variables: m.variables });
      const r = await providerRequest(this.env, { path: wire.path, body: wire.body, headers: wire.headers, idempotencyKey: m.reference }, this.deps, this.mapping.authHeaders(this.env.apiKey));
      return { ok: true, providerRef: this.mapping.parseSend(r.json).providerRef };
    } catch (e) {
      if (e instanceof ProviderError) return { ok: false, providerRef: '', error: e.message };
      return { ok: false, providerRef: '', error: 'PROVIDER_BAD_RESPONSE' };
    }
  }
}

export const isConfigured = (kind: ProviderKind, env: Record<string, string | undefined> = process.env): boolean => providerEnv(kind, env).mode === 'real' && providerProblems(kind, env).length === 0;
