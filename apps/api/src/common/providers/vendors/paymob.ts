import { createHmac, timingSafeEqual } from 'node:crypto';
import { cardFingerprint, last4Of } from './card-fingerprint';
import type { PspCardFacts, PspEvent, PspStatus } from './psp-event';

/**
 * Paymob Accept (Egypt), Intention API + unified checkout.
 *   env: PAYMOB_API_URL (default https://accept.paymob.com), PAYMOB_SECRET_KEY (egy_sk_..., server), PAYMOB_PUBLIC_KEY (egy_pk_..., checkout),
 *        PAYMOB_HMAC_SECRET (Dashboard > Settings > HMAC), PAYMOB_INTEGRATION_IDS (comma list of card / wallet integration ids),
 *        PAYMOB_AUTH_INTEGRATION_IDS (auth-only card integrations, used when captureMode=MANUAL; authorise now, capture or void later)
 *   checkout: POST /v1/intention/  Authorization: Token <secret key>  { amount (piasters), currency, payment_methods:[ids], items, billing_data, special_reference: <paymentId>,
 *             notification_url, redirection_url } -> { client_secret, intention_order_id }; hosted page = {API}/unifiedcheckout/?publicKey=&clientSecret=
 *             (the card is typed on Paymob's page: cards never touch Kiorex servers, PCI SAQ-A)
 *   webhook (processed callback): POST {type:'TRANSACTION', obj:{...}} ?hmac=<sha512>. HMAC-SHA512(PAYMOB_HMAC_SECRET) over the documented field concatenation, see PAYMOB_HMAC_FIELDS.
 *   SECURITY: `order.merchant_order_id` (our payment id) is NOT one of the signed fields, so it is never trusted: the payment is found by the signed `order.id` only.
 *   refund: POST /api/acceptance/void_refund/refund  { transaction_id, amount_cents }  (transaction id found via /api/ecommerce/orders/transaction_inquiry).
 *   capture: POST /api/acceptance/capture { transaction_id, amount_cents }   void: POST /api/acceptance/void_refund/void { transaction_id }   (NEEDS_VERIFY on the first sandbox run)
 */
export const PAYMOB_HMAC_FIELDS = ['amount_cents', 'created_at', 'currency', 'error_occured', 'has_parent_transaction', 'id', 'integration_id', 'is_3d_secure', 'is_auth', 'is_capture', 'is_refunded', 'is_standalone_payment', 'is_voided', 'order.id', 'owner', 'pending', 'source_data.pan', 'source_data.sub_type', 'source_data.type', 'success'] as const;
const dig = (o: any, p: string) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);

export const paymobHmacString = (obj: any) => PAYMOB_HMAC_FIELDS.map((f) => { const v = dig(obj, f); return v === undefined || v === null ? '' : String(v); }).join('');
export const paymobHmac = (secret: string, obj: any) => createHmac('sha512', secret).update(paymobHmacString(obj), 'utf8').digest('hex');
export function verifyPaymobHmac(secret: string, obj: any, given: string): boolean {
  if (!secret || !given) return false;
  const a = Buffer.from(given.toLowerCase()); const b = Buffer.from(paymobHmac(secret, obj));
  return a.length === b.length && timingSafeEqual(a, b);
}

export const paymobAuth = (secretKey: string) => ({ authorization: `Token ${secretKey}` });
export function paymobIntentionBody(i: { paymentId: string; amountMinor: number; currency: string; integrationIds: number[]; notificationUrl: string; redirectionUrl: string }) {
  return {
    amount: i.amountMinor, currency: i.currency, payment_methods: i.integrationIds, special_reference: i.paymentId,
    items: [{ name: 'Kiorex payment', amount: i.amountMinor, description: 'Kiorex', quantity: 1 }],
    billing_data: { first_name: 'Kiorex', last_name: 'Patient', email: 'noreply@kiorex.com', phone_number: 'NA', apartment: 'NA', floor: 'NA', street: 'NA', building: 'NA', shipping_method: 'NA', postal_code: 'NA', city: 'NA', country: 'EG', state: 'NA' }, // no patient PHI is sent to the PSP
    notification_url: i.notificationUrl, redirection_url: i.redirectionUrl,
  };
}
export function parsePaymobIntention(json: any, apiUrl: string, publicKey: string): { pspRef: string; checkoutUrl: string } {
  const cs = json?.client_secret; const order = json?.intention_order_id ?? json?.id;
  if (typeof cs !== 'string' || !cs || order === undefined) throw new Error('no client_secret / order id in Paymob response');
  return { pspRef: String(order), checkoutUrl: `${apiUrl.replace(/\/+$/, '')}/unifiedcheckout/?publicKey=${encodeURIComponent(publicKey)}&clientSecret=${encodeURIComponent(cs)}` };
}

export interface PaymobParseOpts { psp?: string; pepper?: string }
/** What the callback says about the card: masked data only (Paymob never sends a PAN). The fingerprint is WEAK (brand + last four + bank), HMAC-hashed with the pepper, or absent without one. */
export function paymobCardFacts(o: any, opts: PaymobParseOpts = {}): PspCardFacts | undefined {
  const sd = o?.source_data;
  if (!sd || String(sd.type ?? '').toLowerCase() !== 'card') return undefined;
  const brand = sd.sub_type ? String(sd.sub_type) : undefined; const last4 = last4Of(sd.pan);
  const fp = cardFingerprint({ psp: opts.psp ?? 'paymob', pepper: opts.pepper ?? '', brand, last4, issuer: o?.data?.bank ? String(o.data.bank) : o?.data?.issuer_bank ? String(o.data.issuer_bank) : null });
  return { ...(brand ? { brand } : {}), ...(last4 ? { last4 } : {}), threeDs: o.is_3d_secure === true ? 'PASSED' : 'NONE', ...(fp ? { fingerprint: fp.hash, fingerprintStrength: fp.strength } : {}) };
}

const isoOf = (o: any) => o?.created_at ? new Date(String(o.created_at).replace(/(\.\d+)?$/, (m) => (/[zZ+]/.test(String(o.created_at)) ? m : `${m}Z`))).toISOString() : new Date().toISOString();

/** `raw` is the verified callback body; returns null for non-transaction or still-pending callbacks. The payment is identified by the SIGNED order id only (see SECURITY above). */
export function parsePaymobCallback(raw: string, opts: PaymobParseOpts = {}): PspEvent | null {
  let j: any; try { j = JSON.parse(raw); } catch { return null; }
  const o = j?.obj; if (j?.type !== 'TRANSACTION' || !o || !Number.isInteger(o.amount_cents) || o.id === undefined) return null;
  const orderId = String(o.order?.id ?? '');
  const base = { eventId: `paymob_${o.id}`, amountMinor: o.amount_cents as number, occurredAt: isoOf(o), orderRef: orderId, ...(o.currency ? { currency: String(o.currency) } : {}) };
  const card = paymobCardFacts(o, opts);
  if (o.pending === true) return null;
  if (o.is_refunded === true) return { ...base, eventId: `${base.eventId}_refund${o.success === true ? '' : '_failed'}`, type: o.success === true ? 'refund.settled' : 'refund.failed', pspRef: String(o.id), refundRef: String(o.id) };
  if (o.is_voided === true) return o.success === true ? { ...base, eventId: `${base.eventId}_void`, type: 'payment.voided', pspRef: orderId } : null;
  if (o.success === true && o.is_auth === true && o.is_capture !== true) return { ...base, eventId: `${base.eventId}_auth`, type: 'payment.authorized', pspRef: orderId, ...(card ? { card } : {}) };
  if (o.success === true) return { ...base, type: 'payment.captured', pspRef: orderId, ...(card ? { card } : {}) };
  return { ...base, type: 'payment.failed', pspRef: orderId };
}

export const paymobRefundBody = (transactionId: string, amountMinor: number) => ({ transaction_id: Number(transactionId), amount_cents: amountMinor });
export const paymobCaptureBody = (transactionId: string, amountMinor: number) => ({ transaction_id: Number(transactionId), amount_cents: amountMinor });
export const paymobVoidBody = (transactionId: string) => ({ transaction_id: Number(transactionId) });
export const paymobInquiryBody = (i: { orderId?: string; merchantOrderId?: string }) => (i.orderId ? { order_id: i.orderId } : { merchant_order_id: i.merchantOrderId });
/** The id of the ORIGINAL transaction (a refund / void transaction points to it through parent_transaction). */
export function paymobTransactionIdFromInquiry(json: any): string {
  const t = json?.id === undefined && json?.data?.id !== undefined ? json.data : json; // a transaction carries its own `data` sub-object: only unwrap an envelope
  const id = t?.has_parent_transaction && t?.parent_transaction ? (typeof t.parent_transaction === 'object' ? t.parent_transaction.id : t.parent_transaction) : t?.id;
  if (id === undefined || id === null) throw new Error('no transaction id in Paymob inquiry response');
  return String(id);
}
/** The PSP's own view of one payment, for the polling fallback when a callback never arrived. */
export function parsePaymobInquiry(json: any, opts: PaymobParseOpts = {}): PspStatus {
  const t = json?.id === undefined && json?.data?.id !== undefined ? json.data : json; // a transaction carries its own `data` sub-object: only unwrap an envelope
  if (!t || typeof t !== 'object' || t.id === undefined) return { state: 'UNKNOWN' };
  const amount = Number.isInteger(t.amount_cents) ? (t.amount_cents as number) : undefined;
  const refunded = Number.isInteger(t.refunded_amount_cents) ? (t.refunded_amount_cents as number) : 0;
  const card = paymobCardFacts(t, opts);
  const common = { ...(amount !== undefined ? { amountMinor: amount } : {}), ...(t.currency ? { currency: String(t.currency) } : {}), pspRef: String(t.order?.id ?? ''), occurredAt: isoOf(t), ...(card ? { card } : {}) };
  if (t.is_voided === true) return { state: 'VOIDED', ...common };
  if (t.pending === true) return { state: 'PENDING', ...common };
  if (t.success !== true) return { state: 'FAILED', ...common };
  if (t.is_refunded === true || refunded > 0) return { state: amount !== undefined && refunded >= amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED', refundedMinor: refunded, ...common };
  if (t.is_auth === true && t.is_capture !== true) return { state: 'AUTHORIZED', ...common };
  return { state: 'CAPTURED', ...common };
}
