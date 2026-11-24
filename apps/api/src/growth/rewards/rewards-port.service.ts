import { Injectable } from '@nestjs/common';
import type { RewardRedeemResult, RewardReserveInput, RewardReserveResult, RewardRestoreResult, RewardsPort } from '../growth-ports-public';
import { Tx } from '../../prisma/prisma.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RewardEventsService } from './reward-events.service';
import { RewardIssuanceService, issueKey } from './reward-issuance.service';
import { RewardPolicyService } from './reward-policy.service';
import { RewardRedemptionService } from './reward-redemption.service';
import { RewardReversalService } from './reward-reversal.service';

/** What the Kiorex Pay module sees of the reward ledger (the `REWARDS_PORT` token). Pay never imports growth code; with the rewards switch OFF every call is a no-op or an empty answer. */
@Injectable()
export class RewardsPortService implements RewardsPort {
  constructor(private readonly prisma: PrismaService, private readonly redemption: RewardRedemptionService, private readonly issuance: RewardIssuanceService, private readonly policy: RewardPolicyService, private readonly events: RewardEventsService, private readonly reversal: RewardReversalService) {}

  reserveForDeposit(i: RewardReserveInput): Promise<RewardReserveResult> { return this.redemption.reserveForDeposit(i); }
  releaseForBooking(bookingId: string, reason: string) { return this.redemption.releaseForBooking(bookingId, reason); }
  redeemOnCapture(tx: unknown, i: { bookingId: string; paymentId: string }): Promise<RewardRedeemResult> { return this.redemption.redeemOnCapture(tx as Tx, i); }
  async onRefundCreated(tx: unknown, i: Parameters<RewardsPort['onRefundCreated']>[1]): Promise<RewardRestoreResult> {
    const t = tx as Tx;
    const none: RewardRestoreResult = { restoredMinor: 0, patientRefundRestoredMinor: 0, promoRestoredMinor: 0, postedRestoredMinor: 0, lotIds: [] };
    const optionOffered = i.source !== null && (i.destination === 'CREDIT' || (await this.policy.refundCreditAvailable()));
    if (!optionOffered && i.paymentRewardMinor === 0 && !(await this.policy.rewardsOn())) return none; // everything off and nothing paid with credit: a refund is exactly what it was before this module
    if (optionOffered && i.source) { // a patient-initiated refund where the option was OFFERED records the destination choice (immutable); other refunds always go to the original method and need no row
      const row = await t.refundDestinationChoice.create({ data: { refundId: i.refundId, bookingId: i.bookingId, sub: i.sub, choice: i.destination, source: i.source } });
      await this.events.emit(t, 'RefundDestinationChosen', 'RefundDestinationChoice', row.id, { choiceRef: row.id, market: row.market, refundRef: i.refundId, choice: i.destination, amountMinor: Math.max(1, i.cardRefundMinor), currency: i.currency, source: i.source, chosenAt: row.chosenAt.toISOString() }, row.id);
    }
    const restored = await this.redemption.restoreForRefund(t, i);
    // a refund of the booking that EARNED a reward takes the unspent reward back (inside the reversal window); a booking that earned nothing is a no-op
    await this.reversal.reverseForBooking(i.bookingId, 'REFUND').catch(() => undefined);
    return restored;
  }
  async issueRefundCredit(i: { sub: string; bookingId: string | null; refundId: string; amountMinor: number; currency: string }) {
    if (!(await this.policy.refundCreditAvailable())) return null;
    const r = await this.issuance.issue({ kind: 'REFUND_CREDIT', sub: i.sub, amountMinor: i.amountMinor, funding: 'PATIENT_REFUND', idempotencyKey: issueKey('refund-credit', i.refundId), reasonCode: 'REFUND_CHOICE', actor: 'system:pay', refundId: i.refundId, bookingId: i.bookingId, mode: 'CREDIT', currency: i.currency });
    return r.status === 'SKIPPED' ? null : { lotId: r.lotId };
  }
  refundCreditAvailable() { return this.policy.refundCreditAvailable(); }
  async postToPayLedger() { return (await this.policy.rewardRules()).rules.postToPayLedger; }
}
