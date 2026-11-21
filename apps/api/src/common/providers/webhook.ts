import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Generic provider-neutral webhook signature (a vendor mapping may override it):
 *   X-Webhook-Timestamp: <unix seconds>
 *   X-Webhook-Signature: sha256=<hex HMAC-SHA256(secret, `${timestamp}.${rawBody}`)>
 * Rejected when the signature is wrong or the timestamp is outside the tolerance window (replay guard).
 */
export const WEBHOOK_SIGNATURE_HEADER = 'x-webhook-signature';
export const WEBHOOK_TIMESTAMP_HEADER = 'x-webhook-timestamp';
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export function signWebhookBody(secret: string, timestampSeconds: number | string, rawBody: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestampSeconds}.${rawBody}`).digest('hex')}`;
}

const eq = (a: string, b: string) => { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const header = (h: Record<string, unknown>, name: string): string => { const v = h[name] ?? h[name.toLowerCase()]; return Array.isArray(v) ? String(v[0] ?? '') : String(v ?? ''); };

export function verifyWebhookBody(o: { secret: string; rawBody: string; headers: Record<string, unknown>; nowSeconds?: number; toleranceSeconds?: number }): boolean {
  if (!o.secret) return false;
  const sig = header(o.headers, WEBHOOK_SIGNATURE_HEADER);
  const ts = header(o.headers, WEBHOOK_TIMESTAMP_HEADER);
  if (!sig || !/^\d+$/.test(ts)) return false;
  const now = o.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(ts)) > (o.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS)) return false;
  return eq(sig, signWebhookBody(o.secret, ts, o.rawBody));
}

export function signedWebhookHeaders(secret: string, rawBody: string, nowSeconds = Math.floor(Date.now() / 1000)): Record<string, string> {
  return { [WEBHOOK_TIMESTAMP_HEADER]: String(nowSeconds), [WEBHOOK_SIGNATURE_HEADER]: signWebhookBody(secret, nowSeconds, rawBody) };
}
