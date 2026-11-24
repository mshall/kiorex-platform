import { Injectable } from '@nestjs/common';
import { notFound } from '../../common/errors';
import { FlagsService } from '../../control-plane/control-plane-public';
import { PrismaService } from '../../prisma/prisma.service';
import { GROWTH_FLAG } from '../growth-flags';
import { composeCheckout } from '../rewards/checkout-lines';
import { bestOffer, type CareType, type PromoFacts, type QuoteFacts, sponsoredLabel } from './promotion-math';

export interface SponsoredQuote {
  promotionId: string; version: number; amountMinor: number; currency: string; endsAt: string;
  label: { ar: string; en: string }; patientCopy: { ar: string; en: string }; sponsor: { ar: string; en: string };
  /** The ordered checkout lines of the visit fee with the sponsored line (a preview: the card line is what is left). */
  lines: Array<{ code: string; amountMinor: number; labelKey: string }>;
}
export interface QuoteIntent { id: string; sub: string; tenantId: string | null; clinicId: string; clinicianId: string; typeId: string; startsAt: Date; feeMinor: number | null; currency: string; serviceLocation: string; telehealth: unknown; providerId: string }
const LIVE_STATUSES = ['PENDING_CLINIC', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED'];

/** Finds the single best eligible ACTIVE sponsored promotion for a booking and builds the line the patient sees ("Discount sponsored by <clinic>", the end date): never presented as a Kiorex discount. Read only. */
@Injectable()
export class PromotionQuoteService {
  constructor(private readonly prisma: PrismaService, private readonly flags: FlagsService) {}

  async quote(sub: string, bookingId: string, now = new Date()): Promise<SponsoredQuote | null> {
    const b = await this.prisma.bookingIntent.findFirst({ where: { id: bookingId, sub } });
    if (!b) throw notFound('BOOKING_NOT_FOUND', 'Booking not found');
    return this.quoteFor(b, now);
  }

  /** Quote for an intent row (the booking service calls this at confirm). Null when the flag is OFF, the booking has no organisation or no visit fee, or nothing is eligible. */
  async quoteFor(b: QuoteIntent, now = new Date()): Promise<SponsoredQuote | null> {
    if (!b.tenantId || !b.feeMinor || b.feeMinor <= 0) return null;
    if (!(await this.flags.isEnabled(GROWTH_FLAG.SPONSORED_PROMOTIONS, { market: 'EG', orgId: b.tenantId }).catch(() => false))) return null;
    const rows = await this.prisma.sponsoredPromotionProjection.findMany({ where: { orgRef: b.tenantId, status: 'ACTIVE', endsAt: { gt: now } }, take: 100 });
    if (!rows.length) return null;
    const careType: CareType = b.serviceLocation === 'HOME' ? 'HOME_VISIT' : b.telehealth ? 'VIDEO' : 'IN_CLINIC';
    const [sameClinic, kiorexBefore] = await Promise.all([
      this.prisma.bookingIntent.count({ where: { sub: b.sub, tenantId: b.tenantId, id: { not: b.id }, status: { in: LIVE_STATUSES } } }),
      this.prisma.bookingIntent.count({ where: { sub: b.sub, id: { not: b.id }, status: { in: LIVE_STATUSES } } }),
    ]);
    const facts: QuoteFacts = { doctorId: b.clinicianId, appointmentTypeId: b.typeId, careType, startsAt: b.startsAt, visitFeeMinor: b.feeMinor, isNewToClinic: sameClinic === 0, kiorexBookingsBefore: kiorexBefore, channelIsKiorex: true };
    const cands = rows.map((r) => ({ id: r.id, row: r, promo: { status: r.status, startsAt: r.startsAt, endsAt: r.endsAt, budgetCapMinor: Number(r.budgetCapMinor), scope: r.scope as PromoFacts['scope'], discount: r.discount as PromoFacts['discount'], eligibility: r.eligibility as PromoFacts['eligibility'] } as PromoFacts }));
    const best = bestOffer(cands, facts, now);
    if (!best) return null;
    const prov = await this.prisma.provider.findUnique({ where: { id: b.providerId }, select: { clinicNameAr: true, clinicNameEn: true } });
    const sponsor = { ar: prov?.clinicNameAr || prov?.clinicNameEn || 'العيادة', en: prov?.clinicNameEn || prov?.clinicNameAr || 'the clinic' };
    const r = best.cand.row; const l = sponsoredLabel(sponsor, r.endsAt!, { ar: r.patientCopyAr, en: r.patientCopyEn });
    const checkout = composeCheckout({ priceMinor: b.feeMinor, sponsoredMinor: best.amountMinor });
    return { promotionId: r.promotionId, version: r.version, amountMinor: best.amountMinor, currency: b.currency, endsAt: r.endsAt!.toISOString(), label: { ar: l.ar, en: l.en }, patientCopy: l.copy, sponsor, lines: checkout.lines };
  }
}
