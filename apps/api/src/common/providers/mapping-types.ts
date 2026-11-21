import { verifyWebhookBody } from './webhook';

/**
 * A "mapping" is the ONLY file to adapt for a given vendor. It translates the provider-neutral payloads (documented in
 * Docs/PROVIDERS.md) to / from the vendor wire format. The defaults below ARE the generic neutral format, so a vendor (or an
 * internal gateway) that speaks it needs no code change at all.
 */
export type StatusState = 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
export interface StatusEvent { providerRef: string; status: StatusState; error?: string; occurredAt?: string }

export interface OutboundWire { path: string; body: unknown; headers?: Record<string, string> }

export interface MessagingMapping {
  /** Auth headers from the API key (default: `Authorization: Bearer <key>`). */
  authHeaders(apiKey: string): Record<string, string>;
  buildSend(i: { to: string; body: string; senderId: string; reference: string; templateId: string; locale: string; variables?: Record<string, string> }): OutboundWire;
  /** Extract the vendor message id from a 2xx response. Throw if absent. */
  parseSend(json: any): { providerRef: string };
  /** Parse a (signature-verified) status webhook body into events. */
  parseStatusWebhook(raw: string): StatusEvent[];
  /** Verify the webhook signature. Default = generic X-Webhook-Signature scheme. */
  verifyWebhook(o: { secret: string; rawBody: string; headers: Record<string, unknown> }): boolean;
}

export const bearer = (apiKey: string): Record<string, string> => ({ authorization: `Bearer ${apiKey}` });
export const genericVerify: MessagingMapping['verifyWebhook'] = (o) => verifyWebhookBody(o);

const STATES: Record<string, StatusState> = { queued: 'QUEUED', accepted: 'QUEUED', sent: 'SENT', submitted: 'SENT', delivered: 'DELIVERED', read: 'READ', seen: 'READ', failed: 'FAILED', undelivered: 'FAILED', bounced: 'FAILED', rejected: 'FAILED' };

/**
 * Generic status webhook body: { "events": [ { "id": "<providerRef>", "status": "sent|delivered|read|failed", "error": "...", "occurredAt": "ISO" } ] }
 * (a single event object without the `events` wrapper is accepted too). Unknown statuses are ignored, never guessed.
 */
export function parseGenericStatus(raw: string): StatusEvent[] {
  let j: any;
  try { j = JSON.parse(raw); } catch { return []; }
  const list: any[] = Array.isArray(j?.events) ? j.events : j && typeof j === 'object' ? [j] : [];
  const out: StatusEvent[] = [];
  for (const e of list) {
    const status = STATES[String(e?.status ?? '').toLowerCase()];
    const providerRef = String(e?.id ?? e?.providerRef ?? '');
    if (!status || !providerRef) continue;
    out.push({ providerRef, status, ...(status === 'FAILED' ? { error: String(e?.error ?? 'DELIVERY_FAILED').slice(0, 200) } : {}), ...(e?.occurredAt ? { occurredAt: String(e.occurredAt) } : {}) });
  }
  return out;
}

export function parseGenericSend(json: any): { providerRef: string } {
  const id = json?.id ?? json?.messageId ?? json?.data?.id;
  if (!id || typeof id !== 'string' && typeof id !== 'number') throw new Error('no message id in provider response');
  return { providerRef: String(id) };
}

/** Provider-neutral payload -> neutral status webhook (used by dev simulators and tests to speak the generic format). */
export function genericStatusBody(providerRef: string, status: 'sent' | 'delivered' | 'read' | 'failed', error?: string): string {
  return JSON.stringify({ events: [{ id: providerRef, status, ...(error ? { error } : {}), occurredAt: new Date().toISOString() }] });
}
