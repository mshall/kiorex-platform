import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { PaymentDisputeIn, PaymentDisputeOut, PaymentSignalsPort } from '../growth-ports-public';
import { ReferralIdentityService } from '../referral/referral-identity.service';
import { RewardHoldService } from '../rewards/reward-hold.service';

const HOLD_ACTOR = 'system:pay-dispute';
const REASON_OPEN = 'PAYMENT_DISPUTE';
const REASON_RELEASE = 'PAYMENT_DISPUTE_WON';

/**
 * What the PSP tells Kiorex Pay about a payment becomes growth signals here (PAY-READY). Two things, both optional and never blocking a payment:
 *  1. the HMAC-hashed card fingerprint -> ReferralIdentitySignal(PAY_FINGERPRINT): the evidence behind RF_SELF / RF_FARM that had no feed ("no payment fingerprint");
 *  2. a dispute (chargeback): OPEN holds every reward lot that this booking or this payment's refunds produced (lots are HELD, never reversed, never deleted) and parks the referral
 *     decision of the booking (reviewState HOLD); WON releases exactly what OPEN held; LOST leaves the holds for ops (a lost chargeback is never auto-forgiven) and the lot of a
 *     REFUND_CREDIT stays frozen (the patient got the money back from the bank, ops decides). The sponsored line is reported so ops can see which promotion line is under dispute;
 *     its payout is held by Pay itself (a disputed deposit is never paid out).
 * Everything is keyed on ids and hashes; no PHI, no patient identifier leaves Kiorex.
 */
@Injectable()
export class PaymentSignalsService implements PaymentSignalsPort {
  private readonly log = new Logger('payment-signals');
  constructor(private readonly prisma: PrismaService, private readonly identity: ReferralIdentityService, private readonly holds: RewardHoldService) {}

  async recordCardFingerprint(sub: string, fingerprintHash: string): Promise<void> {
    try { await this.identity.record(sub, 'PAY_FINGERPRINT', fingerprintHash); } catch (e) { this.log.warn(`fingerprint not recorded: ${(e as Error).message}`); }
  }

  /** Lots this booking or this payment's refunds produced (qualifying visit, an ISSUE entry for the booking, or a refund credit issued for one of its refunds). */
  private async affectedLots(paymentId: string, bookingId: string | null): Promise<string[]> {
    const refunds = await this.prisma.refund.findMany({ where: { paymentId }, select: { id: true } });
    const or: Array<Record<string, unknown>> = [];
    if (bookingId) or.push({ qualifyingBookingId: bookingId }, { entries: { some: { type: 'ISSUE', bookingId } } });
    if (refunds.length) or.push({ entries: { some: { type: 'ISSUE', refundId: { in: refunds.map((r) => r.id) } } } });
    if (!or.length) return [];
    const lots = await this.prisma.rewardLot.findMany({ where: { OR: or as never }, select: { id: true } });
    return lots.map((l) => l.id);
  }

  async onPaymentDispute(i: PaymentDisputeIn): Promise<PaymentDisputeOut> {
    const out: PaymentDisputeOut = { heldLots: 0, releasedLots: 0, referralHeld: 0, referralReleased: 0, sponsoredLine: null };
    try {
      if (i.bookingId) {
        const line = await this.prisma.bookingSponsoredDiscount.findUnique({ where: { bookingIntentId: i.bookingId }, select: { reservationRef: true } });
        out.sponsoredLine = line?.reservationRef ?? null;
      }
      const lots = await this.affectedLots(i.paymentId, i.bookingId);
      if (i.state === 'OPEN') {
        for (const id of lots) { const r = await this.holds.hold(id, REASON_OPEN, HOLD_ACTOR); if (r.heldMinor > 0) out.heldLots++; }
        if (i.bookingId) {
          const r = await this.prisma.referralRelationship.updateMany({ where: { OR: [{ firstBookingId: i.bookingId }, { qualifiedBookingId: i.bookingId }], status: { notIn: ['REJECTED', 'EXPIRED'] }, reviewState: 'NONE' }, data: { reviewState: 'HOLD' } });
          out.referralHeld = r.count;
        }
      } else if (i.state === 'WON') {
        for (const id of lots) { const r = await this.holds.release(id, HOLD_ACTOR, REASON_RELEASE); if (r.releasedMinor > 0) out.releasedLots++; }
        if (i.bookingId && (i.priorHolds?.referralHeld ?? 0) > 0) { // only what OPEN parked is released: a hold the fraud engine placed stays for its own review
          const r = await this.prisma.referralRelationship.updateMany({ where: { OR: [{ firstBookingId: i.bookingId }, { qualifiedBookingId: i.bookingId }], reviewState: 'HOLD' }, data: { reviewState: 'NONE' } });
          out.referralReleased = r.count;
        }
      }
      await this.prisma.auditLog.create({ data: { actor: HOLD_ACTOR, action: `growth.payment_dispute.${i.state.toLowerCase()}`, resource: 'PaymentIntent', resourceId: i.paymentId, metadata: { psp: i.psp, disputeRef: i.disputeRef, ...out } as never } });
    } catch (e) { this.log.warn(`dispute signal for ${i.paymentId} failed: ${(e as Error).message}`); }
    return out;
  }
}
