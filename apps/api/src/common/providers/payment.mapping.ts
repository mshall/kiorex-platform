import { cardFingerprint, last4Of } from './vendors/card-fingerprint';
import { PSP_EVENT_TYPES, type PspCardFacts, type PspEvent, type PspEventType, type PspStatus } from './vendors/psp-event';
import { bearer } from './mapping-types';
import { verifyWebhookBody } from './webhook';

export type PaymentEventType = PspEventType;
export type PaymentEvent = PspEvent;

/**
 * PAYMENT mapping (ADAPT HERE for a given PSP: the generic card gateway and the InstaPay gateway speak this neutral contract). All amounts are integer minor units.
 *   POST {API}/checkouts   { reference:<paymentId>, amountMinor, currency, capture:true|false, threeDs:'required'|'preferred'|'off', returnUrl, webhookUrl }   Idempotency-Key: checkout:<paymentId>
 *     -> 2xx { id:<pspRef>, checkoutUrl }                      (hosted page: the card is typed on the gateway's origin, cards never touch Kiorex: SAQ-A)
 *   POST {API}/checkouts/<pspRef>/capture { amountMinor }     -> 2xx { id }      (manual capture mode)
 *   POST {API}/checkouts/<pspRef>/void                         -> 2xx { id }
 *   GET  {API}/checkouts/<pspRef>                              -> 2xx { status:'pending|authorized|captured|failed|voided|refunded|partially_refunded', amountMinor, refundedMinor?, currency?, card? }
 *   POST {API}/refunds     { paymentRef:<pspRef>, reference:<refundId>, amountMinor }   Idempotency-Key: refund:<refundId>      -> 2xx { id:<pspRefundRef> }
 *   webhook -> { id:<eventId>, type, paymentRef:<pspRef>, reference:<paymentId>, amountMinor, currency?, feeMinor?, occurredAt, refundRef?,
 *                card?:{ fingerprint?, brand?, last4?, threeDs?:'none|challenged|passed|failed' }, dispute?:{ id, reasonCode?, evidenceDueAt? } }
 *     type: payment.authorized|captured|failed|voided, refund.settled|failed, dispute.opened|won|lost
 *   Signature: generic X-Webhook-Timestamp + X-Webhook-Signature = sha256=HMAC(secret, `${ts}.${rawBody}`), tolerance configurable (see webhook.ts).
 * `card.fingerprint` is the gateway's STABLE per-card id; it is HMAC-hashed with the fingerprint pepper before it leaves this file (the raw value is never stored or logged).
 */
export interface PaymentMapping {
  authHeaders(apiKey: string): Record<string, string>;
  buildCheckout(i: { paymentId: string; amountMinor: number; currency: string; capture?: boolean; threeDs?: 'required' | 'preferred' | 'off'; returnUrl?: string; webhookUrl?: string }): { path: string; body: unknown };
  parseCheckout(json: any): { pspRef: string; checkoutUrl: string };
  buildRefund(i: { pspRef: string; refundId: string; amountMinor: number }): { path: string; body: unknown };
  parseRefund(json: any): { pspRefundRef: string };
  buildCapture(i: { pspRef: string; amountMinor: number }): { path: string; body: unknown };
  buildVoid(i: { pspRef: string }): { path: string; body: unknown };
  buildStatus(i: { pspRef: string }): { path: string };
  parseStatus(json: any, o?: { psp?: string; pepper?: string }): PspStatus;
  parseWebhook(raw: string, o?: { psp?: string; pepper?: string }): PspEvent | null;
  verifyWebhook(o: { secret: string; rawBody: string; headers: Record<string, unknown>; toleranceSeconds?: number; nowSeconds?: number }): boolean;
}

const THREEDS: Record<string, PspCardFacts['threeDs']> = { none: 'NONE', challenged: 'CHALLENGED', passed: 'PASSED', failed: 'FAILED' };
const STATUS: Record<string, PspStatus['state']> = { pending: 'PENDING', authorized: 'AUTHORIZED', captured: 'CAPTURED', failed: 'FAILED', voided: 'VOIDED', refunded: 'REFUNDED', partially_refunded: 'PARTIALLY_REFUNDED' };

function cardOf(j: any, o: { psp?: string; pepper?: string } = {}): PspCardFacts | undefined {
  const c = j?.card; if (!c || typeof c !== 'object') return undefined;
  const last4 = last4Of(c.last4); const brand = typeof c.brand === 'string' ? c.brand : undefined;
  const fp = cardFingerprint({ psp: o.psp ?? 'card', pepper: o.pepper ?? '', stable: typeof c.fingerprint === 'string' ? c.fingerprint : null, brand, last4 });
  const threeDs = THREEDS[String(c.threeDs ?? '').toLowerCase()];
  const out: PspCardFacts = { ...(brand ? { brand } : {}), ...(last4 ? { last4 } : {}), ...(threeDs ? { threeDs } : {}), ...(fp ? { fingerprint: fp.hash, fingerprintStrength: fp.strength } : {}) };
  return Object.keys(out).length ? out : undefined;
}

export const paymentMapping: PaymentMapping = {
  authHeaders: bearer,
  buildCheckout: (i) => ({ path: '/checkouts', body: { reference: i.paymentId, amountMinor: i.amountMinor, currency: i.currency, ...(i.capture === undefined ? {} : { capture: i.capture }), ...(i.threeDs ? { threeDs: i.threeDs } : {}), ...(i.returnUrl ? { returnUrl: i.returnUrl } : {}), ...(i.webhookUrl ? { webhookUrl: i.webhookUrl } : {}) } }),
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
  buildCapture: (i) => ({ path: `/checkouts/${encodeURIComponent(i.pspRef)}/capture`, body: { amountMinor: i.amountMinor } }),
  buildVoid: (i) => ({ path: `/checkouts/${encodeURIComponent(i.pspRef)}/void`, body: {} }),
  buildStatus: (i) => ({ path: `/checkouts/${encodeURIComponent(i.pspRef)}` }),
  parseStatus: (j, o) => {
    const d = j?.data ?? j; const state = STATUS[String(d?.status ?? '').toLowerCase()] ?? 'UNKNOWN';
    const card = cardOf(d, o);
    return { state, ...(Number.isInteger(d?.amountMinor) ? { amountMinor: d.amountMinor } : {}), ...(Number.isInteger(d?.refundedMinor) ? { refundedMinor: d.refundedMinor } : {}), ...(d?.currency ? { currency: String(d.currency) } : {}), ...(Number.isInteger(d?.feeMinor) ? { feeMinor: d.feeMinor } : {}), ...(card ? { card } : {}) };
  },
  parseWebhook: (raw, o) => {
    let j: any;
    try { j = JSON.parse(raw); } catch { return null; }
    const type = j?.type as PspEventType;
    if (!PSP_EVENT_TYPES.includes(type) || !j?.id || !Number.isSafeInteger(j?.amountMinor) || j.amountMinor < 0 || (!j?.paymentRef && !j?.reference)) return null;
    const isDispute = type.startsWith('dispute.');
    if (isDispute && !(typeof j?.dispute?.id === 'string' || typeof j?.dispute?.id === 'number')) return null; // a dispute event without its own reference cannot be tracked
    const card = cardOf(j, o);
    return {
      eventId: String(j.id), type, pspRef: String(j.paymentRef ?? ''), paymentId: j.reference ? String(j.reference) : undefined, amountMinor: j.amountMinor,
      ...(Number.isInteger(j.feeMinor) ? { feeMinor: j.feeMinor } : {}), ...(j.currency ? { currency: String(j.currency) } : {}),
      occurredAt: typeof j.occurredAt === 'string' && !Number.isNaN(Date.parse(j.occurredAt)) ? new Date(j.occurredAt).toISOString() : new Date().toISOString(),
      ...(j.refundRef ? { refundRef: String(j.refundRef) } : {}), ...(card ? { card } : {}),
      ...(isDispute ? { dispute: { ref: String(j.dispute.id), ...(j.dispute.reasonCode ? { reasonCode: String(j.dispute.reasonCode).slice(0, 64) } : {}), ...(typeof j.dispute.evidenceDueAt === 'string' && !Number.isNaN(Date.parse(j.dispute.evidenceDueAt)) ? { evidenceDueAt: new Date(j.dispute.evidenceDueAt).toISOString() } : {}) } } : {}),
    };
  },
  verifyWebhook: (o) => verifyWebhookBody(o),
};
