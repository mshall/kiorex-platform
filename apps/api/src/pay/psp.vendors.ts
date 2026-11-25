import { cfg } from '../common/config';
import { outboundFetch } from '../common/outbound-http';
import { providerEnv, type ProviderEnv } from '../common/providers/env';
import { providerRequest, type FetchLike } from '../common/providers/http';
import { paymentMapping } from '../common/providers/payment.mapping';
import { fawryChargeBody, fawryCheckoutUrl, fawryRefundBody, fawryStatusUrl, parseFawryCallback, parseFawryCharge, parseFawryStatus, verifyFawryCallback } from '../common/providers/vendors/fawry';
import { paymobAuth, paymobCaptureBody, paymobInquiryBody, paymobIntentionBody, paymobRefundBody, paymobTransactionIdFromInquiry, paymobVoidBody, parsePaymobCallback, parsePaymobInquiry, parsePaymobIntention, verifyPaymobHmac } from '../common/providers/vendors/paymob';
import { enabledPsps as _e, PSP_VENDOR_MODE as _v, vendorPspProblems as _p } from '../common/providers/problems';
import { readyWalletMethods, walletConfigFromEnv } from '@kiorex/pay-contract';
import { PSP_CAPS, PSP_DEFAULTS, type PspName, type PspSettings } from './psp-config';
import { HttpPspAdapter } from './psp-http';
import type { PspAdapter, PspCapabilities, PspCheckoutInput, PspStatus, PspWebhookEvent } from './psp-types';

type Env = Record<string, string | undefined>;
export const enabledPsps = _e;
export const PSP_VENDOR_MODE = _v;
export const vendorPspProblems = _p;

/** Sandbox vs live hosts. Paymob serves both modes from one host (the KEYS differ); Fawry has a staging host; the neutral gateways have no default (their URL is configuration). */
const DEFAULTS: Record<PspName, { sandbox: string; live: string }> = { paymob: { sandbox: 'https://accept.paymob.com', live: 'https://accept.paymob.com' }, fawry: { sandbox: 'https://atfawry.fawrystaging.com', live: 'https://www.atfawry.com' }, instapay: { sandbox: '', live: '' }, card: { sandbox: '', live: '' }, bank_ipn: { sandbox: '', live: '' } };
const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && v ? Math.floor(n) : d; };
const pepperOf = (env: Env) => env.PAYMENT_FINGERPRINT_PEPPER ?? '';

/** Transport env for one PSP: timeouts and retry budget come from the resolved settings (config, not code). */
function transport(name: PspName, apiKey: string, env: Env, s: PspSettings, retries = s.maxRetries): ProviderEnv {
  const P = name.toUpperCase();
  return { kind: 'PAYMENT', mode: 'real', provider: name, publicWebhookUrl: '', apiUrl: ((env[`${P}_API_URL`] ?? '').trim() || DEFAULTS[name][s.mode]).replace(/\/+$/, ''), apiKey, senderId: '', webhookSecret: '', timeoutMs: s.timeoutMs, maxRetries: retries };
}

const returnUrl = (paymentId: string) => `${cfg().webBaseUrl}/pay/return?payment=${encodeURIComponent(paymentId)}`;
const notifyUrl = (psp: PspName) => `${cfg().publicBaseUrl}/api/v1/pay/webhooks/${psp}`;
const ids = (v: string | undefined) => (v ?? '').split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n));

export class PaymobPspAdapter implements PspAdapter {
  readonly name = 'paymob' as const;
  readonly capabilities: PspCapabilities = { capture: PSP_CAPS.paymob.capture, void: true, status: true, partialRefund: true, hostedCheckout: true, cardFacts: true };
  constructor(private readonly env: Env = process.env, private readonly fetchImpl: FetchLike = outboundFetch, private readonly s: PspSettings = PSP_DEFAULTS) {}
  private t(retries?: number) { return transport('paymob', this.env.PAYMOB_SECRET_KEY ?? '', this.env, this.s, retries); }
  async createCheckout(i: PspCheckoutInput) {
    const t = this.t();
    const wallet = i.rail === 'wallet' ? readyWalletMethods(walletConfigFromEnv(this.env, 'paymob')).find((m) => !i.method || m.key === i.method) : undefined;
    if (i.rail === 'wallet' && !wallet) throw new Error('NEEDS_HUMAN: no Paymob wallet integration is configured for this method (PAYMOB_WALLET_INTEGRATION_IDS)');
    const integrationIds = wallet ? [wallet.integrationId as number] : ids(i.captureMode === 'MANUAL' && this.env.PAYMOB_AUTH_INTEGRATION_IDS ? this.env.PAYMOB_AUTH_INTEGRATION_IDS : this.env.PAYMOB_INTEGRATION_IDS);
    const r = await providerRequest(t, { path: '/v1/intention/', body: paymobIntentionBody({ paymentId: i.paymentId, amountMinor: i.amountMinor, currency: i.currency, integrationIds, notificationUrl: notifyUrl('paymob'), redirectionUrl: returnUrl(i.paymentId) }), idempotencyKey: `checkout:${i.paymentId}` }, { fetchImpl: this.fetchImpl }, paymobAuth(t.apiKey));
    return parsePaymobIntention(r.json, t.apiUrl, this.env.PAYMOB_PUBLIC_KEY ?? '');
  }
  /** Paymob signs the transaction callback with HMAC-SHA512 carried in the `hmac` query parameter. */
  verifyWebhook(raw: string, _headers: Record<string, unknown>, query: Record<string, unknown> = {}): PspWebhookEvent | null {
    let obj: any; try { obj = JSON.parse(raw)?.obj; } catch { return null; }
    if (!obj || !verifyPaymobHmac(this.env.PAYMOB_HMAC_SECRET ?? '', obj, String(query.hmac ?? ''))) return null;
    return parsePaymobCallback(raw, { psp: 'paymob', pepper: pepperOf(this.env) });
  }
  /** One inquiry gives the original transaction id AND what was already refunded, so a retried refund whose first attempt reached Paymob is recognised instead of refunding twice (the refund POST itself is never auto-retried). */
  private async inquire(pspRef: string) {
    const t = this.t();
    const inq = await providerRequest(t, { path: '/api/ecommerce/orders/transaction_inquiry', body: paymobInquiryBody({ orderId: pspRef }) }, { fetchImpl: this.fetchImpl }, paymobAuth(t.apiKey));
    return inq.json;
  }
  async refund(i: { pspRef: string; refundId: string; amountMinor: number; priorRefundedMinor?: number }) {
    const t0 = this.t(0); const auth = paymobAuth(t0.apiKey);
    const inq = await this.inquire(i.pspRef); const st = parsePaymobInquiry(inq, { psp: 'paymob' });
    if (i.priorRefundedMinor !== undefined && (st.refundedMinor ?? 0) >= i.priorRefundedMinor + i.amountMinor) return { pspRefundRef: `paymob_refund_${i.refundId}` }; // already applied at Paymob
    const r = await providerRequest(t0, { path: '/api/acceptance/void_refund/refund', body: paymobRefundBody(paymobTransactionIdFromInquiry(inq), i.amountMinor), idempotencyKey: `refund:${i.refundId}` }, { fetchImpl: this.fetchImpl }, auth);
    const id = r.json?.id; if (id === undefined) throw new Error('no refund id in Paymob response');
    return { pspRefundRef: String(id) };
  }
  async capture(i: { pspRef: string; paymentId: string; amountMinor: number }) {
    const t0 = this.t(0); const inq = await this.inquire(i.pspRef); const st = parsePaymobInquiry(inq);
    if (st.state === 'CAPTURED') return { pspCaptureRef: `paymob_capture_${i.paymentId}` };
    const r = await providerRequest(t0, { path: '/api/acceptance/capture', body: paymobCaptureBody(paymobTransactionIdFromInquiry(inq), i.amountMinor), idempotencyKey: `capture:${i.paymentId}` }, { fetchImpl: this.fetchImpl }, paymobAuth(t0.apiKey));
    return { pspCaptureRef: String(r.json?.id ?? `paymob_capture_${i.paymentId}`) };
  }
  async void(i: { pspRef: string; paymentId: string }) {
    const t0 = this.t(0); const inq = await this.inquire(i.pspRef); const st = parsePaymobInquiry(inq);
    if (st.state === 'VOIDED') return { pspVoidRef: `paymob_void_${i.paymentId}` };
    const r = await providerRequest(t0, { path: '/api/acceptance/void_refund/void', body: paymobVoidBody(paymobTransactionIdFromInquiry(inq)), idempotencyKey: `void:${i.paymentId}` }, { fetchImpl: this.fetchImpl }, paymobAuth(t0.apiKey));
    return { pspVoidRef: String(r.json?.id ?? `paymob_void_${i.paymentId}`) };
  }
  async status(i: { pspRef: string }): Promise<PspStatus> {
    try { return parsePaymobInquiry(await this.inquire(i.pspRef), { psp: 'paymob', pepper: pepperOf(this.env) }); }
    catch (e) { if ((e as { status?: number }).status === 404) return { state: 'PENDING' }; throw e; } // no transaction yet: the customer has not paid
  }
}

export class FawryPspAdapter implements PspAdapter {
  readonly name = 'fawry' as const;
  readonly capabilities: PspCapabilities = { capture: false, void: false, status: true, partialRefund: true, hostedCheckout: true, cardFacts: false };
  constructor(private readonly env: Env = process.env, private readonly fetchImpl: FetchLike = outboundFetch, private readonly s: PspSettings = PSP_DEFAULTS) {}
  private t(retries?: number) { return transport('fawry', '', this.env, this.s, retries); }
  private get code() { return this.env.FAWRY_MERCHANT_CODE ?? ''; }
  private get key() { return this.env.FAWRY_SECURE_KEY ?? ''; }
  async createCheckout(i: PspCheckoutInput) {
    return fawryCheckoutUrl({ apiUrl: this.t().apiUrl, merchantCode: this.code, secureKey: this.key, paymentId: i.paymentId, amountMinor: i.amountMinor, returnUrl: returnUrl(i.paymentId), webhookUrl: notifyUrl('fawry') });
  }
  /** Hosted-fields charge with a card TOKEN produced in the browser by Fawry's own script (the server never sees the card). Returns the redirect for a 3DS challenge when Fawry asks for one. */
  async charge(i: { paymentId: string; amountMinor: number; cardToken: string; customerProfileId?: string }) {
    const r = await providerRequest(this.t(0), { path: '/ECommerceWeb/Fawry/payments/charge', body: fawryChargeBody({ merchantCode: this.code, secureKey: this.key, paymentId: i.paymentId, amountMinor: i.amountMinor, cardToken: i.cardToken, returnUrl: returnUrl(i.paymentId), customerProfileId: i.customerProfileId }), idempotencyKey: `charge:${i.paymentId}` }, { fetchImpl: this.fetchImpl });
    return parseFawryCharge(r.json);
  }
  verifyWebhook(raw: string): PspWebhookEvent | null {
    const b = verifyFawryCallback(this.key, raw);
    return b ? parseFawryCallback(b) : null;
  }
  async status(i: { pspRef: string; paymentId: string }): Promise<PspStatus> {
    const t = this.t();
    const st = await providerRequest(t, { method: 'GET', path: '', absoluteUrl: fawryStatusUrl(t.apiUrl, this.code, this.key, i.paymentId) }, { fetchImpl: this.fetchImpl });
    const { fawryRefNumber: _f, ...out } = parseFawryStatus(st.json);
    return out;
  }
  async refund(i: { pspRef: string; refundId: string; amountMinor: number; priorRefundedMinor?: number }) {
    const t = this.t(0);
    const st = await providerRequest(this.t(), { method: 'GET', path: '', absoluteUrl: fawryStatusUrl(t.apiUrl, this.code, this.key, i.pspRef) }, { fetchImpl: this.fetchImpl });
    const ref = st.json?.fawryRefNumber; if (!ref) throw new Error('Fawry status has no fawryRefNumber');
    if (i.priorRefundedMinor !== undefined && (parseFawryStatus(st.json).refundedMinor ?? 0) >= i.priorRefundedMinor + i.amountMinor) return { pspRefundRef: String(ref) }; // already applied at Fawry
    const r = await providerRequest(t, { path: '/ECommerceWeb/Fawry/payments/refund', body: fawryRefundBody({ merchantCode: this.code, secureKey: this.key, fawryRefNumber: String(ref), amountMinor: i.amountMinor, reason: `refund ${i.refundId}` }), idempotencyKey: `refund:${i.refundId}` }, { fetchImpl: this.fetchImpl });
    if (Number(r.json?.statusCode) !== 200) throw new Error(`Fawry refund rejected (${String(r.json?.statusCode ?? 'unknown')})`);
    return { pspRefundRef: String(ref) };
  }
}

/** Environment for the neutral gateway contract of an acquirer-fronted PSP (InstaPay has no public merchant API: it is reached through the acquiring bank / PSP gateway). */
export const instapayEnv = (env: Env = process.env): ProviderEnv => ({ ...providerEnv('PAYMENT', {}), mode: 'real', provider: 'gateway', apiUrl: (env.INSTAPAY_API_URL ?? '').trim().replace(/\/+$/, ''), apiKey: env.INSTAPAY_API_KEY ?? '', webhookSecret: env.INSTAPAY_WEBHOOK_SECRET ?? '', timeoutMs: num(env.PAYMENT_TIMEOUT_MS, 8000), maxRetries: num(env.PAYMENT_MAX_RETRIES, 2) });
/** The generic card gateway (any acquirer / PSP that speaks the neutral contract in payment.mapping.ts). */
export const cardGatewayEnv = (env: Env = process.env): ProviderEnv => ({ ...providerEnv('PAYMENT', {}), mode: 'real', provider: 'gateway', apiUrl: (env.CARDGW_API_URL ?? '').trim().replace(/\/+$/, ''), apiKey: env.CARDGW_API_KEY ?? '', webhookSecret: env.CARDGW_WEBHOOK_SECRET ?? '', timeoutMs: num(env.PAYMENT_TIMEOUT_MS, 8000), maxRetries: num(env.PAYMENT_MAX_RETRIES, 2) });

export class CardGatewayPspAdapter extends HttpPspAdapter {
  constructor(env: Env = process.env, fetchImpl: FetchLike = outboundFetch, s: PspSettings = PSP_DEFAULTS) { super('card', paymentMapping, fetchImpl, () => cardGatewayEnv(env), s, pepperOf(env)); }
}
