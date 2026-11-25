import { createHmac } from 'node:crypto';
import { cfg } from '../common/config';
import { safeEqual } from '../common/crypto';
import { outboundFetch } from '../common/outbound-http';
import { providerProblems } from '../common/providers/env';
import { paymentMapping } from '../common/providers/payment.mapping';
import { breakerFor } from './psp-breaker';
import { PSP_NAMES, resolveSettings, type PspName, type PspSettings } from './psp-config';
import { HttpPspAdapter } from './psp-http';
import { recordingFetch } from './psp-recorder';
import { assertRealModeApproved, realModeDecision, RealModeNotApprovedError } from '../common/providers/mode-guard';
import type { PspAdapter, PspCapabilities, PspCheckoutInput, PspWebhookEvent } from './psp-types';
import { BankIpnPspAdapter } from './psp-bank-ipn';
import { CardGatewayPspAdapter, enabledPsps, FawryPspAdapter, instapayEnv, PaymobPspAdapter, PSP_VENDOR_MODE, vendorPspProblems } from './psp.vendors';

export { PSP_NAMES, type PspName };
export { NO_CAPS, type PspAdapter, type PspCapabilities, type PspCheckoutInput, type PspStatus, type PspWebhookEvent } from './psp-types';
export { HttpPspAdapter } from './psp-http';

/** PSP_MODE=sandbox-fake: hosted checkout served by this API; webhook = HMAC(raw body) with PSP_FAKE_WEBHOOK_SECRET. */
export class FakePspAdapter implements PspAdapter {
  capabilities: PspCapabilities = { capture: true, void: true, status: false, partialRefund: true, hostedCheckout: true, cardFacts: false };
  constructor(public name: PspName) {}
  async createCheckout(i: { paymentId: string; amountMinor: number }) {
    return { pspRef: `fake_${this.name}_${i.paymentId}`, checkoutUrl: `${cfg().publicBaseUrl}/api/v1/pay/fake-checkout/${i.paymentId}` };
  }
  static sign(raw: string): string { return createHmac('sha256', cfg().pspFakeSecret).update(raw).digest('hex'); }
  verifyWebhook(raw: string, headers: Record<string, unknown>): PspWebhookEvent | null {
    const sig = String(headers['x-psp-signature'] ?? '');
    if (!sig || !safeEqual(sig, FakePspAdapter.sign(raw))) return null;
    const ev = JSON.parse(raw) as PspWebhookEvent;
    return ev && typeof ev === 'object' && !Array.isArray(ev) ? ev : null;
  }
  async refund(i: { refundId: string }) { return { pspRefundRef: `fake_rf_${i.refundId}` }; }
  async capture(i: { paymentId: string }) { return { pspCaptureRef: `fake_cap_${i.paymentId}` }; }
  async void(i: { paymentId: string }) { return { pspVoidRef: `fake_void_${i.paymentId}` }; }
}

/** Real mode that the approved INTEGRATION_MODES record does not allow: every outbound call fails CLOSED with NEEDS_HUMAN, and no webhook is accepted (the PSP is not live for us yet). */
export class RealModeBlockedPspAdapter implements PspAdapter {
  capabilities = undefined;
  constructor(public name: PspName, private readonly key: string) {}
  private fail(): never { assertRealModeApproved(this.key); throw new RealModeNotApprovedError(this.key, 'blocked'); }
  async createCheckout(): Promise<never> { return this.fail(); }
  verifyWebhook(): PspWebhookEvent | null { return null; }
  async refund(): Promise<never> { return this.fail(); }
  async capture(): Promise<never> { return this.fail(); }
  async void(): Promise<never> { return this.fail(); }
  async status(): Promise<never> { return this.fail(); }
}
/** The Integrations Control Center key of each PSP. */
export const PSP_INTEGRATION_KEY: Record<PspName, string> = { paymob: 'PAYMOB', fawry: 'FAWRY', instapay: 'INSTAPAY', card: 'CARD_GATEWAY', bank_ipn: 'BANK_IPN' };

/** Real mode without usable config (startup check normally prevents this): fails closed. */
export class UnconfiguredPspAdapter implements PspAdapter {
  constructor(public name: PspName) {}
  async createCheckout(): Promise<never> { throw new Error(`NEEDS_HUMAN: ${this.name} adapter not configured (set PAYMENT_API_URL / PAYMENT_API_KEY / PAYMENT_WEBHOOK_SECRET; see Docs/PROVIDERS.md)`); }
  verifyWebhook(): PspWebhookEvent | null { return null; }
  async refund(): Promise<never> { throw new Error(`NEEDS_HUMAN: ${this.name} adapter not configured`); }
}

/** Wraps every outbound PSP call in the per-PSP circuit breaker. Webhook verification is local and never goes through it. */
export class GuardedPspAdapter implements PspAdapter {
  constructor(private readonly inner: PspAdapter, private readonly s: PspSettings) {}
  get name() { return this.inner.name; }
  get capabilities() { return this.inner.capabilities; }
  private b() { return breakerFor(`${this.inner.name}:${this.s.mode}`, this.s.breaker); }
  createCheckout(i: PspCheckoutInput) { return this.b().exec(() => this.inner.createCheckout(i)); }
  verifyWebhook(raw: string, headers: Record<string, unknown>, query?: Record<string, unknown>) { return this.inner.verifyWebhook(raw, headers, query); }
  refund(i: Parameters<PspAdapter['refund']>[0]) { return this.b().exec(() => this.inner.refund(i)); }
  get capture() { const f = this.inner.capture?.bind(this.inner); return f ? (i: { pspRef: string; paymentId: string; amountMinor: number }) => this.b().exec(() => f(i)) : undefined; }
  get void() { const f = this.inner.void?.bind(this.inner); return f ? (i: { pspRef: string; paymentId: string }) => this.b().exec(() => f(i)) : undefined; }
  get status() { const f = this.inner.status?.bind(this.inner); return f ? (i: { pspRef: string; paymentId: string }) => this.b().exec(() => f(i)) : undefined; }
}

/** Test hook: lets an integration test run PayService against a real vendor adapter wired to an injected fetch (never set in production code). */
let override: ((name: PspName, settings?: PspSettings) => PspAdapter | null) | null = null;
export const __setPspAdapterOverride = (f: ((name: PspName, settings?: PspSettings) => PspAdapter | null) | null) => { override = f; };

/** The adapter for a PSP name. `settings` (resolved per PSP and market) carries timeouts, retry budgets, webhook tolerance and the sandbox/live mode. */
export function pspAdapter(name: string, settings?: PspSettings): PspAdapter {
  const n = (PSP_NAMES.includes(name as PspName) ? name : 'paymob') as PspName;
  const s = settings ?? resolveSettings(n, '*');
  const o = override?.(n, s); if (o) return o instanceof GuardedPspAdapter ? o : new GuardedPspAdapter(o, s);
  if (cfg().pspMode === 'sandbox-fake') return new FakePspAdapter(n);
  if (PSP_VENDOR_MODE()) { // PAYMENT_PROVIDER=vendor: native Paymob / Fawry clients, InstaPay and the card gateway on the neutral contract, credentials per PSP
    if (vendorPspProblems().length) return new UnconfiguredPspAdapter(n);
    const on = enabledPsps(); const use = on.includes(n) ? n : on[0];
    if (!realModeDecision(PSP_INTEGRATION_KEY[use]).allowed) return new RealModeBlockedPspAdapter(use, PSP_INTEGRATION_KEY[use]);
    const s2 = use === n ? s : resolveSettings(use, '*');
    const rf = recordingFetch(outboundFetch);
    const inner: PspAdapter = use === 'bank_ipn' ? new BankIpnPspAdapter(process.env) : use === 'paymob' ? new PaymobPspAdapter(process.env, rf, s2) : use === 'fawry' ? new FawryPspAdapter(process.env, rf, s2) : use === 'card' ? new CardGatewayPspAdapter(process.env, rf, s2) : new HttpPspAdapter('instapay', paymentMapping, rf, () => instapayEnv(), s2);
    return new GuardedPspAdapter(inner, s2);
  }
  if (!providerProblems('PAYMENT').length && !realModeDecision(PSP_INTEGRATION_KEY[n]).allowed) return new RealModeBlockedPspAdapter(n, PSP_INTEGRATION_KEY[n]);
  return providerProblems('PAYMENT').length ? new UnconfiguredPspAdapter(n) : new GuardedPspAdapter(new HttpPspAdapter(n, paymentMapping, recordingFetch(outboundFetch), undefined, s), s);
}
