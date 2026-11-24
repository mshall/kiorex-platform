import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AttributionService, type StoredDecision } from '../attribution/attribution.service';
import { GrowthRevenueService } from '../analytics/revenue.service';
import { GROWTH_FAILURE, recordGrowthFailure } from '../growth-failures';
import { GrowthEventsService } from '../events/growth-events.service';
import { REFERRAL_PORT, type BookingGrowthContext, type BookingGrowthPort, type ConfirmGrowth, type ReferralPort } from '../growth-ports-public';

const PLATFORMS = new Set(['web', 'ios', 'android', 'whatsapp', 'widget']);
export const platformOf = (v: unknown): string | undefined => (typeof v === 'string' && PLATFORMS.has(v.toLowerCase()) ? v.toLowerCase() : undefined);

/**
 * Booking integration of the growth engine (GRW-P1-C). The booking service calls this and nothing in here can fail a booking:
 *  - `onIntent`: server facts SlotSelected and BookingInitiated (idempotent per booking; dependants never enter growth tables, KX-32 section 10);
 *  - `decide`: the attribution decision, written once per (booking, policy version) and persisted BEFORE the Clinic call, so a confirm retry reuses it;
 *  - `forConfirm`: the signed `acquisition` block plus the verified `lt` for POST /marketplace/v1/bookings. Flag `growth.attribution` OFF = `{}` (the request is byte-identical to before the engine);
 *  - `fact`: BookingConfirmed, BookingAttended and BookingCancelled mapped from the state machine, same fact twice = one row.
 * Failures are logged and swallowed: a booking must never depend on analytics.
 */
@Injectable()
export class BookingGrowthService implements BookingGrowthPort {
  private readonly log = new Logger('booking-growth');
  constructor(private readonly attribution: AttributionService, private readonly events: GrowthEventsService, private readonly prisma: PrismaService, private readonly revenue: GrowthRevenueService, @Optional() @Inject(REFERRAL_PORT) private readonly referral?: ReferralPort) {}

  async onIntent(b: { id: string; dependantId: string | null; careType: string; createdAt: Date }, market: string, ctx: BookingGrowthContext = {}) {
    if (b.dependantId) return;
    const props = ctx.platform ? { platform: platformOf(ctx.platform) ?? 'web' } : {};
    await this.safe('SlotSelected', () => this.events.recordFact({ name: 'SlotSelected', naturalKey: b.id, bookingId: b.id, careType: b.careType, market, props, occurredAt: b.createdAt }));
    await this.safe('BookingInitiated', () => this.events.recordFact({ name: 'BookingInitiated', naturalKey: b.id, bookingId: b.id, careType: b.careType, market, props, occurredAt: b.createdAt }));
  }

  async decide(bookingId: string, ctx: BookingGrowthContext = {}): Promise<StoredDecision | null> {
    try { return await this.attribution.decideForBooking({ bookingId, visitorKey: ctx.visitorKey ?? null, ltToken: ctx.lt ?? null }); }
    catch (e) {
      // loud, not silent: an ERROR line with a stable key and a counter (a flag-check failure was already counted at its source); the booking still continues, UNATTRIBUTED, because analytics never blocks a booking
      recordGrowthFailure(GROWTH_FAILURE.ATTRIBUTION_DECISION);
      this.log.error(`${GROWTH_FAILURE.ATTRIBUTION_DECISION} booking=${bookingId} (booking continues UNATTRIBUTED): ${(e as Error).message}`, (e as Error).stack);
      return null;
    }
  }

  async forConfirm(bookingId: string, ctx: BookingGrowthContext = {}): Promise<ConfirmGrowth> {
    const d = await this.decide(bookingId, ctx);
    if (!d) return {};
    try {
      const acquisition = await this.attribution.acquisitionBlock(bookingId);
      if (!acquisition) return {};
      const latest = await this.attribution.latest(bookingId);
      const snap = latest?.bookingSnapshot as { booking?: { ltValidForOrg?: boolean } } | null;
      // the token travels only when Kiorex verified it for this organisation; a forged or expired one never leaves Kiorex
      const lt = ctx.lt && snap?.booking?.ltValidForOrg === true && acquisition.origin === 'PROVIDER_LED' ? ctx.lt : undefined;
      return { acquisition, ...(lt ? { lt } : {}) };
    } catch (e) { this.log.warn(`acquisition block for ${bookingId} failed (sent without it): ${(e as Error).message}`); return {}; }
  }

  /** `name` is a server canonical event. `reason`, `bucket` and `step` are the closed props the guard allows. */
  async fact(name: 'BookingConfirmed' | 'BookingAttended' | 'BookingCancelled', b: { id: string; dependantId: string | null; careType: string }, market: string, props: Record<string, string | number | boolean> = {}, at?: Date) {
    if (b.dependantId) return;
    await this.safe(name, () => this.events.recordFact({ name, naturalKey: b.id, bookingId: b.id, careType: b.careType, market, props, ...(at ? { occurredAt: at } : {}) }));
    // GRW-P2-B1: the referral engine reads cancellations (it never changes the attribution decision, a commission or a booking, and its failures never reach the booking)
    if (name === 'BookingCancelled') await this.safe('referral:cancelled', () => this.referral?.onBookingCancelled(b.id) ?? Promise.resolve());
  }

  /** COMPLETED: the Clinic confirms the visit's PENDING commission charge at the same moment (no event of its own), so the revenue fact becomes CONFIRMED. */
  async onCompleted(bookingId: string) {
    await this.revenue.onBookingCompleted(bookingId);
    await this.safe('referral:completed', () => this.referral?.onBookingCompleted(bookingId) ?? Promise.resolve()); // GRW-P2-B1: first completed visit of a referred person
  }

  private async safe(what: string, fn: () => Promise<unknown>) { try { await fn(); } catch (e) { this.log.warn(`growth fact ${what} not recorded: ${(e as Error).message}`); } }
}
