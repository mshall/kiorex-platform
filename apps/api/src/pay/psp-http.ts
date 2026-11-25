import { cfg } from '../common/config';
import { outboundFetch } from '../common/outbound-http';
import { providerEnv, type ProviderEnv } from '../common/providers/env';
import { providerRequest, type FetchLike } from '../common/providers/http';
import { paymentMapping, type PaymentMapping } from '../common/providers/payment.mapping';
import { PSP_CAPS, PSP_DEFAULTS, type PspName, type PspSettings } from './psp-config';
import type { PspAdapter, PspCapabilities, PspCheckoutInput, PspWebhookEvent } from './psp-types';

/**
 * Generic HTTP PSP (the card gateway and the InstaPay gateway) driven by the neutral contract in common/providers/payment.mapping.ts. Checkout creation is idempotent on the payment id,
 * refunds on the refund id, captures and voids on the payment id (Idempotency-Key header), so a retried call can never create a second charge, refund or capture.
 */
export class HttpPspAdapter implements PspAdapter {
  capabilities: PspCapabilities;
  constructor(public name: PspName, private readonly mapping: PaymentMapping = paymentMapping, private readonly fetchImpl: FetchLike = outboundFetch, private readonly envOverride?: () => ProviderEnv, private readonly settings: PspSettings = PSP_DEFAULTS, private readonly pepper = process.env.PAYMENT_FINGERPRINT_PEPPER ?? '') {
    const c = PSP_CAPS[name];
    this.capabilities = { capture: c.capture, void: c.capture, status: true, partialRefund: c.partialRefund, hostedCheckout: true, cardFacts: name === 'card' };
  }
  private get env(): ProviderEnv { const e = this.envOverride?.() ?? providerEnv('PAYMENT'); return { ...e, timeoutMs: this.settings.timeoutMs, maxRetries: this.settings.maxRetries }; }
  private call(path: string, body: unknown, key: string, method: 'POST' | 'GET' = 'POST') {
    return providerRequest(this.env, { path, ...(method === 'GET' ? { method } : { body }), idempotencyKey: key }, { fetchImpl: this.fetchImpl }, this.mapping.authHeaders(this.env.apiKey));
  }
  async createCheckout(i: PspCheckoutInput) {
    const w = this.mapping.buildCheckout({ paymentId: i.paymentId, amountMinor: i.amountMinor, currency: i.currency, capture: (i.captureMode ?? 'AUTO') === 'AUTO', threeDs: i.threeDsMode === 'REQUIRED' ? 'required' : i.threeDsMode === 'OFF' ? 'off' : 'preferred', returnUrl: `${cfg().webBaseUrl}/pay/return?payment=${encodeURIComponent(i.paymentId)}`, webhookUrl: `${cfg().publicBaseUrl}/api/v1/pay/webhooks/${this.name}` });
    const r = await this.call(w.path, w.body, `checkout:${i.paymentId}`);
    return this.mapping.parseCheckout(r.json);
  }
  verifyWebhook(raw: string, headers: Record<string, unknown>): PspWebhookEvent | null {
    if (!this.mapping.verifyWebhook({ secret: this.env.webhookSecret, rawBody: raw, headers, toleranceSeconds: this.settings.webhookToleranceSec })) return null;
    return this.mapping.parseWebhook(raw, { psp: this.name, pepper: this.pepper });
  }
  async refund(i: { pspRef: string; refundId: string; amountMinor: number }) {
    const w = this.mapping.buildRefund(i);
    const r = await this.call(w.path, w.body, `refund:${i.refundId}`);
    return this.mapping.parseRefund(r.json);
  }
  async capture(i: { pspRef: string; paymentId: string; amountMinor: number }) {
    const w = this.mapping.buildCapture(i);
    const r = await this.call(w.path, w.body, `capture:${i.paymentId}`);
    return { pspCaptureRef: String(r.json?.id ?? r.json?.data?.id ?? i.pspRef) };
  }
  async void(i: { pspRef: string; paymentId: string }) {
    const w = this.mapping.buildVoid(i);
    const r = await this.call(w.path, w.body, `void:${i.paymentId}`);
    return { pspVoidRef: String(r.json?.id ?? r.json?.data?.id ?? i.pspRef) };
  }
  async status(i: { pspRef: string }) {
    const w = this.mapping.buildStatus(i);
    const r = await this.call(w.path, undefined, `status:${i.pspRef}`, 'GET');
    return this.mapping.parseStatus(r.json, { psp: this.name, pepper: this.pepper });
  }
}

