import { Injectable } from '@nestjs/common';
import { Prisma, type GrowthCampaign, type GrowthCampaignApproval } from '../../prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OutboxService } from '../../outbox/outbox-public';
import { growthError } from '../growth-errors';
import { utilisationBp } from './campaign-guardrails';
import { moneyHash, moneyPayload } from './campaign-hash';
import { CampaignBudgetService } from './campaign-budget.service';
import { CampaignService, type Actor } from './campaign.service';
import type { DecideApprovalDto, RequestApprovalDto } from './campaign-dto';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/**
 * Maker-checker for campaigns (GRW-P2-A). The creator of a request can never decide it (service check, then a database CHECK). An approval covers an EXACT payload: its hash is
 * stored in the snapshot, the decider must send the hash they reviewed, and it must still equal the campaign's current money-relevant payload. A later edit of budgets, channels,
 * dates or eligibility clears `approvedPayloadHash`, so the campaign cannot start on an approval that no longer describes it.
 */
@Injectable()
export class CampaignApprovalService {
  constructor(private readonly prisma: PrismaService, private readonly campaigns: CampaignService, private readonly budget: CampaignBudgetService, private readonly outbox: OutboxService) {}

  async request(actor: Actor, campaignId: string, dto: RequestApprovalDto) {
    return this.prisma.$transaction(async (tx) => {
      const c = await this.campaigns.lock(tx, campaignId);
      const open = await tx.growthCampaignApproval.findFirst({ where: { campaignId, kind: dto.kind, decision: null } });
      if (open) throw growthError('CAMPAIGN_INVALID', `A ${dto.kind} approval is already waiting for a decision`, { errors: [{ path: '/kind', message: 'Already pending', approvalId: open.id }] });
      let target = c;
      if (dto.kind === 'ACTIVATE') {
        if (c.status !== 'DRAFT') throw growthError('CAMPAIGN_INVALID_TRANSITION', `Only a DRAFT campaign can be sent for activation approval (this one is ${c.status})`);
      } else if (dto.kind === 'BUDGET_INCREASE') {
        if (!['SCHEDULED', 'ACTIVE', 'PAUSED'].includes(c.status)) throw growthError('CAMPAIGN_INVALID_TRANSITION', `A budget increase applies to a SCHEDULED, ACTIVE or PAUSED campaign (this one is ${c.status})`);
        const total = dto.budgetTotalMinor ?? c.budgetTotalMinor; const daily = dto.budgetDailyMinor ?? c.budgetDailyMinor;
        if (total <= c.budgetTotalMinor && daily <= c.budgetDailyMinor) throw growthError('CAMPAIGN_INVALID', 'A budget increase must raise the total or the daily cap', { errors: [{ path: '/budgetTotalMinor', message: 'Not an increase' }] });
        if (daily > total) throw growthError('CAMPAIGN_INVALID', 'The daily cap cannot exceed the total budget', { errors: [{ path: '/budgetDailyMinor', message: 'Above total' }] });
        target = { ...c, budgetTotalMinor: total, budgetDailyMinor: daily };
      } else if (c.status !== 'PAUSED') throw growthError('CAMPAIGN_INVALID_TRANSITION', `A reactivation approval applies to a PAUSED campaign (this one is ${c.status})`);
      const payload = moneyPayload(this.campaigns.moneyOf(target)); const hash = moneyHash(this.campaigns.moneyOf(target));
      const row = await tx.growthCampaignApproval.create({ data: { campaignId, kind: dto.kind, requestedBy: actor.sub, snapshot: { payload, note: dto.note ?? null } as unknown as Prisma.InputJsonValue, snapshotHash: hash } });
      await this.campaigns.audit(tx, actor, 'approval.request', campaignId, { approvalId: row.id, kind: dto.kind, snapshotHash: hash });
      if (dto.kind === 'ACTIVATE') await this.campaigns.moveLocked(tx, c, actor, 'PENDING_APPROVAL', { reasonCode: 'APPROVAL_REQUESTED' });
      return this.present(row);
    });
  }

  async decide(actor: Actor, approvalId: string, dto: DecideApprovalDto) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(approvalId)) throw growthError('CAMPAIGN_NOT_FOUND', 'Approval not found');
    const found = await this.prisma.growthCampaignApproval.findUnique({ where: { id: approvalId } });
    if (!found) throw growthError('CAMPAIGN_NOT_FOUND', 'Approval not found');
    const result = await this.prisma.$transaction(async (tx) => {
      const c = await this.campaigns.lock(tx, found.campaignId);
      const a = await tx.growthCampaignApproval.findUniqueOrThrow({ where: { id: approvalId } });
      if (a.decision) throw growthError('CAMPAIGN_INVALID', `The approval was already ${a.decision.toLowerCase()}`, { errors: [{ path: '/', message: 'Already decided' }] });
      if (a.requestedBy === actor.sub) throw growthError('CAMPAIGN_SELF_APPROVAL', 'The person who asked for an approval cannot decide it');
      if (dto.snapshotHash !== a.snapshotHash) throw growthError('CAMPAIGN_LOCKED', 'The approval was reviewed on a different payload: reload it', { snapshotHash: a.snapshotHash });
      const now = new Date();
      if (dto.decision === 'REJECTED') {
        if (!dto.reason?.trim()) throw growthError('CAMPAIGN_INVALID', 'A reason is required to reject', { errors: [{ path: '/reason', message: 'Required' }] });
        await this.stamp(tx, a, actor, 'REJECTED', dto.reason, now);
        if (a.kind === 'ACTIVATE' && c.status === 'PENDING_APPROVAL') await this.campaigns.moveLocked(tx, c, actor, 'DRAFT', { reasonCode: 'REJECTED', reason: dto.reason, now });
      } else if (a.kind === 'BUDGET_INCREASE') {
        const p = (a.snapshot as unknown as { payload: { budgetTotalMinor: number; budgetDailyMinor: number } }).payload;
        const updated = await tx.growthCampaign.update({ where: { id: c.id }, data: { budgetTotalMinor: p.budgetTotalMinor, budgetDailyMinor: p.budgetDailyMinor, version: { increment: 1 } } });
        if (this.campaigns.hashOf(updated) !== a.snapshotHash) throw growthError('CAMPAIGN_LOCKED', 'The campaign changed since this budget increase was requested: ask again', { currentHash: this.campaigns.hashOf(updated) });
        await tx.growthCampaign.update({ where: { id: c.id }, data: { approvedPayloadHash: a.snapshotHash } });
        const spend = await this.campaigns.approvedSpend(c.id, tx);
        if (updated.status === 'PAUSED' && updated.pauseReason === 'BUDGET' && utilisationBp(spend.approved, p.budgetTotalMinor) < 10_000) await tx.growthCampaign.update({ where: { id: c.id }, data: { pauseReason: 'MANUAL' } });
        await this.stamp(tx, a, actor, 'APPROVED', dto.reason, now);
      } else {
        if (this.campaigns.hashOf(c) !== a.snapshotHash) throw growthError('CAMPAIGN_LOCKED', 'The campaign changed since this approval was requested: ask again', { currentHash: this.campaigns.hashOf(c) });
        await tx.growthCampaign.update({ where: { id: c.id }, data: { approvedPayloadHash: a.snapshotHash } });
        await this.stamp(tx, a, actor, 'APPROVED', dto.reason, now);
        if (a.kind === 'ACTIVATE') await this.campaigns.moveLocked(tx, await this.campaigns.must(c.id, tx), actor, 'SCHEDULED', { reasonCode: 'APPROVED', now });
      }
      await this.outbox.enqueue(tx, { type: 'CampaignApprovalDecided', aggregateType: 'GrowthCampaign', aggregateId: c.id, payload: { campaignId: c.id, approvalId: a.id, kind: a.kind, decision: dto.decision, snapshotHash: a.snapshotHash, decidedAt: now.toISOString() }, dedupeKey: `CampaignApprovalDecided:${a.id}` });
      return tx.growthCampaignApproval.findUniqueOrThrow({ where: { id: a.id } });
    });
    if (result.kind === 'BUDGET_INCREASE') await this.budget.recompute(result.campaignId);
    return this.present(result);
  }

  private async stamp(tx: Prisma.TransactionClient, a: GrowthCampaignApproval, actor: Actor, decision: 'APPROVED' | 'REJECTED', reason: string | undefined, at: Date) {
    await tx.growthCampaignApproval.update({ where: { id: a.id }, data: { decidedBy: actor.sub, decision, decidedAt: at, reason: reason?.slice(0, 300) ?? null } });
    await this.campaigns.audit(tx, actor, `approval.${decision.toLowerCase()}`, a.campaignId, { approvalId: a.id, kind: a.kind, snapshotHash: a.snapshotHash });
  }

  async list(f: { status?: 'pending' | 'decided'; campaignId?: string; take?: number } = {}) {
    const rows = await this.prisma.growthCampaignApproval.findMany({
      where: { ...(f.campaignId ? { campaignId: f.campaignId } : {}), ...(f.status === 'pending' ? { decision: null } : f.status === 'decided' ? { decision: { not: null } } : {}) },
      orderBy: { requestedAt: 'desc' }, take: Math.min(Math.max(f.take ?? 100, 1), 200), include: { campaign: { select: { id: true, key: true, name: true, status: true, market: true, budgetTotalMinor: true, currency: true, channels: true } } },
    });
    return rows.map((r) => ({ ...this.present(r), campaign: r.campaign }));
  }
  async get(id: string) {
    const r = /^[A-Za-z0-9_-]{1,64}$/.test(id) ? await this.prisma.growthCampaignApproval.findUnique({ where: { id }, include: { campaign: true } }) : null;
    if (!r) throw growthError('CAMPAIGN_NOT_FOUND', 'Approval not found');
    return { ...this.present(r), campaign: await this.campaigns.present(r.campaign as GrowthCampaign) };
  }
  present(a: GrowthCampaignApproval) {
    return { id: a.id, campaignId: a.campaignId, kind: a.kind, requestedBy: a.requestedBy, requestedAt: a.requestedAt.toISOString(), decidedBy: a.decidedBy, decidedAt: iso(a.decidedAt), decision: a.decision, reason: a.reason, snapshot: a.snapshot, snapshotHash: a.snapshotHash };
  }
}
