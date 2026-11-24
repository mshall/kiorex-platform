import type { AcquisitionBlock } from '@kiorex/contracts';

/**
 * Dependency-inversion ports for the modules that CALL growth (booking, webhooks). This file is a LEAF (type-only imports): importing the growth barrel from
 * the booking service creates a load-order cycle (patient -> engagement -> booking -> growth -> patient) that leaves a provider token undefined at decoration time.
 * The callers inject by token and see only these interfaces; `GrowthModule` binds the tokens to the real services.
 */
export interface BookingGrowthContext {
  /** `kxv` cookie value or `X-KX-Visitor` header, present only when the person consented (the attribution service re-checks withdrawal). */
  visitorKey?: string | null;
  /** The signed `lt` the booking request carried (same session). */
  lt?: string | null;
  /** web | ios | android | whatsapp | widget (a closed set, never a device id). */
  platform?: string | null;
}
export interface ConfirmGrowth { acquisition?: AcquisitionBlock; lt?: string }
export interface BookingGrowthPort {
  onIntent(b: { id: string; dependantId: string | null; careType: string; createdAt: Date }, market: string, ctx?: BookingGrowthContext): Promise<void>;
  decide(bookingId: string, ctx?: BookingGrowthContext): Promise<unknown>;
  forConfirm(bookingId: string, ctx?: BookingGrowthContext): Promise<ConfirmGrowth>;
  fact(name: 'BookingConfirmed' | 'BookingAttended' | 'BookingCancelled', b: { id: string; dependantId: string | null; careType: string }, market: string, props?: Record<string, string | number | boolean>, at?: Date): Promise<void>;
  onCompleted(bookingId: string): Promise<void>;
}
export interface GrowthRevenuePort { recordFromEvent(type: string, data: Record<string, any>, occurredAt?: string): Promise<boolean> }
export interface LinkRegistryPort {
  registerFromEvent(data: Record<string, unknown>): Promise<'REGISTERED' | 'KNOWN' | 'CONFLICT' | 'REVOKED' | 'IGNORED'>;
  /** `ReferralLinkRevoked`: the code stops deciding PROVIDER_LED for new bookings. */
  revokeFromEvent(data: Record<string, unknown>): Promise<'REGISTERED' | 'KNOWN' | 'CONFLICT' | 'REVOKED' | 'IGNORED'>;
}

/** Server-side canonical fact writer (GrowthEventsService.recordFact). `naturalKey` must never be a person identifier: use a keyed reference (subRefOf) or an internal random id. */
export interface GrowthFactsPort { recordFact(f: { name: string; naturalKey: string; bookingId?: string; careType?: string; props?: Record<string, unknown>; occurredAt?: Date; market?: string }): Promise<boolean> }

export const GROWTH_FACTS = 'GROWTH_FACTS_PORT';
export const BOOKING_GROWTH = 'GROWTH_BOOKING_PORT';
export const GROWTH_REVENUE = 'GROWTH_REVENUE_PORT';
export const LINK_REGISTRY = 'GROWTH_LINK_REGISTRY_PORT';

// ───────────── GRW-P2-B2 (wave 6): the pay and booking modules reach the patient reward ledger through these ports only ─────────────
type TxLike = unknown; // the Prisma transaction client of the caller (kept opaque so this file stays a type-only leaf)

export interface RewardReserveInput { sub: string; bookingId: string; amountMinor: number; currency: string; serviceKind: 'IN_CLINIC' | 'VIDEO' | 'HOME_VISIT'; specialty?: string | null; dependantId?: string | null; couponCode?: string | null; lotId?: string | null }
export interface RewardReserveResult { appliedMinor: number; lines: Array<{ code: string; amountMinor: number; labelKey: string }>; couponProblem?: 'COUPON_INVALID' | 'NOT_APPLICABLE'; lots: Array<{ lotId: string; minor: number }> }
export interface RewardRedeemResult { totalMinor: number; patientRefundMinor: number; promoMinor: number; postedMinor: number }
export interface RewardRestoreResult { restoredMinor: number; patientRefundRestoredMinor: number; promoRestoredMinor: number; postedRestoredMinor: number; lotIds: string[] }
/** The Kiorex Pay module's view of the patient reward ledger (optional dependency: with growth rewards switched off every method is a no-op and Pay behaves exactly as before). */
export interface RewardsPort {
  /** Reserves credit for one booking deposit (idempotent per booking) and returns how much of the deposit credit pays; 0 when nothing applies. Never throws for "nothing applies". */
  reserveForDeposit(i: RewardReserveInput): Promise<RewardReserveResult>;
  /** Releases the open reservation of a booking (payment failed, cancelled or abandoned). Idempotent. */
  releaseForBooking(bookingId: string, reason: string): Promise<number>;
  /** Converts the open reservation into REDEEM entries inside the capture transaction (key per payment). */
  redeemOnCapture(tx: TxLike, i: { bookingId: string; paymentId: string }): Promise<RewardRedeemResult>;
  /** A refund was created for a payment that carried credit: restore the credit share (new RESTORED lots) and record the destination choice. */
  onRefundCreated(tx: TxLike, i: { bookingId: string; sub: string; paymentId: string; refundId: string; cardRefundMinor: number; paymentCardMinor: number; paymentRewardMinor: number; paymentRewardPostedMinor: number; alreadyRefundedMinor: number; destination: 'ORIGINAL' | 'CREDIT'; source: 'PATIENT_CANCEL' | 'PATIENT_REFUND_REQUEST' | null; currency: string }): Promise<RewardRestoreResult>;
  /** The patient's own refunded money becomes a REFUND_CREDIT lot (called when a refund with choice CREDIT settles). Null when credit cannot be issued now (the caller then refunds to the original method). */
  issueRefundCredit(i: { sub: string; bookingId: string | null; refundId: string; amountMinor: number; currency: string }): Promise<{ lotId: string } | null>;
  /** True when the 'keep as credit' option may be offered right now (all three switches: flags patient_credit and refund_as_credit, and the rules block). */
  refundCreditAvailable(): Promise<boolean>;
  /** REWARD_RULES.postToPayLedger. */
  postToPayLedger(): Promise<boolean>;
}
export const REWARDS_PORT = 'GROWTH_REWARDS_PORT';

/** The booking module tells the referral engine about the facts it decides on (attended, cancelled). Never throws into a booking. */
export interface ReferralPort {
  onBookingCompleted(bookingId: string): Promise<void>;
  onBookingCancelled(bookingId: string): Promise<void>;
}
export const REFERRAL_PORT = 'GROWTH_REFERRAL_PORT';
