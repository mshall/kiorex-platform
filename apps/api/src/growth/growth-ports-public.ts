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
