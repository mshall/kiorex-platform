import { cfg } from '../common/config';
import { outboundFetch } from '../common/outbound-http';
import { providerEnv, type ProviderEnv } from '../common/providers/env';
import { providerRequest, type FetchLike } from '../common/providers/http';
import { fawryCheckoutUrl, fawryRefundBody, fawryStatusUrl, parseFawryCallback, verifyFawryCallback } from '../common/providers/vendors/fawry';
import { paymobAuth, paymobIntentionBody, paymobRefundBody, paymobTransactionIdFromInquiry, parsePaymobCallback, parsePaymobIntention, verifyPaymobHmac } from '../common/providers/vendors/paymob';
import type { PspAdapter, PspName, PspWebhookEvent } from './psp';
import { enabledPsps as _e, PSP_VENDOR_MODE as _v, vendorPspProblems as _p } from '../common/providers/problems';

type Env = Record<string, string | undefined>;
export const enabledPsps = _e;
export const PSP_VENDOR_MODE = _v;
export const vendorPspProblems = _p;

const DEFAULTS: Record<PspName, string> = { paymob: 'https://accept.paymob.com', fawry: 'https://www.atfawry.com', instapay: '' };
const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && v ? Math.floor(n) : d; };

/** Transport env for one PSP (timeouts and retries shared with PAYMENT_*). */
function transport(name: PspName, apiKey: string, env: Env): ProviderEnv {
  const P = name.toUpperCase();
  return { kind: 'PAYMENT', mode: 'real', provider: name, publicWebhookUrl: '', apiUrl: ((env[`${P}_API_URL`] ?? '').trim() || DEFAULTS[name]).replace(/\/+$/, ''), apiKey, senderId: '', webhookSecret: '', timeoutMs: num(env.PAYMENT_TIMEOUT_MS, 8000), maxRetries: num(env.PAYMENT_MAX_RETRIES, 2) };
}

const returnUrl = (paymentId: string) => `${cfg().webBaseUrl}/pay/return?payment=${encodeURIComponent(paymentId)}`;
const notifyUrl = (psp: PspName) => `${cfg().publicBaseUrl}/api/v1/pay/webhooks/${psp}`;

export class PaymobPspAdapter implements PspAdapter {
  readonly name = 'paymob' as const;
  constructor(private readonly env: Env = process.env, private readonly fetchImpl: FetchLike = outboundFetch) {}
  private get t() { return transport('paymob', this.env.PAYMOB_SECRET_KEY ?? '', this.env); }
  async createCheckout(i: { paymentId: string; amountMinor: number; currency: string }) {
    const ids = (this.env.PAYMOB_INTEGRATION_IDS ?? '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n));
    const r = await providerRequest(this.t, { path: '/v1/intention/', body: paymobIntentionBody({ ...i, integrationIds: ids, notificationUrl: notifyUrl('paymob'), redirectionUrl: returnUrl(i.paymentId) }), idempotencyKey: `checkout:${i.paymentId}` }, { fetchImpl: this.fetchImpl }, paymobAuth(this.t.apiKey));
    return parsePaymobIntention(r.json, this.t.apiUrl, this.env.PAYMOB_PUBLIC_KEY ?? '');
  }
  /** Paymob signs the transaction callback with HMAC-SHA512 carried in the `hmac` query parameter. */
  verifyWebhook(raw: string, _headers: Record<string, unknown>, query: Record<string, unknown> = {}): PspWebhookEvent | null {
    let obj: any; try { obj = JSON.parse(raw)?.obj; } catch { return null; }
    if (!obj || !verifyPaymobHmac(this.env.PAYMOB_HMAC_SECRET ?? '', obj, String(query.hmac ?? ''))) return null;
    return parsePaymobCallback(raw);
  }
  async refund(i: { pspRef: string; refundId: string; amountMinor: number }) {
    const t = this.t; const auth = paymobAuth(t.apiKey);
    const inq = await providerRequest(t, { path: '/api/ecommerce/orders/transaction_inquiry', body: { order_id: i.pspRef } }, { fetchImpl: this.fetchImpl }, auth);
    const r = await providerRequest(t, { path: '/api/acceptance/void_refund/refund', body: paymobRefundBody(paymobTransactionIdFromInquiry(inq.json), i.amountMinor), idempotencyKey: `refund:${i.refundId}` }, { fetchImpl: this.fetchImpl }, auth);
    const id = r.json?.id; if (id === undefined) throw new Error('no refund id in Paymob response');
    return { pspRefundRef: String(id) };
  }
}

export class FawryPspAdapter implements PspAdapter {
  readonly name = 'fawry' as const;
  constructor(private readonly env: Env = process.env, private readonly fetchImpl: FetchLike = outboundFetch) {}
  private get t() { return transport('fawry', '', this.env); }
  async createCheckout(i: { paymentId: string; amountMinor: number; currency: string }) {
    return fawryCheckoutUrl({ apiUrl: this.t.apiUrl, merchantCode: this.env.FAWRY_MERCHANT_CODE ?? '', secureKey: this.env.FAWRY_SECURE_KEY ?? '', paymentId: i.paymentId, amountMinor: i.amountMinor, returnUrl: returnUrl(i.paymentId), webhookUrl: notifyUrl('fawry') });
  }
  verifyWebhook(raw: string): PspWebhookEvent | null {
    const b = verifyFawryCallback(this.env.FAWRY_SECURE_KEY ?? '', raw);
    return b ? parseFawryCallback(b) : null;
  }
  async refund(i: { pspRef: string; refundId: string; amountMinor: number }) {
    const code = this.env.FAWRY_MERCHANT_CODE ?? ''; const key = this.env.FAWRY_SECURE_KEY ?? '';
    const t = this.t;
    const st = await providerRequest(t, { method: 'GET', path: '', absoluteUrl: fawryStatusUrl(t.apiUrl, code, key, i.pspRef) }, { fetchImpl: this.fetchImpl });
    const ref = st.json?.fawryRefNumber; if (!ref) throw new Error('Fawry status has no fawryRefNumber');
    const r = await providerRequest(t, { path: '/ECommerceWeb/Fawry/payments/refund', body: fawryRefundBody({ merchantCode: code, secureKey: key, fawryRefNumber: String(ref), amountMinor: i.amountMinor, reason: `refund ${i.refundId}` }), idempotencyKey: `refund:${i.refundId}` }, { fetchImpl: this.fetchImpl });
    if (Number(r.json?.statusCode) !== 200) throw new Error(`Fawry refund rejected (${String(r.json?.statusCode ?? 'unknown')})`);
    return { pspRefundRef: String(ref) };
  }
}

/** Environment for the neutral gateway contract of an acquirer-fronted PSP (InstaPay has no public merchant API: it is reached through the acquiring bank / PSP gateway). */
export const instapayEnv = (env: Env = process.env): ProviderEnv => ({ ...providerEnv('PAYMENT', {}), mode: 'real', provider: 'gateway', apiUrl: (env.INSTAPAY_API_URL ?? '').trim().replace(/\/+$/, ''), apiKey: env.INSTAPAY_API_KEY ?? '', webhookSecret: env.INSTAPAY_WEBHOOK_SECRET ?? '', timeoutMs: num(env.PAYMENT_TIMEOUT_MS, 8000), maxRetries: num(env.PAYMENT_MAX_RETRIES, 2) });
