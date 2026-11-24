import { DEFAULT_MARKET } from '../../market/market-core-public';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { subRefOf } from '../../common/privacy-hash';
import { PrismaService } from '../../prisma/prisma.service';
import { PROMOTION_RESERVATION_CLIENT, type PromotionReservationClient } from './promotion-reservation.client';
import { PromotionQuoteService, type QuoteIntent } from './promotion-quote.service';
import { PromotionFraudSignals } from './promotion-fraud.signals';
import { FlagsService } from '../../control-plane/control-plane-public';
import { GROWTH_FLAG } from '../growth-flags';
import { sponsoredPayoutHoldMinor } from './promotion-math';
import type { SponsoredPayPort } from '../growth-ports-public';

export interface SponsoredBlock { promotionId: string; promotionVersion: number; reservationRef: string; amountMinor: number; currency: string }
type Intent = QuoteIntent;

/**
 * The Kiorex end of a sponsored booking (GRW-P2-S): at confirm it quotes, asks the Clinic to reserve, and sends the optional `sponsoredDiscount` block with the booking call; it records what the Clinic
 * answers and mirrors the Clinic's budget events into `BookingSponsoredDiscount` (RESERVED -> APPLIED -> DEBITED | RELEASED -> REVERSED). One sponsored promotion per booking (unique on the booking).
 * The booking never fails because of a promotion: any refusal, outage or flag OFF means the booking goes ahead at the full price. Holds are never silently reduced after a reservation.
 */
@Injectable()
export class SponsoredDiscountService implements SponsoredPayPort {
  private readonly log = new Logger('sponsored-discount');
  constructor(private readonly prisma: PrismaService, private readonly quotes: PromotionQuoteService, private readonly fraud: PromotionFraudSignals, @Inject(PROMOTION_RESERVATION_CLIENT) private readonly clinic: PromotionReservationClient, private readonly flags: FlagsService) {}

  async reserveForConfirm(b: Intent): Promise<SponsoredBlock | null> {
    try {
      const existing = await this.prisma.bookingSponsoredDiscount.findUnique({ where: { bookingIntentId: b.id } });
      if (existing) return existing.state === 'RESERVED' || existing.state === 'APPLIED' ? { promotionId: existing.promotionId, promotionVersion: existing.promotionVersion, reservationRef: existing.reservationRef, amountMinor: existing.amountMinor, currency: existing.currency } : null;
      const q = await this.quotes.quoteFor(b); if (!q) return null;
      const careType = b.serviceLocation === 'HOME' ? 'HOME_VISIT' : b.telehealth ? 'VIDEO' : 'IN_CLINIC';
      const out = await this.clinic.reserve({ promotionId: q.promotionId, clinicId: b.clinicId, version: q.version, bookingRef: b.id, patientRef: subRefOf(b.sub), careType, amountMinor: q.amountMinor, currency: q.currency, idempotencyKey: `spr:${b.id}:${q.promotionId}:${q.version}` });
      if (!out.ok) { this.log.log(`reserve refused for ${b.id}: ${out.reason}`); return null; }
      await this.prisma.bookingSponsoredDiscount.create({ data: { bookingIntentId: b.id, promotionId: q.promotionId, promotionVersion: q.version, amountMinor: q.amountMinor, currency: q.currency, reservationRef: out.reservationRef } });
      await this.fraud.afterReserve(b.sub, b.tenantId ?? '', q.promotionId).catch(() => undefined);
      return { promotionId: q.promotionId, promotionVersion: q.version, reservationRef: out.reservationRef, amountMinor: q.amountMinor, currency: q.currency };
    } catch (e) { this.log.warn(`sponsored reserve failed for ${b.id}: ${(e as Error).message}`); return null; }
  }

  /** The Clinic's answer to the booking call: `sponsoredDiscount {applied}`. Applied -> APPLIED; not applied -> RELEASED (the Clinic already released the hold). */
  async onClinicAnswer(bookingId: string, answer: { applied?: boolean; reservationRef?: string } | undefined | null) {
    if (!answer) return;
    await this.prisma.bookingSponsoredDiscount.updateMany({ where: { bookingIntentId: bookingId, ...(answer.reservationRef ? { reservationRef: answer.reservationRef } : {}), state: 'RESERVED' }, data: { state: answer.applied ? 'APPLIED' : 'RELEASED' } });
  }

  /** The booking call failed or the booking died before the Clinic confirmed it: give the budget back. Best effort; the Clinic sweeper releases an unbooked hold anyway. */
  async releaseForBooking(bookingId: string, reason = 'BOOKING_NOT_CONFIRMED') {
    const l = await this.prisma.bookingSponsoredDiscount.findUnique({ where: { bookingIntentId: bookingId } });
    if (!l || l.state !== 'RESERVED') return;
    const b = await this.prisma.bookingIntent.findUnique({ where: { id: bookingId }, select: { clinicId: true } });
    if (b) await this.clinic.release({ promotionId: l.promotionId, clinicId: b.clinicId, reservationRef: l.reservationRef, idempotencyKey: `sprr:${bookingId}`, reason }).catch(() => false);
    await this.prisma.bookingSponsoredDiscount.updateMany({ where: { bookingIntentId: bookingId, state: 'RESERVED' }, data: { state: 'RELEASED' } });
  }

  /** The Clinic's budget events (signed webhook): the state of the booking line follows the Clinic ledger. Forward-only (the database enforces the allowed moves). */
  async applyClinicEvent(type: string, data: Record<string, any>): Promise<'APPLIED' | 'IGNORED'> {
    const ref = typeof data.reservationRef === 'string' ? data.reservationRef : '';
    if (!ref) return 'IGNORED';
    const to = type === 'SponsoredDiscountDebited' ? { state: 'DEBITED', from: ['RESERVED', 'APPLIED'] } : type === 'SponsoredDiscountReleased' ? { state: 'RELEASED', from: ['RESERVED', 'APPLIED'] } : type === 'SponsoredDiscountReversed' ? { state: 'REVERSED', from: ['DEBITED'] } : null;
    if (!to) return 'IGNORED'; // SponsoredDiscountReserved is the Clinic's own record of what Kiorex asked for: nothing to change here
    const r = await this.prisma.bookingSponsoredDiscount.updateMany({ where: { reservationRef: ref, state: { in: to.from } }, data: { state: to.state, ...(to.state === 'DEBITED' ? { debitRef: ref } : {}) } });
    if (to.state === 'REVERSED' && r.count) await this.prisma.bookingSponsoredDiscount.updateMany({ where: { reservationRef: ref }, data: { debitRef: ref } });
    return r.count ? 'APPLIED' : 'IGNORED';
  }

  /** What Kiorex Pay needs to know: the sponsored line of a booking and how much of its payout is still held (the predicate lives in promotion-math). */
  line(bookingId: string) { return this.prisma.bookingSponsoredDiscount.findUnique({ where: { bookingIntentId: bookingId } }); }

  // ───────────── Kiorex Pay (the SPONSORED_PAY_PORT) ─────────────

  async lineForDeposit(bookingId: string) {
    const l = await this.prisma.bookingSponsoredDiscount.findUnique({ where: { bookingIntentId: bookingId } });
    if (!l || !['APPLIED', 'DEBITED'].includes(l.state) || l.amountMinor <= 0) return null;
    const b = await this.prisma.bookingIntent.findUnique({ where: { id: bookingId }, select: { tenantId: true } });
    if (!(await this.flags.isEnabled(GROWTH_FLAG.SPONSORED_PROMOTIONS, { market: DEFAULT_MARKET, orgId: b?.tenantId ?? undefined }).catch(() => false))) return null;
    return { amountMinor: l.amountMinor, currency: l.currency, reservationRef: l.reservationRef };
  }

  async payoutHoldMinor(bookingId: string, postedMinor: number) {
    if (postedMinor <= 0) return 0;
    const l = await this.prisma.bookingSponsoredDiscount.findUnique({ where: { bookingIntentId: bookingId } });
    return Math.min(postedMinor, l ? sponsoredPayoutHoldMinor(l) : postedMinor);
  }
}
