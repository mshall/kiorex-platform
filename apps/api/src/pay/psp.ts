import { createHmac } from 'node:crypto';
import { cfg } from '../common/config';
import { safeEqual } from '../common/crypto';

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
  verifyWebhook(rawBody: string, headers: Record<string, unknown>): PspWebhookEvent | null;
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

/** Real PSPs: credentials, payloads and settlement formats are NEEDS_HUMAN (PSP onboarding). */
export class UnconfiguredPspAdapter implements PspAdapter {
  constructor(public name: PspName) {}
  async createCheckout(): Promise<never> { throw new Error(`NEEDS_HUMAN: ${this.name} adapter not configured (PSP onboarding + credentials)`); }
  verifyWebhook(): PspWebhookEvent | null { return null; }
  async refund(): Promise<never> { throw new Error(`NEEDS_HUMAN: ${this.name} adapter not configured`); }
}

export function pspAdapter(name: string): PspAdapter {
  const n = (PSP_NAMES.includes(name as PspName) ? name : 'paymob') as PspName;
  return cfg().pspMode === 'sandbox-fake' ? new FakePspAdapter(n) : new UnconfiguredPspAdapter(n);
}
