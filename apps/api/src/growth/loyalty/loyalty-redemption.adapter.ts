import { Injectable } from '@nestjs/common';
import type { Tx } from '../../prisma/prisma.service';
import { RewardIssuanceService, issueKey, type IssuePolicy, type IssueResult } from '../rewards/reward-issuance.service';

/**
 * The ONLY place the loyalty module touches the patient reward ledger (P2-B2). Points become value by one route: a reward lot issued through RewardIssuanceService inside the caller's transaction, so its
 * caps (annual cap per person, rule budget ceiling, maximum open balance, active lots), idempotency and ledger trigger apply unchanged and a refusal rolls the whole conversion back.
 * Two kinds are issued here: `LOYALTY` (points converted) and `PROMO` (a partnership code, tied to the program's campaign). Both are marketing-funded: Kiorex pays, nothing is cash, transferable or withdrawable.
 */
@Injectable()
export class LoyaltyRedemptionAdapter {
  constructor(private readonly issuance: RewardIssuanceService) {}
  policy(): Promise<IssuePolicy> { return this.issuance.policySnapshot(); }
  /** What the patient needs to know about a lot this module issued (a read of the reward ledger, never a write). */
  async lot(tx: Tx, lotId: string) { const l = await tx.rewardLot.findUniqueOrThrow({ where: { id: lotId }, select: { id: true, mode: true, amountMinor: true, currency: true } }); return l; }

  /** Points converted into a LOYALTY lot. `key` is the conversion key: a retry returns the same lot. */
  issueLoyaltyLot(tx: Tx, i: { sub: string; accountId: string; amountMinor: number; key: string; pre: IssuePolicy; now?: Date }): Promise<IssueResult> {
    return this.issuance.issue({ kind: 'LOYALTY', sub: i.sub, amountMinor: i.amountMinor, funding: 'PLATFORM_MARKETING', idempotencyKey: issueKey('loyalty', i.accountId, i.key), reasonCode: 'LOYALTY_CONVERSION', actor: 'system:loyalty', pre: i.pre, now: i.now }, tx);
  }
  /** A partnership redemption: a PROMO lot for the program's campaign. */
  issuePartnershipLot(tx: Tx, i: { sub: string; programId: string; campaignId: string; amountMinor: number; personKey: string; pre: IssuePolicy; now?: Date }): Promise<IssueResult> {
    return this.issuance.issue({ kind: 'PROMO', sub: i.sub, amountMinor: i.amountMinor, funding: 'PLATFORM_MARKETING', idempotencyKey: issueKey('partner', i.programId, i.personKey), reasonCode: 'PARTNERSHIP_CODE', actor: 'system:partnership', campaignId: i.campaignId, pre: i.pre, now: i.now }, tx);
  }
}
