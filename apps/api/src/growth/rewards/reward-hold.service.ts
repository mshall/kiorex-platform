import { Injectable } from '@nestjs/common';
import { ApiError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { RewardEventsService } from './reward-events.service';
import { RewardLedgerService } from './reward-ledger.service';
import { entryKey } from './reward-math';
import { RewardPolicyService } from './reward-policy.service';

/**
 * Reward holds (GRW-P2-B2): a HOLD freezes the available part of a lot (fraud review); a held lot cannot be reserved (its available balance is zero and a database trigger agrees).
 * RELEASE_HOLD follows a decision, or happens by itself after `holdMaxDays` so a forgotten review never strands a patient's value. A REFUND_CREDIT lot may be held (chargeback, ops) but is never reversed.
 */
@Injectable()
export class RewardHoldService {
  constructor(private readonly prisma: PrismaService, private readonly ledger: RewardLedgerService, private readonly policy: RewardPolicyService, private readonly events: RewardEventsService) {}

  async hold(lotId: string, reasonCode: string, actor: string): Promise<{ heldMinor: number }> {
    return this.prisma.$transaction(async (tx) => {
      if (!(await tx.rewardLot.findUnique({ where: { id: lotId }, select: { id: true } }))) throw new ApiError(404, 'REWARD_LOT_NOT_FOUND', 'Reward lot not found');
      await this.ledger.lock(tx, [lotId]);
      const { versionId } = await this.policy.rewardRules();
      const b = await this.ledger.balance(tx, lotId);
      if (b.available <= 0) return { heldMinor: 0 };
      const last = await tx.rewardLedgerEntry.findFirst({ where: { lotId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true } });
      await this.ledger.append(tx, { lotId, type: 'HOLD', amountMinor: b.available, idempotencyKey: entryKey('hold', lotId, last?.id ?? '-', b.available), ruleVersionId: versionId, reasonCode, actor });
      await this.ledger.refreshStatus(tx, lotId);
      const lot = await tx.rewardLot.findUniqueOrThrow({ where: { id: lotId } });
      await this.events.emit(tx, 'RewardHeld', 'RewardLot', lotId, { lotRef: lotId, market: lot.market, mode: lot.mode, amountMinor: b.available, currency: lot.currency, reasonCode, idempotencyKey: entryKey('hold', lotId, last?.id ?? '-', b.available), at: new Date().toISOString() }, `${lotId}:${last?.id ?? '-'}`);
      await tx.auditLog.create({ data: { actor, action: 'growth.reward.hold', resource: 'RewardLot', resourceId: lotId, metadata: { reasonCode, amountMinor: b.available } } });
      return { heldMinor: b.available };
    });
  }

  async release(lotId: string, actor: string, reasonCode = 'FRAUD_CLEARED'): Promise<{ releasedMinor: number }> {
    return this.prisma.$transaction(async (tx) => {
      if (!(await tx.rewardLot.findUnique({ where: { id: lotId }, select: { id: true } }))) throw new ApiError(404, 'REWARD_LOT_NOT_FOUND', 'Reward lot not found');
      await this.ledger.lock(tx, [lotId]);
      const { versionId } = await this.policy.rewardRules();
      const b = await this.ledger.balance(tx, lotId);
      if (b.held <= 0) return { releasedMinor: 0 };
      const last = await tx.rewardLedgerEntry.findFirst({ where: { lotId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true } });
      await this.ledger.append(tx, { lotId, type: 'RELEASE_HOLD', amountMinor: b.held, idempotencyKey: entryKey('release-hold', lotId, last?.id ?? '-', b.held), ruleVersionId: versionId, reasonCode, actor });
      await this.ledger.refreshStatus(tx, lotId);
      await tx.auditLog.create({ data: { actor, action: 'growth.reward.release_hold', resource: 'RewardLot', resourceId: lotId, metadata: { reasonCode, amountMinor: b.held } } });
      return { releasedMinor: b.held };
    });
  }

  /** Holds older than REWARD_RULES.holdMaxDays are released without a decision. */
  async autoRelease(now = new Date()): Promise<number> {
    const { rules } = await this.policy.rewardRules();
    const cutoff = new Date(now.getTime() - rules.holdMaxDays * 86_400_000);
    const lots = await this.prisma.$queryRaw<{ id: string }[]>`SELECT l."id" FROM "RewardLot" l WHERE l."status" = 'HELD' AND NOT EXISTS (SELECT 1 FROM "RewardLedgerEntry" e WHERE e."lotId" = l."id" AND e."type" = 'HOLD' AND e."createdAt" > ${cutoff})`;
    let n = 0;
    for (const l of lots) { const r = await this.release(l.id, 'system:hold-timeout', 'HOLD_TIMEOUT'); if (r.releasedMinor > 0) n++; }
    return n;
  }
}
