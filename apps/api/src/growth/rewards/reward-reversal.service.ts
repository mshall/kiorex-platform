import { Injectable } from '@nestjs/common';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { RewardEventsService } from './reward-events.service';
import { RewardLedgerService } from './reward-ledger.service';
import { entryKey, reversalSplit } from './reward-math';
import { RewardPolicyService } from './reward-policy.service';

export interface ReverseOutcome { lotId: string; reversedMinor: number; recoverableLossMinor: number; skipped?: 'NEVER_REVERSED_KIND' | 'NOTHING_AVAILABLE' | 'LOT_NOT_FOUND' }

/**
 * Reversal of reward value (GRW-P2-B2). A reward issued on a booking that is later refunded or cancelled inside the reversal window, or found fraudulent, loses its UNSPENT part (REVERSE);
 * what was already spent is recorded as a recoverable loss on the subject (blocks new issuance for 90 days, shows in the finance report). Three rules are deliberate:
 *  - a `REFUND_CREDIT` or `RESTORED` lot is the patient's own money and is NEVER reversed by a referral, fraud or booking rule (a chargeback puts a HOLD and goes to ops);
 *  - value reserved for a payment in flight is never pulled away: it is redeemed or released by that payment, then the next run reverses what returned (so a deposit is never short);
 *  - every step is keyed by lot, booking and amount: a retry is a no-op.
 */
@Injectable()
export class RewardReversalService {
  constructor(private readonly prisma: PrismaService, private readonly ledger: RewardLedgerService, private readonly policy: RewardPolicyService, private readonly events: RewardEventsService) {}

  async reverseLot(lotId: string, reasonCode: string, actor: string, o: { bookingId?: string | null; now?: Date } = {}, outer?: Tx): Promise<ReverseOutcome> {
    const run = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => (outer ? fn(outer) : this.prisma.$transaction(fn, { timeout: 20_000 }));
    return run(async (tx) => {
      const lot = await tx.rewardLot.findUnique({ where: { id: lotId } });
      if (!lot) return { lotId, reversedMinor: 0, recoverableLossMinor: 0, skipped: 'LOT_NOT_FOUND' as const };
      if (lot.kind === 'REFUND_CREDIT' || lot.kind === 'RESTORED' || lot.funding === 'PATIENT_REFUND') return { lotId, reversedMinor: 0, recoverableLossMinor: 0, skipped: 'NEVER_REVERSED_KIND' as const };
      await this.ledger.lock(tx, [lotId]);
      const { versionId } = await this.policy.rewardRules();
      let t = await this.ledger.totals(tx, lotId);
      if (t.held > 0) {
        await this.ledger.append(tx, { lotId, type: 'RELEASE_HOLD', amountMinor: t.held, idempotencyKey: entryKey('release-hold', lotId, 'for-reverse', t.held, t.issued), ruleVersionId: versionId, reasonCode: 'FRAUD_CLEARED', actor });
        t = await this.ledger.totals(tx, lotId);
      }
      const split = reversalSplit({ issuedMinor: t.issued, redeemedMinor: t.redeemed });
      let reversed = 0;
      if (t.available > 0) {
        await this.ledger.append(tx, { lotId, type: 'REVERSE', amountMinor: t.available, idempotencyKey: entryKey('reverse', lotId, o.bookingId ?? 'manual', t.available), ruleVersionId: versionId, reasonCode, actor, bookingId: o.bookingId ?? null });
        reversed = t.available;
        await this.events.emit(tx, 'RewardReversed', 'RewardLot', lotId, { lotRef: lotId, market: lot.market, mode: lot.mode, amountMinor: reversed, currency: lot.currency, reasonCode, idempotencyKey: entryKey('reverse', lotId, o.bookingId ?? 'manual', t.available), at: (o.now ?? new Date()).toISOString() }, `${lotId}:${o.bookingId ?? 'manual'}:${reversed}`);
      }
      let loss = 0;
      if (split.recoverableLossMinor > 0) {
        loss = split.recoverableLossMinor;
        await tx.rewardRecoverableLoss.upsert({ where: { lotId_bookingId: { lotId, bookingId: o.bookingId ?? 'MANUAL' } }, create: { sub: lot.ownerSub ?? lot.sub, lotId, amountMinor: loss, reasonCode, bookingId: o.bookingId ?? 'MANUAL' }, update: {} });
      }
      await this.ledger.refreshStatus(tx, lotId);
      return reversed || loss ? { lotId, reversedMinor: reversed, recoverableLossMinor: loss } : { lotId, reversedMinor: 0, recoverableLossMinor: 0, skipped: 'NOTHING_AVAILABLE' as const };
    });
  }

  /** The qualifying booking was refunded, cancelled or disputed after the reward was issued: reverse every promotional lot it issued, inside `reversalWindowDays` of the issue. */
  async reverseForBooking(bookingId: string, reasonCode = 'REFUND', now = new Date()): Promise<ReverseOutcome[]> {
    const { rules } = await this.policy.rewardRules();
    const lots = await this.prisma.rewardLot.findMany({ where: { qualifyingBookingId: bookingId, kind: { notIn: ['REFUND_CREDIT', 'RESTORED'] }, funding: { not: 'PATIENT_REFUND' } } });
    const out: ReverseOutcome[] = [];
    for (const lot of lots) {
      if (now.getTime() > lot.createdAt.getTime() + rules.reversalWindowDays * 86_400_000) continue;
      out.push(await this.reverseLot(lot.id, reasonCode, 'system:reversal', { bookingId, now }));
      if (lot.relationshipId) await this.prisma.referralQualificationCheck.create({ data: { relationshipId: lot.relationshipId, checkKey: 'REVERSED_AFTER_REFUND', passed: false, detail: { reasonCode } } }).catch(() => undefined);
    }
    return out;
  }
}
