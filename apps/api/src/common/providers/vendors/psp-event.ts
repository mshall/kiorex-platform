/**
 * The vendor-neutral PSP event every adapter produces from a VERIFIED webhook (or from a status poll). Amounts are integer minor units of the payment currency.
 * `eventId` must be unique per vendor event AND per state change (two partial refunds of one payment carry two ids), because Pay dedupes on it (WebhookReceipt).
 */
export type PspEventType =
  | 'payment.captured' | 'payment.failed' | 'refund.settled'
  | 'payment.authorized' | 'payment.voided' | 'refund.failed'
  | 'dispute.opened' | 'dispute.won' | 'dispute.lost';
export const PSP_EVENT_TYPES: readonly PspEventType[] = ['payment.captured', 'payment.failed', 'refund.settled', 'payment.authorized', 'payment.voided', 'refund.failed', 'dispute.opened', 'dispute.won', 'dispute.lost'];

export interface PspCardFacts {
  /** HMAC-hashed card fingerprint (never the raw vendor value, never a PAN). */
  fingerprint?: string;
  fingerprintStrength?: 'STRONG' | 'WEAK';
  brand?: string;
  last4?: string;
  threeDs?: 'NONE' | 'CHALLENGED' | 'PASSED' | 'FAILED';
}
export interface PspEvent {
  eventId: string;
  type: PspEventType;
  pspRef: string;
  /** Our payment id as the vendor echoes it. Only set when the vendor SIGNS it (Paymob does not sign merchant_order_id: there it is left out and `pspRef` / `orderRef` carry the signed order id). */
  paymentId?: string;
  /** The vendor's order reference, signed by the vendor: refund events use it to find the payment when `pspRef` is the refund transaction id. */
  orderRef?: string;
  amountMinor: number;
  feeMinor?: number;
  /** Currency the PSP reports; when present it must equal the intent's currency (CURRENCY_MISMATCH otherwise). */
  currency?: string;
  occurredAt: string;
  card?: PspCardFacts;
  /** refund.* events: the vendor's refund reference; dispute.* events: the dispute facts. */
  refundRef?: string;
  dispute?: { ref: string; reasonCode?: string; evidenceDueAt?: string };
}

export type PspPaymentState = 'PENDING' | 'AUTHORIZED' | 'CAPTURED' | 'FAILED' | 'VOIDED' | 'REFUNDED' | 'PARTIALLY_REFUNDED' | 'UNKNOWN';
/** Answer of a status poll: the PSP's own view of one payment. */
export interface PspStatus { state: PspPaymentState; amountMinor?: number; refundedMinor?: number; currency?: string; feeMinor?: number; pspRef?: string; occurredAt?: string; card?: PspCardFacts }
