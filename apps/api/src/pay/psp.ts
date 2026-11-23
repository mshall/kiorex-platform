import { createHmac } from 'node:crypto';
import { cfg } from '../common/config';
import { safeEqual } from '../common/crypto';
import { outboundFetch } from '../common/outbound-http';
import { providerEnv, providerProblems, type ProviderEnv } from '../common/providers/env';
import { enabledPsps, FawryPspAdapter, instapayEnv, PaymobPspAdapter, PSP_VENDOR_MODE, vendorPspProblems } from './psp.vendors';
import { providerRequest, type FetchLike } from '../common/providers/http';
import { paymentMapping, type PaymentMapping } from '../common/providers/payment.mapping';

export type PspName = 'paymob' | 'fawry' | 'instapay';
export const PSP_NAMES: PspName[] = ['paymob', 'fawry', 'instapay'];

export interface PspWebhookEvent {
  eventId: string;
  type: 'payment.captured' | 'payment.failed' | 'refund.settled';
  pspRef: string;
  paymentId?: string;
  amountMinor: number;
  feeMinor?: number;
  occurredAt: string;
}

export interface PspAdapter {
  name: PspName;
  createCheckout(i: { paymentId: string; amountMinor: number; currency: string }): Promise<{ pspRef: string; checkoutUrl: string }>;
  /** `query` carries vendor signatures that travel in the URL (Paymob `hmac`). */
  verifyWebhook(rawBody: string, headers: Record<string, unknown>, query?: Record<string, unknown>): PspWebhookEvent | null;
  refund(i: { pspRef: string; refundId: string; amountMinor: number }): Promise<{ pspRefundRef: string }>;
}

/** PSP_MODE=sandbox-fake: hosted checkout served by this API; webhook = HMAC(raw body) with PSP_FAKE_WEBHOOK_SECRET. */
export class FakePspAdapter implements PspAdapter {
  constructor(public name: PspName) {}
  async createCheckout(i: { paymentId: string; amountMinor: number }) {
    return { pspRef: `fake_${this.name}_${i.paymentId}`, checkoutUrl: `${cfg().publicBaseUrl}/api/v1/pay/fake-checkout/${i.paymentId}` };
  }
  static sign(raw: string): string { return createHmac('sha256', cfg().pspFakeSecret).update(raw).digest('hex'); }
  verifyWebhook(raw: string, headers: Record<string, unknown>): PspWebhookEvent | null {
    const sig = String(headers['x-psp-signature'] ?? '');
    if (!sig || !safeEqual(sig, FakePspAdapter.sign(raw))) return null;
    return JSON.parse(raw) as PspWebhookEvent;
  }
  async refund(i: { refundId: string }) { return { pspRefundRef: `fake_rf_${i.refundId}` }; }
}

/**
 * PAYMENT_MODE=real: generic HTTP PSP driven only by PAYMENT_API_URL / PAYMENT_API_KEY / PAYMENT_WEBHOOK_SECRET (see common/providers
 * and Docs/PROVIDERS.md). Checkout creation is idempotent on the payment id, refunds on the refund id (Idempotency-Key header), so a
 * retried call can never create a second charge or a second refund. Webhooks are HMAC verified by the mapping.
 */
export class HttpPspAdapter implements PspAdapter {
  constructor(public name: PspName, private readonly mapping: PaymentMapping = paymentMapping, private readonly fetchImpl: FetchLike = outboundFetch, private readonly envOverride?: () => ProviderEnv) {}
  private get env() { return this.envOverride?.() ?? providerEnv('PAYMENT'); }
  async createCheckout(i: { paymentId: string; amountMinor: number; currency: string }) {
    const w = this.mapping.buildCheckout(i);
    const r = await providerRequest(this.env, { path: w.path, body: w.body, idempotencyKey: `checkout:${i.paymentId}` }, { fetchImpl: this.fetchImpl }, this.mapping.authHeaders(this.env.apiKey));
    return this.mapping.parseCheckout(r.json);
  }
  verifyWebhook(raw: string, headers: Record<string, unknown>): PspWebhookEvent | null {
    if (!this.mapping.verifyWebhook({ secret: this.env.webhookSecret, rawBody: raw, headers })) return null;
    return this.mapping.parseWebhook(raw);
  }
  async refund(i: { pspRef: string; refundId: string; amountMinor: number }) {
    const w = this.mapping.buildRefund(i);
    const r = await providerRequest(this.env, { path: w.path, body: w.body, idempotencyKey: `refund:${i.refundId}` }, { fetchImpl: this.fetchImpl }, this.mapping.authHeaders(this.env.apiKey));
    return this.mapping.parseRefund(r.json);
  }
}

/** Real mode without usable config (startup check normally prevents this): fails closed. */
export class UnconfiguredPspAdapter implements PspAdapter {
  constructor(public name: PspName) {}
  async createCheckout(): Promise<never> { throw new Error(`NEEDS_HUMAN: ${this.name} adapter not configured (set PAYMENT_API_URL / PAYMENT_API_KEY / PAYMENT_WEBHOOK_SECRET; see Docs/PROVIDERS.md)`); }
  verifyWebhook(): PspWebhookEvent | null { return null; }
  async refund(): Promise<never> { throw new Error(`NEEDS_HUMAN: ${this.name} adapter not configured`); }
}

export function pspAdapter(name: string): PspAdapter {
  const n = (PSP_NAMES.includes(name as PspName) ? name : 'paymob') as PspName;
  if (cfg().pspMode === 'sandbox-fake') return new FakePspAdapter(n);
  if (PSP_VENDOR_MODE()) { // PAYMENT_PROVIDER=vendor: native Paymob / Fawry / InstaPay clients, credentials per PSP
    if (vendorPspProblems().length) return new UnconfiguredPspAdapter(n);
    const on = enabledPsps(); const use = on.includes(n) ? n : on[0];
    return use === 'paymob' ? new PaymobPspAdapter() : use === 'fawry' ? new FawryPspAdapter() : new HttpPspAdapter('instapay', paymentMapping, outboundFetch, () => instapayEnv());
  }
  return providerProblems('PAYMENT').length ? new UnconfiguredPspAdapter(n) : new HttpPspAdapter(n);
}
