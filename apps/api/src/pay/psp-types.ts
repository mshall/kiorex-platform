import type { PspEvent, PspStatus } from '../common/providers/vendors/psp-event';
import type { PspName } from './psp-config';

/** The vendor-neutral event every adapter produces (see common/providers/vendors/psp-event.ts). */
export type PspWebhookEvent = PspEvent;
export type { PspStatus };

export interface PspCheckoutInput { paymentId: string; amountMinor: number; currency: string; captureMode?: 'AUTO' | 'MANUAL'; threeDsMode?: 'REQUIRED' | 'PREFERRED' | 'OFF'; /** Fractional digits of the currency minor unit (EGP 2). */ decimals?: number }
export interface PspCapabilities { capture: boolean; void: boolean; status: boolean; partialRefund: boolean; /** The PSP shows a hosted page where the card is typed (cards never touch Kiorex). */ hostedCheckout: boolean; /** The PSP reports card facts (brand, last4, 3DS, fingerprint). */ cardFacts: boolean }
export const NO_CAPS: PspCapabilities = { capture: false, void: false, status: false, partialRefund: false, hostedCheckout: true, cardFacts: false };

export interface PspAdapter {
  name: PspName;
  capabilities?: PspCapabilities;
  createCheckout(i: PspCheckoutInput): Promise<{ pspRef: string; checkoutUrl: string }>;
  /** `query` carries vendor signatures that travel in the URL (Paymob `hmac`). */
  verifyWebhook(rawBody: string, headers: Record<string, unknown>, query?: Record<string, unknown>): PspWebhookEvent | null;
  /** `priorRefundedMinor`: what the PSP has already refunded for this payment before this refund (lets a retry detect that the refund already happened instead of refunding twice). */
  refund(i: { pspRef: string; refundId: string; amountMinor: number; priorRefundedMinor?: number }): Promise<{ pspRefundRef: string }>;
  /** Manual capture mode: capture an authorised payment (full amount or less). */
  capture?(i: { pspRef: string; paymentId: string; amountMinor: number }): Promise<{ pspCaptureRef: string }>;
  /** Cancel an authorised, uncaptured payment. */
  void?(i: { pspRef: string; paymentId: string }): Promise<{ pspVoidRef: string }>;
  /** Polling fallback: the PSP's own view of the payment. */
  status?(i: { pspRef: string; paymentId: string }): Promise<PspStatus>;
}

