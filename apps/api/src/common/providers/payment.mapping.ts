import { bearer } from './mapping-types';
import { verifyWebhookBody } from './webhook';

export type PaymentEventType = 'payment.captured' | 'payment.failed' | 'refund.settled';
export interface PaymentEvent { eventId: string; type: PaymentEventType; pspRef: string; paymentId?: string; amountMinor: number; feeMinor?: number; occurredAt: string }

/**
 * PAYMENT mapping (ADAPT HERE for a given PSP: Paymob / Fawry / InstaPay gateway). Neutral contract:
 *   POST {PAYMENT_API_URL}/checkouts  { "reference": "<paymentId>", "amountMinor": 15000, "currency": "EGP" }   Idempotency-Key: <paymentId>
 *   -> 2xx { "id": "<pspRef>", "checkoutUrl": "https://..." }
 *   POST {PAYMENT_API_URL}/refunds    { "paymentRef": "<pspRef>", "reference": "<refundId>", "amountMinor": 5000 } Idempotency-Key: <refundId>
 *   -> 2xx { "id": "<pspRefundRef>" }
 *   webhook -> { "id": "<eventId>", "type": "payment.captured|payment.failed|refund.settled", "paymentRef": "<pspRef>",
 *                "reference": "<paymentId>", "amountMinor": 15000, "feeMinor": 300, "occurredAt": "ISO" }
 *   Amounts are integer minor units (piasters). Signature: generic X-Webhook-Signature scheme (see webhook.ts).
 */
export interface PaymentMapping {
  authHeaders(apiKey: string): Record<string, string>;
  buildCheckout(i: { paymentId: string; amountMinor: number; currency: string }): { path: string; body: unknown };
  parseCheckout(json: any): { pspRef: string; checkoutUrl: string };
  buildRefund(i: { pspRef: string; refundId: string; amountMinor: number }): { path: string; body: unknown };
  parseRefund(json: any): { pspRefundRef: string };
  parseWebhook(raw: string): PaymentEvent | null;
  verifyWebhook(o: { secret: string; rawBody: string; headers: Record<string, unknown> }): boolean;
}

const TYPES: PaymentEventType[] = ['payment.captured', 'payment.failed', 'refund.settled'];

export const paymentMapping: PaymentMapping = {
  authHeaders: bearer,
  buildCheckout: (i) => ({ path: '/checkouts', body: { reference: i.paymentId, amountMinor: i.amountMinor, currency: i.currency } }),
  parseCheckout: (j) => {
    const pspRef = j?.id ?? j?.data?.id; const checkoutUrl = j?.checkoutUrl ?? j?.data?.checkoutUrl;
    if (!pspRef || typeof checkoutUrl !== 'string') throw new Error('no checkout id/url in provider response');
    return { pspRef: String(pspRef), checkoutUrl };
  },
  buildRefund: (i) => ({ path: '/refunds', body: { paymentRef: i.pspRef, reference: i.refundId, amountMinor: i.amountMinor } }),
  parseRefund: (j) => {
    const id = j?.id ?? j?.data?.id;
    if (!id) throw new Error('no refund id in provider response');
    return { pspRefundRef: String(id) };
  },
  parseWebhook: (raw) => {
    let j: any;
    try { j = JSON.parse(raw); } catch { return null; }
    const type = j?.type as PaymentEventType;
    if (!TYPES.includes(type) || !j?.id || !Number.isInteger(j?.amountMinor) || (!j?.paymentRef && !j?.reference)) return null;
    return { eventId: String(j.id), type, pspRef: String(j.paymentRef ?? ''), paymentId: j.reference ? String(j.reference) : undefined, amountMinor: j.amountMinor, feeMinor: Number.isInteger(j.feeMinor) ? j.feeMinor : undefined, occurredAt: String(j.occurredAt ?? new Date().toISOString()) };
  },
  verifyWebhook: (o) => verifyWebhookBody(o),
};
