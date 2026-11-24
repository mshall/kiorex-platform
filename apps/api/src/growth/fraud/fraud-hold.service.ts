import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RewardHoldService } from '../rewards/reward-hold.service';
import { RewardReversalService } from '../rewards/reward-reversal.service';
import { GrowthLimiter } from '../growth-limiter';
import type { FraudAction } from './signals';

/** `evidenceRef` prefixes the engine writes: `rel:<relationshipId>` ties a case to a referral relationship, `touch:<touchId>`, `widget:<originRef>`. */
export const relationshipIdsOf = (refs: readonly (string | null)[]): string[] => [...new Set(refs.filter((r): r is string => !!r && /^(rel|cancel):/.test(r)).map((r) => r.split(':')[1]!))];

const DAY = 86_400_000;
const FRAUD_ACTOR = 'system:fraud';

/**
 * What an enforced decision does to the world (GRW-P3-D). Everything here is reversible except a confirmed reversal, and NOTHING here touches an attribution decision, a commission,
 * a booking or a provider (the action vocabulary has no such verb; a guard test greps this file). Reward value goes through the P2-B2 services, never directly.
 */
@Injectable()
export class FraudHoldService {
  private readonly log = new Logger('fraud-hold');
  constructor(private readonly prisma: PrismaService, private readonly holds: RewardHoldService, private readonly reversal: RewardReversalService, private readonly limiter: GrowthLimiter) {}

  private async lotsOf(relationshipIds: string[]): Promise<{ id: string; kind: string }[]> {
    if (!relationshipIds.length) return [];
    return this.prisma.rewardLot.findMany({ where: { relationshipId: { in: relationshipIds } }, select: { id: true, kind: true } });
  }

  /** Freeze the unspent part of every reward lot of the relationships (a held lot cannot be reserved: P2-B2 trigger). */
  async holdRewards(relationshipIds: string[], reasonCode = 'FRAUD_REVIEW'): Promise<number> {
    let held = 0;
    for (const l of await this.lotsOf(relationshipIds)) { const r = await this.holds.hold(l.id, reasonCode, FRAUD_ACTOR); if (r.heldMinor > 0) held++; }
    return held;
  }
  async releaseRewards(relationshipIds: string[], reasonCode = 'FRAUD_CLEARED'): Promise<number> {
    let n = 0;
    for (const l of await this.lotsOf(relationshipIds)) { const r = await this.holds.release(l.id, FRAUD_ACTOR, reasonCode); if (r.releasedMinor > 0) n++; }
    return n;
  }
  /** Confirmed fraud: take back what is unspent (a spent part becomes a recoverable loss). Refund credit lots are never reversed (P2-B2 rule). */
  async reverseRewards(relationshipIds: string[], actor: string): Promise<{ reversedMinor: number; lots: number }> {
    let reversedMinor = 0; let lots = 0;
    for (const l of await this.lotsOf(relationshipIds)) { const r = await this.reversal.reverseLot(l.id, 'FRAUD_CONFIRMED', actor); if (r.reversedMinor > 0) { reversedMinor += r.reversedMinor; lots++; } }
    return { reversedMinor, lots };
  }

  /** The referrer's invite code goes to SUSPENDED (they can no longer invite). Their own account, bookings and rewards are untouched. */
  async suspendReferral(relationshipIds: string[]): Promise<number> {
    if (!relationshipIds.length) return 0;
    const rels = await this.prisma.referralRelationship.findMany({ where: { id: { in: relationshipIds } }, select: { codeId: true } });
    const r = await this.prisma.referralCode.updateMany({ where: { id: { in: rels.map((x) => x.codeId) }, status: 'ACTIVE' }, data: { status: 'SUSPENDED' } });
    return r.count;
  }
  async reinstateReferral(relationshipIds: string[]): Promise<number> {
    if (!relationshipIds.length) return 0;
    const rels = await this.prisma.referralRelationship.findMany({ where: { id: { in: relationshipIds } }, select: { codeId: true } });
    return (await this.prisma.referralCode.updateMany({ where: { id: { in: rels.map((x) => x.codeId) }, status: 'SUSPENDED' }, data: { status: 'ACTIVE' } })).count;
  }

  /** Widget origin throttle: a short-lived marker in the shared limiter; the widget guard asks `originThrottled` before it serves the request. */
  async throttleOrigin(originRef: string, minutes = 60): Promise<void> {
    await this.limiter.limiter.hit(`fraud:origin-throttle:${originRef}`, 1, minutes * 60_000);
  }
  async originThrottled(originRef: string): Promise<boolean> {
    // peek only: a marker (one hit) exists while the origin is throttled; the window is fixed, so a throttle lasts up to the configured minutes
    const r = await this.limiter.limiter.blocked(`fraud:origin-throttle:${originRef}`, 1, 60 * 60_000);
    return !r.ok;
  }

  /** Touch quarantine: an audit row the reports can read (`quarantinedTouchIds`). The touch itself is append-only and the attribution decision is never changed. */
  async quarantineTouch(touchRef: string): Promise<void> {
    await this.prisma.auditLog.create({ data: { actor: FRAUD_ACTOR, action: 'growth.fraud.touch_quarantine', resource: 'GrowthTouchpoint', resourceId: touchRef, metadata: { reversible: true } } });
  }
  async quarantinedTouchIds(since: Date): Promise<string[]> {
    return (await this.prisma.auditLog.findMany({ where: { action: 'growth.fraud.touch_quarantine', createdAt: { gte: since } }, select: { resourceId: true } })).map((r) => r.resourceId!).filter(Boolean);
  }

  /** Apply the action of an enforced decision. Returns what happened for the decision log; never throws into the caller's request. */
  async apply(action: FraudAction, ctx: { relationshipIds: string[]; touchRef?: string; originRef?: string }): Promise<string> {
    try {
      switch (action) {
        case 'HOLD_REWARD': return `held ${await this.holdRewards(ctx.relationshipIds)} lot(s)`;
        case 'SUSPEND_REFERRAL': return `suspended ${await this.suspendReferral(ctx.relationshipIds)} code(s)`;
        case 'THROTTLE_ORIGIN': if (ctx.originRef) { await this.throttleOrigin(ctx.originRef); return 'origin throttled'; } return 'no origin';
        case 'QUARANTINE_TOUCH': if (ctx.touchRef) { await this.quarantineTouch(ctx.touchRef); return 'touch quarantined'; } return 'no touch';
        default: return 'none'; // REJECT_CLAIM is applied by the claim service itself; OPEN_CASE and OPEN_PROVIDER_REVIEW only record
      }
    } catch (e) { this.log.warn(`apply ${action} failed: ${(e as Error).message}`); return `failed: ${(e as Error).message.slice(0, 80)}`; }
  }

  static readonly DAY = DAY;
}
