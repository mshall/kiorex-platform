import { Inject, Injectable, Optional } from '@nestjs/common';
import { notFound } from '../common/errors';
import { REWARDS_PORT, type RewardsPort } from '../growth/growth-ports-public';
import { PrismaService } from '../prisma/prisma.service';
import { allocateRefund } from './refund-allocation';

export interface RefundOption { destination: 'ORIGINAL' | 'CREDIT'; amountMinor: number; isDefault: boolean }
export interface RefundPreview { options: RefundOption[]; creditRestoredMinor: number; sponsoredVoidedMinor: number; currency: string; refundableByPolicy: boolean | null }

/**
 * The refund preview of a booking the patient may cancel (GRW-P2-B2). "Refund to the original payment method" is ALWAYS the first option and ALWAYS the default; "Keep as credit" appears only while all
 * three switches say so (growth.patient_credit, growth.refund_as_credit and the rules block), is never the default and never pre-ticked. Amounts come from the pure `allocateRefund` over what was
 * actually paid: card, and credit that is restored (never refunded as cash). Anyone else's refund (provider, support, dispute, expired hold) has no preview: it goes to the original method at once.
 */
@Injectable()
export class RefundDestinationService {
  constructor(private readonly prisma: PrismaService, @Optional() @Inject(REWARDS_PORT) private readonly rewards?: RewardsPort) {}

  async preview(sub: string, bookingRef: string): Promise<RefundPreview> {
    const b = await this.prisma.bookingIntent.findFirst({ where: { id: bookingRef, sub } });
    if (!b) throw notFound('BOOKING_NOT_FOUND', 'Booking not found');
    const p = await this.prisma.paymentIntent.findFirst({ where: { bookingId: b.id, status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED'] } }, orderBy: { createdAt: 'desc' } });
    const none: RefundPreview = { options: [{ destination: 'ORIGINAL', amountMinor: 0, isDefault: true }], creditRestoredMinor: 0, sponsoredVoidedMinor: 0, currency: b.currency, refundableByPolicy: b.depositRefundable };
    if (!p || p.releasedAt || b.depositRefundable === false) return none;
    const remainingCard = p.amountMinor - p.refundedMinor;
    const price = p.amountMinor + p.rewardMinor;
    const a = allocateRefund({ priceMinor: price, sponsoredMinor: 0, creditMinor: p.rewardMinor, cardMinor: p.amountMinor, heldDepositMinor: 0, refundableMinor: price });
    const card = Math.min(a.cardRefundMinor, remainingCard);
    const options: RefundOption[] = [{ destination: 'ORIGINAL', amountMinor: card, isDefault: true }];
    if (card > 0 && this.rewards && (await this.rewards.refundCreditAvailable())) options.push({ destination: 'CREDIT', amountMinor: card, isDefault: false });
    return { options, creditRestoredMinor: a.creditRestoredMinor, sponsoredVoidedMinor: a.sponsoredVoidedMinor, currency: p.currency, refundableByPolicy: b.depositRefundable };
  }
}
