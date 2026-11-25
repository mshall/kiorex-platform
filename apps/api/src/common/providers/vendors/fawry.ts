import { createHash, timingSafeEqual } from 'node:crypto';
import { fromMajor, toMajorString } from './money';
import type { PspEvent, PspStatus } from './psp-event';

/**
 * Fawry (Egypt) FawryPay hosted checkout + callback v2 + refund API (+ card-token charge for hosted fields).
 *   env: FAWRY_API_URL (default https://www.atfawry.com; staging https://atfawry.fawrystaging.com), FAWRY_MERCHANT_CODE, FAWRY_SECURE_KEY
 *   checkout: redirect to {API}/ECommercePlugin/FawryPay.jsp?chargeRequest=<urlencoded JSON>, signature = sha256(merchantCode + merchantRefNum + customerProfileId + returnUrl + sum(itemId+quantity+price.2dp) + secureKey)
 *   charge (hosted fields): the browser exchanges the card for a Fawry cardToken on Fawry's own origin; the server only ever sees the token (SAQ-A):
 *             POST /ECommerceWeb/Fawry/payments/charge { merchantCode, merchantRefNum, paymentMethod:'CARD', cardToken, amount, returnUrl, chargeItems, signature }  (NEEDS_VERIFY the signature order on the first sandbox run)
 *   callback: JSON with messageSignature = sha256(fawryRefNumber + merchantRefNumber + paymentAmount.2dp + orderAmount.2dp + orderStatus + paymentMethod + paymentRefrenceNumber + secureKey)
 *   refund: POST /ECommerceWeb/Fawry/payments/refund { merchantCode, referenceNumber, refundAmount, reason, signature = sha256(merchantCode + referenceNumber + refundAmount.2dp + reason + secureKey) }
 *   status: GET /ECommerceWeb/Fawry/payments/status/v2?merchantCode&merchantRefNumber&signature = sha256(merchantCode + merchantRefNumber + secureKey) -> fawryRefNumber, paymentStatus
 * Fawry speaks MAJOR units with 2 decimals: every amount is built with exact integer arithmetic (money.ts) and parsed back without rounding.
 * Fawry reports no card data (its page owns the card, or the customer pays by reference at a kiosk / wallet): there is NO card fingerprint from Fawry.
 */
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const major = (minor: number) => toMajorString(minor, 2);
const eq = (a: string, b: string) => { const x = Buffer.from(a.toLowerCase()); const y = Buffer.from(b.toLowerCase()); return x.length === y.length && timingSafeEqual(x, y); };

export function fawryCheckoutUrl(i: { apiUrl: string; merchantCode: string; secureKey: string; paymentId: string; amountMinor: number; returnUrl: string; webhookUrl: string; language?: 'ar-eg' | 'en-gb' }): { pspRef: string; checkoutUrl: string } {
  const item = { itemId: 'kiorex-payment', description: 'Kiorex', price: major(i.amountMinor), quantity: '1' };
  const signature = sha(`${i.merchantCode}${i.paymentId}${''}${i.returnUrl}${item.itemId}${item.quantity}${item.price}${i.secureKey}`);
  const chargeRequest = { merchantCode: i.merchantCode, merchantRefNum: i.paymentId, language: i.language ?? 'ar-eg', chargeItems: [item], returnUrl: i.returnUrl, orderWebHookUrl: i.webhookUrl, signature };
  return { pspRef: i.paymentId, checkoutUrl: `${i.apiUrl.replace(/\/+$/, '')}/ECommercePlugin/FawryPay.jsp?chargeRequest=${encodeURIComponent(JSON.stringify(chargeRequest))}` };
}
export const fawryCallbackSignature = (secureKey: string, b: any) => sha(`${b.fawryRefNumber}${b.merchantRefNumber}${Number(b.paymentAmount).toFixed(2)}${Number(b.orderAmount).toFixed(2)}${b.orderStatus}${b.paymentMethod}${b.paymentRefrenceNumber ?? ''}${secureKey}`);
export function verifyFawryCallback(secureKey: string, raw: string): any | null {
  let b: any; try { b = JSON.parse(raw); } catch { return null; }
  if (!secureKey || !b?.messageSignature || b.fawryRefNumber === undefined || !b.merchantRefNumber) return null;
  return eq(String(b.messageSignature), fawryCallbackSignature(secureKey, b)) ? b : null;
}

/** orderStatus -> event. The money fields are signed (paymentAmount, orderAmount) so the amount cannot be tampered; `refundAmount` (partial refunds) is NOT part of the signature, so a refund event is trusted only for the signed paymentAmount unless it is smaller. */
export function parseFawryCallback(b: any): (PspEvent & { paymentId: string }) | null {
  const status = String(b?.orderStatus ?? '').toUpperCase();
  const type = status === 'PAID' ? 'payment.captured' : status === 'REFUNDED' || status === 'PARTIAL_REFUNDED' ? 'refund.settled' : status === 'FAILED' || status === 'CANCELED' || status === 'EXPIRED' ? 'payment.failed' : null;
  if (!type) return null; // NEW / DELIVERED carry no money movement
  const paid = fromMajor(b.paymentAmount, 2);
  if (paid === null) return null;
  let amountMinor = paid;
  if (type === 'refund.settled') { const r = fromMajor(b.refundAmount, 2); if (r !== null && r > 0 && r <= paid) amountMinor = r; else if (status === 'PARTIAL_REFUNDED') return null; /* a partial refund without a readable amount is never guessed */ }
  const fees = fromMajor(b.fawryFees, 2);
  return {
    eventId: `fawry_${b.fawryRefNumber}_${status}${type === 'refund.settled' ? `_${amountMinor}` : ''}`, type, pspRef: type === 'refund.settled' ? `${b.fawryRefNumber}` : String(b.merchantRefNumber),
    orderRef: String(b.merchantRefNumber), paymentId: String(b.merchantRefNumber), amountMinor, currency: 'EGP',
    ...(type === 'refund.settled' ? { refundRef: `${b.fawryRefNumber}` } : {}),
    ...(fees !== null && fees > 0 && type === 'payment.captured' ? { feeMinor: fees } : {}),
    occurredAt: b.paymentTime ? new Date(Number(b.paymentTime)).toISOString() : new Date().toISOString(),
  };
}
export const fawryStatusUrl = (apiUrl: string, merchantCode: string, secureKey: string, merchantRefNumber: string) => `${apiUrl.replace(/\/+$/, '')}/ECommerceWeb/Fawry/payments/status/v2?merchantCode=${encodeURIComponent(merchantCode)}&merchantRefNumber=${encodeURIComponent(merchantRefNumber)}&signature=${sha(`${merchantCode}${merchantRefNumber}${secureKey}`)}`;
export const fawryRefundBody = (i: { merchantCode: string; secureKey: string; fawryRefNumber: string; amountMinor: number; reason?: string }) => { const reason = i.reason ?? 'Refund'; return { merchantCode: i.merchantCode, referenceNumber: i.fawryRefNumber, refundAmount: Number(major(i.amountMinor)), reason, signature: sha(`${i.merchantCode}${i.fawryRefNumber}${major(i.amountMinor)}${reason}${i.secureKey}`) }; };

/** Hosted-fields charge: the browser sends the card to Fawry and receives a token; the server charges the TOKEN. */
export function fawryChargeBody(i: { merchantCode: string; secureKey: string; paymentId: string; amountMinor: number; cardToken: string; returnUrl: string; customerProfileId?: string; description?: string }) {
  const amount = major(i.amountMinor); const profile = i.customerProfileId ?? '';
  return {
    merchantCode: i.merchantCode, merchantRefNum: i.paymentId, ...(profile ? { customerProfileId: profile } : {}), paymentMethod: 'CARD', cardToken: i.cardToken, amount: Number(amount), currencyCode: 'EGP', description: i.description ?? 'Kiorex',
    chargeItems: [{ itemId: 'kiorex-payment', description: 'Kiorex', price: Number(amount), quantity: 1 }], returnUrl: i.returnUrl,
    signature: sha(`${i.merchantCode}${i.paymentId}${profile}CARD${amount}${i.cardToken}${i.returnUrl}${i.secureKey}`),
  };
}
/** Charge response -> the state to record. A 3DS challenge answers with `nextAction.redirectUrl`. */
export function parseFawryCharge(json: any): { statusCode: number; pspRef?: string; redirectUrl?: string; status: 'PENDING' | 'PAID' | 'FAILED' } {
  const code = Number(json?.statusCode);
  const redirectUrl = json?.nextAction?.redirectUrl ?? json?.redirectUrl;
  const st = String(json?.paymentStatus ?? '').toUpperCase();
  return { statusCode: code, ...(json?.referenceNumber ? { pspRef: String(json.referenceNumber) } : {}), ...(typeof redirectUrl === 'string' ? { redirectUrl } : {}), status: st === 'PAID' ? 'PAID' : code === 200 && !redirectUrl && st !== 'UNPAID' ? 'PENDING' : code === 200 ? 'PENDING' : 'FAILED' };
}
export function parseFawryStatus(json: any): PspStatus & { fawryRefNumber?: string } {
  const st = String(json?.paymentStatus ?? json?.orderStatus ?? '').toUpperCase();
  const amount = fromMajor(json?.paymentAmount ?? json?.orderAmount, 2);
  const refunded = fromMajor(json?.refundAmount, 2);
  const state = st === 'PAID' ? 'CAPTURED' : st === 'REFUNDED' ? 'REFUNDED' : st === 'PARTIAL_REFUNDED' ? 'PARTIALLY_REFUNDED' : st === 'FAILED' || st === 'CANCELED' || st === 'EXPIRED' ? 'FAILED' : st === 'UNPAID' || st === 'NEW' ? 'PENDING' : 'UNKNOWN';
  return { state, ...(amount !== null ? { amountMinor: amount } : {}), ...(refunded !== null ? { refundedMinor: refunded } : {}), currency: 'EGP', ...(json?.fawryRefNumber ? { fawryRefNumber: String(json.fawryRefNumber) } : {}) };
}
