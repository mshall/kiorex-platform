import { Injectable } from '@nestjs/common';
import { ApiError } from '../../common/errors';
import { addressHash } from '../../common/privacy-hash';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { checkGoodwill, type GoodwillRequest } from './goodwill-limits';
import { RewardEventsService } from './reward-events.service';
import { RewardIssuanceService, issueKey, type IssueResult } from './reward-issuance.service';
import { RewardPolicyService } from './reward-policy.service';

export interface OpsActor { sub: string; roles: string[]; phone?: string }
const startOfDayUtc = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * Support goodwill and manual issuance (GRW-P2-B2), the only ways a human adds value. Both: closed reasons, mandatory booking or ticket reference, per-agent daily caps, a second approver above a
 * threshold (maker-checker, a decided request is immutable), every action in AuditLog, and a notice event. A support agent sees lots and balances only: nothing here edits a ledger entry.
 * "Charging the provider for provider-fault goodwill" is NOT built: the funding label is PLATFORM_SERVICE_RECOVERY and there is no path to the provider wallet (separate system).
 */
@Injectable()
export class GoodwillService {
  constructor(private readonly prisma: PrismaService, private readonly policy: RewardPolicyService, private readonly issuance: RewardIssuanceService, private readonly events: RewardEventsService) {}

  private async phoneRelated(actor: OpsActor, targetSub: string): Promise<boolean> {
    if (actor.sub === targetSub) return true;
    if (!actor.phone) return false;
    const sig = await this.prisma.referralIdentitySignal.findFirst({ where: { kind: 'PHONE', valueHash: addressHash(actor.phone), sub: targetSub } });
    return !!sig;
  }

  /** Goodwill grant. Returns the issued lot, or a pending approval request when the amount is above the threshold. */
  async grant(actor: OpsActor, i: GoodwillRequest & { sub: string; now?: Date }) {
    if (!(await this.policy.rewardsOn()) || !(await this.policy.goodwillOn())) throw new ApiError(403, 'FEATURE_DISABLED', 'Support goodwill is switched off', { key: 'growth.support_goodwill', scope: 'global' });
    const now = i.now ?? new Date();
    const { rules } = await this.policy.rewardRules();
    const today = await this.prisma.goodwillGrant.aggregate({ where: { grantedBy: actor.sub, createdAt: { gte: startOfDayUtc(now) } }, _sum: { amountMinor: true } });
    const pending = await this.prisma.rewardApprovalRequest.aggregate({ where: { kind: 'GOODWILL', requestedBy: actor.sub, status: 'PENDING', createdAt: { gte: startOfDayUtc(now) } }, _sum: { amountMinor: true } });
    const p90 = await this.prisma.goodwillGrant.aggregate({ where: { sub: i.sub, createdAt: { gte: new Date(now.getTime() - 90 * 86_400_000) } }, _sum: { amountMinor: true } });
    const v = checkGoodwill(rules.credit.goodwill, i, { actorGrantedTodayMinor: (today._sum.amountMinor ?? 0) + (pending._sum.amountMinor ?? 0), patientGranted90dMinor: p90._sum.amountMinor ?? 0, actorIsTarget: await this.phoneRelated(actor, i.sub) });
    if (!v.ok) throw new ApiError(422, `GOODWILL_${v.code}`, 'The goodwill grant is outside the limits', { reason: v.code });
    if (i.bookingId && !(await this.prisma.bookingIntent.findFirst({ where: { id: i.bookingId, sub: i.sub }, select: { id: true } }))) throw new ApiError(422, 'GOODWILL_REFERENCE_INVALID', 'The booking reference does not belong to this patient');
    if (v.needsSecondApprover) {
      const r = await this.prisma.rewardApprovalRequest.create({ data: { kind: 'GOODWILL', sub: i.sub, amountMinor: i.amountMinor, reason: i.reason, bookingId: i.bookingId ?? null, ticketRef: i.ticketRef ?? null, requestedBy: actor.sub } });
      await this.prisma.auditLog.create({ data: { actor: actor.sub, action: 'growth.goodwill.request', resource: 'RewardApprovalRequest', resourceId: r.id, metadata: { reason: i.reason, amountMinor: i.amountMinor } } });
      return { status: 'PENDING_APPROVAL' as const, requestId: r.id };
    }
    return this.issueGrant(actor.sub, null, { sub: i.sub, reason: i.reason, amountMinor: i.amountMinor, bookingId: i.bookingId ?? null, ticketRef: i.ticketRef ?? null, key: issueKey('goodwill', actor.sub, i.sub, i.reason, i.bookingId ?? i.ticketRef ?? '-', now.getTime()) }, now);
  }

  private async issueGrant(grantedBy: string, approvedBy: string | null, g: { sub: string; reason: string; amountMinor: number; bookingId: string | null; ticketRef: string | null; key: string }, now: Date, outer?: Tx) {
    const res: IssueResult = await this.issuance.issue({ kind: 'GOODWILL', sub: g.sub, amountMinor: g.amountMinor, funding: 'PLATFORM_SERVICE_RECOVERY', idempotencyKey: g.key, reasonCode: g.reason, actor: grantedBy, now, bookingId: g.bookingId }, outer);
    if (res.status === 'SKIPPED') throw new ApiError(422, `GOODWILL_${res.reason}`, 'The goodwill grant could not be issued', { reason: res.reason });
    const db = outer ?? this.prisma;
    const existing = await db.goodwillGrant.findFirst({ where: { lotId: res.lotId } });
    const grant = existing ?? await db.goodwillGrant.create({ data: { sub: g.sub, reason: g.reason, bookingId: g.bookingId, ticketRef: g.ticketRef, amountMinor: g.amountMinor, lotId: res.lotId, grantedBy, approvedBy } });
    await db.auditLog.create({ data: { actor: approvedBy ?? grantedBy, action: 'growth.goodwill.grant', resource: 'GoodwillGrant', resourceId: grant.id, metadata: { reason: g.reason, amountMinor: g.amountMinor, secondApproval: !!approvedBy, lotId: res.lotId } } });
    await this.events.emit(db, 'GoodwillGranted', 'GoodwillGrant', grant.id, { grantRef: grant.id, lotRef: res.lotId, market: 'EG', reason: g.reason, amountMinor: g.amountMinor, currency: 'EGP', secondApproval: !!approvedBy, at: now.toISOString() }, grant.id);
    return { status: 'GRANTED' as const, grantId: grant.id, lotId: res.lotId };
  }

  /** The second approver decides a pending request (never the requester). */
  async decide(actor: OpsActor, requestId: string, decision: 'APPROVED' | 'REJECTED', note?: string, now = new Date()) {
    const r = await this.prisma.rewardApprovalRequest.findUnique({ where: { id: requestId } });
    if (!r) throw new ApiError(404, 'APPROVAL_NOT_FOUND', 'Approval request not found');
    if (r.status !== 'PENDING') throw new ApiError(409, 'APPROVAL_ALREADY_DECIDED', 'This request was already decided');
    if (r.requestedBy === actor.sub) throw new ApiError(403, 'APPROVAL_SELF_DECISION', 'The person who asked cannot decide the request');
    if (decision === 'REJECTED') {
      await this.prisma.rewardApprovalRequest.update({ where: { id: r.id }, data: { status: 'REJECTED', decidedBy: actor.sub, decidedAt: now, decisionNote: note?.slice(0, 300) } });
      await this.prisma.auditLog.create({ data: { actor: actor.sub, action: 'growth.reward_approval.reject', resource: 'RewardApprovalRequest', resourceId: r.id, metadata: { kind: r.kind } } });
      return { status: 'REJECTED' as const, requestId: r.id };
    }
    return this.prisma.$transaction(async (tx) => {
      // issue first (idempotent per request), then close the request in ONE guarded update: a second approver at the same moment finds it decided and rolls back
      let lotId: string;
      if (r.kind === 'GOODWILL') lotId = (await this.issueGrant(r.requestedBy, actor.sub, { sub: r.sub, reason: r.reason, amountMinor: r.amountMinor, bookingId: r.bookingId, ticketRef: r.ticketRef, key: issueKey('goodwill-request', r.id) }, now, tx)).lotId;
      else {
        const res = await this.issuance.issue({ kind: 'PROMO', sub: r.sub, amountMinor: r.amountMinor, funding: 'PLATFORM_MARKETING', idempotencyKey: issueKey('manual-request', r.id), reasonCode: 'MANUAL_ISSUE', actor: r.requestedBy, now }, tx);
        if (res.status === 'SKIPPED') throw new ApiError(422, `MANUAL_ISSUE_${res.reason}`, 'The manual issuance could not be issued', { reason: res.reason });
        lotId = res.lotId;
        await tx.auditLog.create({ data: { actor: actor.sub, action: 'growth.manual_issue.approve', resource: 'RewardApprovalRequest', resourceId: r.id, metadata: { amountMinor: r.amountMinor, lotId } } });
      }
      const closed = await tx.rewardApprovalRequest.updateMany({ where: { id: r.id, status: 'PENDING' }, data: { status: 'APPROVED', decidedBy: actor.sub, decidedAt: now, decisionNote: note?.slice(0, 300), lotId } });
      if (!closed.count) throw new ApiError(409, 'APPROVAL_ALREADY_DECIDED', 'This request was already decided');
      return { status: 'APPROVED' as const, requestId: r.id, lotId };
    }, { timeout: 20_000 });
  }

  /** Manual issuance by ops (compensation outside goodwill): reason, per-actor daily cap, second approver above the threshold; never bulk. */
  async manualIssue(actor: OpsActor, i: { sub: string; amountMinor: number; reason: string; bookingId?: string | null; ticketRef?: string | null; now?: Date }) {
    if (!(await this.policy.rewardsOn())) throw new ApiError(403, 'FEATURE_DISABLED', 'Rewards are switched off', { key: 'growth.rewards', scope: 'global' });
    const now = i.now ?? new Date();
    const { rules } = await this.policy.rewardRules();
    if (!i.reason?.trim() || i.reason.length > 300) throw new ApiError(422, 'MANUAL_REASON_REQUIRED', 'A reason (up to 300 characters) is required');
    if (!Number.isInteger(i.amountMinor) || i.amountMinor <= 0) throw new ApiError(422, 'AMOUNT_INVALID', 'amountMinor must be a positive whole number');
    if (await this.phoneRelated(actor, i.sub)) throw new ApiError(422, 'MANUAL_SELF_GRANT', 'A grant to your own or a related account is not allowed');
    const day = startOfDayUtc(now);
    const [a, b] = await Promise.all([
      this.prisma.rewardLot.aggregate({ where: { issuedBy: actor.sub, createdAt: { gte: day }, kind: 'PROMO' }, _sum: { amountMinor: true } }),
      this.prisma.rewardApprovalRequest.aggregate({ where: { kind: 'MANUAL_ISSUE', requestedBy: actor.sub, status: 'PENDING', createdAt: { gte: day } }, _sum: { amountMinor: true } }),
    ]);
    if ((a._sum.amountMinor ?? 0) + (b._sum.amountMinor ?? 0) + i.amountMinor > rules.manualDailyCapPerActorMinor) throw new ApiError(422, 'MANUAL_DAILY_CAP', 'The daily cap for manual issuance is reached');
    if (i.amountMinor > rules.manualApprovalAboveMinor) {
      const r = await this.prisma.rewardApprovalRequest.create({ data: { kind: 'MANUAL_ISSUE', sub: i.sub, amountMinor: i.amountMinor, reason: i.reason.trim(), bookingId: i.bookingId ?? null, ticketRef: i.ticketRef ?? null, requestedBy: actor.sub } });
      await this.prisma.auditLog.create({ data: { actor: actor.sub, action: 'growth.manual_issue.request', resource: 'RewardApprovalRequest', resourceId: r.id, metadata: { amountMinor: i.amountMinor } } });
      return { status: 'PENDING_APPROVAL' as const, requestId: r.id };
    }
    const res = await this.issuance.issue({ kind: 'PROMO', sub: i.sub, amountMinor: i.amountMinor, funding: 'PLATFORM_MARKETING', idempotencyKey: issueKey('manual', actor.sub, i.sub, now.getTime(), i.amountMinor), reasonCode: 'MANUAL_ISSUE', actor: actor.sub, now });
    if (res.status === 'SKIPPED') throw new ApiError(422, `MANUAL_ISSUE_${res.reason}`, 'The manual issuance could not be issued', { reason: res.reason });
    await this.prisma.auditLog.create({ data: { actor: actor.sub, action: 'growth.manual_issue', resource: 'RewardLot', resourceId: res.lotId, metadata: { amountMinor: i.amountMinor, reason: i.reason.trim().slice(0, 120) } } });
    return { status: 'ISSUED' as const, lotId: res.lotId };
  }

  pending(take = 100) { return this.prisma.rewardApprovalRequest.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, take, select: { id: true, kind: true, amountMinor: true, reason: true, bookingId: true, ticketRef: true, requestedBy: true, createdAt: true } }); }
}
