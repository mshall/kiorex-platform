import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '../../prisma/generated/client';
import { cfg } from '../../common/config';
import { OutboxService } from '../../outbox/outbox-public';
import { PrismaService } from '../../prisma/prisma.service';
import { RewardEventsService } from './reward-events.service';
import { RewardHoldService } from './reward-hold.service';
import { RewardLedgerService, expireKey } from './reward-ledger.service';
import { RewardPolicyService } from './reward-policy.service';
import { RewardRedemptionService } from './reward-redemption.service';

export interface ExpiryRunResult { expiredLots: number; expiredMinor: number; refundCreditRefunds: number; releasedReservations: number; releasedHolds: number; endedMembers: number }

/**
 * The reward housekeeping job (hourly, idempotent, also callable on demand): expires every lot past its expiry (first-in-first-expiring consumption means the oldest value goes first), converts
 * the unspent rest of an expired REFUND_CREDIT lot into a refund to the ORIGINAL payment method (the patient's own money, rules `refundCreditOnExpiry`; a system reversal, never a patient-triggered
 * cash-out), releases reservations of bookings that died or whose payment failed, releases holds past `holdMaxDays`, and ends household membership of dependants who left the guardian link.
 * Value reserved for a payment in flight is never expired under it: it expires in the run after the payment resolves.
 */
@Injectable()
export class RewardExpiryJob implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('reward-expiry');
  private timer?: NodeJS.Timeout;
  constructor(private readonly prisma: PrismaService, private readonly ledger: RewardLedgerService, private readonly policy: RewardPolicyService, private readonly events: RewardEventsService, private readonly outbox: OutboxService, private readonly redemption: RewardRedemptionService, private readonly holds: RewardHoldService) {}

  onModuleInit() {
    if (!cfg().jobsEnabled) return;
    this.timer = setInterval(() => void this.runOnce().catch((e) => this.log.warn(`reward housekeeping failed: ${(e as Error).message}`)), 3600_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async runOnce(now = new Date()): Promise<ExpiryRunResult> {
    const { rules, versionId } = await this.policy.rewardRules();
    const out: ExpiryRunResult = { expiredLots: 0, expiredMinor: 0, refundCreditRefunds: 0, releasedReservations: 0, releasedHolds: 0, endedMembers: 0 };

    const due = await this.prisma.rewardLot.findMany({ where: { expiresAt: { lte: now }, status: { in: ['ACTIVE', 'HELD'] } }, orderBy: { expiresAt: 'asc' }, take: 500, select: { id: true } });
    for (const { id } of due) {
      await this.prisma.$transaction(async (tx) => {
        await this.ledger.lock(tx, [id]);
        let t = await this.ledger.totals(tx, id);
        const last = await tx.rewardLedgerEntry.findFirst({ where: { lotId: id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true } });
        if (t.held > 0) { await this.ledger.append(tx, { lotId: id, type: 'RELEASE_HOLD', amountMinor: t.held, idempotencyKey: expireKey(id, `${last?.id}:rh`, t.held), ruleVersionId: versionId, reasonCode: 'EXPIRED', actor: 'system:expiry' }); t = await this.ledger.totals(tx, id); }
        if (t.available > 0) {
          const lot = await tx.rewardLot.findUniqueOrThrow({ where: { id } });
          await this.ledger.append(tx, { lotId: id, type: 'EXPIRE', amountMinor: t.available, idempotencyKey: expireKey(id, last?.id ?? '-', t.available), ruleVersionId: versionId, reasonCode: 'EXPIRED', actor: 'system:expiry' });
          await this.events.emit(tx, 'RewardExpired', 'RewardLot', id, { lotRef: id, market: lot.market, mode: lot.mode, amountMinor: t.available, currency: lot.currency, reasonCode: 'EXPIRED', idempotencyKey: expireKey(id, last?.id ?? '-', t.available), at: now.toISOString() }, `${id}:${t.available}:${last?.id ?? '-'}`);
          out.expiredLots++; out.expiredMinor += t.available;
          if (lot.kind === 'REFUND_CREDIT' && rules.credit.refundAsCredit.refundCreditOnExpiry === 'REFUND_TO_ORIGINAL') {
            // the unspent rest of the patient's OWN refunded money goes back to the original payment method (Pay handles the refund; one event per lot and amount)
            await this.outbox.enqueue(tx, { type: 'pay.refund_credit_expired', aggregateType: 'RewardLot', aggregateId: id, payload: { lotId: id, amountMinor: t.available }, dedupeKey: `pay.refund_credit_expired:${id}:${t.available}:${last?.id ?? '-'}` });
            out.refundCreditRefunds++;
          }
        }
        await this.ledger.refreshStatus(tx, id);
      });
    }

    out.releasedReservations = await this.releaseStaleReservations(now);
    out.releasedHolds = await this.holds.autoRelease(now);
    out.endedMembers = await this.endLeftMembers(now);
    return out;
  }

  /** Reservations whose booking is over (cancelled, expired, no-show, completed without a captured payment) or whose payment failed, older than 15 minutes. */
  async releaseStaleReservations(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - 15 * 60_000);
    const rows = await this.prisma.$queryRaw<{ bookingId: string }[]>(Prisma.sql`
      SELECT DISTINCT e."bookingId" FROM "RewardLedgerEntry" e WHERE e."type" = 'RESERVE' AND e."bookingId" IS NOT NULL AND e."createdAt" < ${cutoff}
        AND NOT EXISTS (SELECT 1 FROM "PaymentIntent" p WHERE p."bookingId" = e."bookingId" AND p."status" IN ('CAPTURED','PARTIALLY_REFUNDED','REFUNDED'))
        AND (EXISTS (SELECT 1 FROM "BookingIntent" b WHERE b."id" = e."bookingId" AND b."status" IN ('CANCELLED','EXPIRED','NO_SHOW','COMPLETED'))
          OR NOT EXISTS (SELECT 1 FROM "PaymentIntent" p2 WHERE p2."bookingId" = e."bookingId" AND p2."status" = 'CREATED'))
      LIMIT 500`);
    let n = 0;
    for (const r of rows) n += await this.redemption.releaseForBooking(r.bookingId, 'STALE_RESERVATION');
    return n;
  }

  /** A dependant who reached the age of majority, was deleted or left the guardian link loses access to the owner's credit at once; nothing moves. */
  async endLeftMembers(now: Date): Promise<number> {
    const members = await this.prisma.rewardHouseholdMember.findMany({ where: { endedAt: null, memberSub: { startsWith: 'dep:' } }, take: 1000 });
    let n = 0;
    for (const m of members) {
      const dep = await this.prisma.dependant.findUnique({ where: { id: m.memberSub.slice(4) } });
      if (!dep || dep.deletedAt || (dep.expiresAt && dep.expiresAt <= now)) { await this.prisma.rewardHouseholdMember.update({ where: { householdId_memberSub: { householdId: m.householdId, memberSub: m.memberSub } }, data: { endedAt: now } }); n++; }
    }
    return n;
  }
}
