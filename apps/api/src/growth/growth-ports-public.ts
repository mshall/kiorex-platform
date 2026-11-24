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

export interface RewardReserveInput { sub: string; bookingId: string; /** What is still payable after any sponsored discount (the credit is planned on this). */ amountMinor: number; /** GRW-P2-S: the sponsored discount already taken off the price; only used to compose the shown lines (price = amountMinor + sponsoredMinor). */ sponsoredMinor?: number; currency: string; serviceKind: 'IN_CLINIC' | 'VIDEO' | 'HOME_VISIT'; specialty?: string | null; dependantId?: string | null; couponCode?: string | null; lotId?: string | null }
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

// ───────────── GRW-P4-B2 (wave 7): the pharmacy and lab modules reach the product decision through this port only ─────────────
export type ProductGrowthProduct = 'PHARMACY' | 'LAB' | 'NURSE';
export type ProductGrowthFactKind = 'ORDER' | 'LAB_BOOKING' | 'CARE_PLAN_BOOKING';
/** The optional `acquisition` block Kiorex adds to the partner order or booking call (contracts 1.12.0 `ProductAcquisitionBlock`; the origin is never CROSS_PRODUCT on the wire: it travels as MARKETPLACE). */
export interface ProductAcquisitionBlockOut { origin: 'PROVIDER_LED' | 'MARKETPLACE' | 'UNATTRIBUTED'; decisionId: string; policyVersion: string; reason: string; evidenceHash: string; linkCode?: string; product: ProductGrowthProduct }
export interface ProductGrowthPort {
  /** Decides one fact once (idempotent per fact and policy version). Never throws: a failure is logged, counted and repaired later; the order or booking is never blocked. */
  decide(f: { product: ProductGrowthProduct; factKind: ProductGrowthFactKind; factId: string; sub: string; orgRef: string | null; createdAt: Date; visitorKey?: string | null; continuityParentBookingId?: string | null; /** GRW-P4-A: the continuity entry point the patient used (their own prompt id, or the prescription record attached to the order); consent, flag and ownership are checked inside */ continuity?: ContinuityHint | null }): Promise<{ id: string; origin: string; created: boolean } | null>;
  /** The block to send with the partner call; null when growth is OFF, no decision exists or the fact is not a partner product. Decides lazily when the earlier attempt failed. */
  acquisitionBlock(f: { product: ProductGrowthProduct; factKind: ProductGrowthFactKind; factId: string; sub: string; orgRef: string | null; createdAt: Date }): Promise<ProductAcquisitionBlockOut | null>;
}
export const PRODUCT_GROWTH = 'GROWTH_PRODUCT_PORT';

// ───────────── GRW-P4-A (wave 8): cross-product journeys ─────────────
/** What a client passes with an order, booking or care-plan request that came from a continuity card (header `X-Kx-Continuity: <prompt id>`) or what the server derives (the prescription attached to an order). */
export interface ContinuityHint { entryId?: string | null; recordId?: string | null }
/** Header carrying the prompt id; read by the pharmacy, lab and home-care controllers and handed to the product decision. */
export const CONTINUITY_HEADER = 'x-kx-continuity';
/** Validated prompt id from a request header (a malformed value is treated as absent: an entry point is evidence only when it exists). */
export const continuityIdFrom = (v: string | string[] | undefined): string | null => { const s = Array.isArray(v) ? v[0] : v; return typeof s === 'string' && /^[A-Za-z0-9_-]{10,40}$/.test(s) ? s : null; };
/** The webhook route tells the package about Clinic events (type and ids only are read). Never throws. */
export interface CrossProductEventPort { onKiorlyEvent(env: { type: string; data?: Record<string, unknown> | null }): Promise<{ offered: number }> }
export const CROSS_PRODUCT_EVENTS = 'GROWTH_CROSS_PRODUCT_EVENTS';

// ───────────── GRW-P2-S (wave 7): the booking module reaches provider-sponsored discounts through this port only ─────────────
export interface SponsoredBlockOut { promotionId: string; promotionVersion: number; reservationRef: string; amountMinor: number; currency: string }
export interface SponsoredDiscountPort {
  /** Quotes, asks the Clinic to reserve budget and returns the optional `sponsoredDiscount` block of the booking call; null when nothing applies or the flag is OFF. Never throws: the booking goes on at the full price. */
  reserveForConfirm(b: { id: string; sub: string; tenantId: string | null; clinicId: string; clinicianId: string; typeId: string; startsAt: Date; feeMinor: number | null; currency: string; serviceLocation: string; telehealth: unknown; providerId: string }): Promise<SponsoredBlockOut | null>;
  /** The Clinic's answer to the booking call (`sponsoredDiscount.applied`). */
  onClinicAnswer(bookingId: string, answer: { applied?: boolean; reservationRef?: string } | undefined | null): Promise<void>;
  /** The booking call failed or the booking died before the Clinic confirmed it: give the budget back (best effort). */
  releaseForBooking(bookingId: string, reason?: string): Promise<void>;
}
export const SPONSORED_DISCOUNT_PORT = 'SPONSORED_DISCOUNT_PORT';

/**
 * GRW-P2-S (Kiorex Pay wiring): Pay reaches the sponsored discount of a booking through this port only (Pay never imports growth code). Flag `growth.sponsored_promotions` OFF: every method answers "none"
 * and Pay behaves exactly as before. Optional dependency of Pay.
 */
export interface SponsoredPayPort {
  /** The sponsored line a deposit checkout may apply: only a line the Clinic confirmed (state APPLIED, or DEBITED once the visit is done). Null when the flag is OFF or nothing applies. */
  lineForDeposit(bookingId: string): Promise<{ amountMinor: number; currency: string; reservationRef: string } | null>;
  /** Payout gate: how much of the sponsored amount posted into the Pay ledger may NOT be paid out yet (the Clinic has not written the DEBIT). Fails closed: a posted amount without a line is held. */
  payoutHoldMinor(bookingId: string, postedMinor: number): Promise<number>;
}
export const SPONSORED_PAY_PORT = 'SPONSORED_PAY_PORT';
