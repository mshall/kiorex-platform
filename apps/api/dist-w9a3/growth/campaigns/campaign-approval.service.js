"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CampaignApprovalService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const outbox_public_1 = require("../../outbox/outbox-public");
const growth_errors_1 = require("../growth-errors");
const campaign_guardrails_1 = require("./campaign-guardrails");
const campaign_hash_1 = require("./campaign-hash");
const campaign_budget_service_1 = require("./campaign-budget.service");
const campaign_service_1 = require("./campaign.service");
const iso = (d) => (d ? d.toISOString() : null);
let CampaignApprovalService = class CampaignApprovalService {
    prisma;
    campaigns;
    budget;
    outbox;
    constructor(prisma, campaigns, budget, outbox) {
        this.prisma = prisma;
        this.campaigns = campaigns;
        this.budget = budget;
        this.outbox = outbox;
    }
    async request(actor, campaignId, dto) {
        return this.prisma.$transaction(async (tx) => {
            const c = await this.campaigns.lock(tx, campaignId);
            const open = await tx.growthCampaignApproval.findFirst({ where: { campaignId, kind: dto.kind, decision: null } });
            if (open)
                throw (0, growth_errors_1.growthError)('CAMPAIGN_INVALID', `A ${dto.kind} approval is already waiting for a decision`, { errors: [{ path: '/kind', message: 'Already pending', approvalId: open.id }] });
            let target = c;
            if (dto.kind === 'ACTIVATE') {
                if (c.status !== 'DRAFT')
                    throw (0, growth_errors_1.growthError)('CAMPAIGN_INVALID_TRANSITION', `Only a DRAFT campaign can be sent for activation approval (this one is ${c.status})`);
            }
            else if (dto.kind === 'BUDGET_INCREASE') {
                if (!['SCHEDULED', 'ACTIVE', 'PAUSED'].includes(c.status))
                    throw (0, growth_errors_1.growthError)('CAMPAIGN_INVALID_TRANSITION', `A budget increase applies to a SCHEDULED, ACTIVE or PAUSED campaign (this one is ${c.status})`);
                const total = dto.budgetTotalMinor ?? c.budgetTotalMinor;
                const daily = dto.budgetDailyMinor ?? c.budgetDailyMinor;
                if (total <= c.budgetTotalMinor && daily <= c.budgetDailyMinor)
                    throw (0, growth_errors_1.growthError)('CAMPAIGN_INVALID', 'A budget increase must raise the total or the daily cap', { errors: [{ path: '/budgetTotalMinor', message: 'Not an increase' }] });
                if (daily > total)
                    throw (0, growth_errors_1.growthError)('CAMPAIGN_INVALID', 'The daily cap cannot exceed the total budget', { errors: [{ path: '/budgetDailyMinor', message: 'Above total' }] });
                target = { ...c, budgetTotalMinor: total, budgetDailyMinor: daily };
            }
            else if (c.status !== 'PAUSED')
                throw (0, growth_errors_1.growthError)('CAMPAIGN_INVALID_TRANSITION', `A reactivation approval applies to a PAUSED campaign (this one is ${c.status})`);
            const payload = (0, campaign_hash_1.moneyPayload)(this.campaigns.moneyOf(target));
            const hash = (0, campaign_hash_1.moneyHash)(this.campaigns.moneyOf(target));
            const row = await tx.growthCampaignApproval.create({ data: { campaignId, kind: dto.kind, requestedBy: actor.sub, snapshot: { payload, note: dto.note ?? null }, snapshotHash: hash } });
            await this.campaigns.audit(tx, actor, 'approval.request', campaignId, { approvalId: row.id, kind: dto.kind, snapshotHash: hash });
            if (dto.kind === 'ACTIVATE')
                await this.campaigns.moveLocked(tx, c, actor, 'PENDING_APPROVAL', { reasonCode: 'APPROVAL_REQUESTED' });
            return this.present(row);
        });
    }
    async decide(actor, approvalId, dto) {
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(approvalId))
            throw (0, growth_errors_1.growthError)('CAMPAIGN_NOT_FOUND', 'Approval not found');
        const found = await this.prisma.growthCampaignApproval.findUnique({ where: { id: approvalId } });
        if (!found)
            throw (0, growth_errors_1.growthError)('CAMPAIGN_NOT_FOUND', 'Approval not found');
        const result = await this.prisma.$transaction(async (tx) => {
            const c = await this.campaigns.lock(tx, found.campaignId);
            const a = await tx.growthCampaignApproval.findUniqueOrThrow({ where: { id: approvalId } });
            if (a.decision)
                throw (0, growth_errors_1.growthError)('CAMPAIGN_INVALID', `The approval was already ${a.decision.toLowerCase()}`, { errors: [{ path: '/', message: 'Already decided' }] });
            if (a.requestedBy === actor.sub)
                throw (0, growth_errors_1.growthError)('CAMPAIGN_SELF_APPROVAL', 'The person who asked for an approval cannot decide it');
            if (dto.snapshotHash !== a.snapshotHash)
                throw (0, growth_errors_1.growthError)('CAMPAIGN_LOCKED', 'The approval was reviewed on a different payload: reload it', { snapshotHash: a.snapshotHash });
            const now = new Date();
            if (dto.decision === 'REJECTED') {
                if (!dto.reason?.trim())
                    throw (0, growth_errors_1.growthError)('CAMPAIGN_INVALID', 'A reason is required to reject', { errors: [{ path: '/reason', message: 'Required' }] });
                await this.stamp(tx, a, actor, 'REJECTED', dto.reason, now);
                if (a.kind === 'ACTIVATE' && c.status === 'PENDING_APPROVAL')
                    await this.campaigns.moveLocked(tx, c, actor, 'DRAFT', { reasonCode: 'REJECTED', reason: dto.reason, now });
            }
            else if (a.kind === 'BUDGET_INCREASE') {
                const p = a.snapshot.payload;
                const updated = await tx.growthCampaign.update({ where: { id: c.id }, data: { budgetTotalMinor: p.budgetTotalMinor, budgetDailyMinor: p.budgetDailyMinor, version: { increment: 1 } } });
                if (this.campaigns.hashOf(updated) !== a.snapshotHash)
                    throw (0, growth_errors_1.growthError)('CAMPAIGN_LOCKED', 'The campaign changed since this budget increase was requested: ask again', { currentHash: this.campaigns.hashOf(updated) });
                await tx.growthCampaign.update({ where: { id: c.id }, data: { approvedPayloadHash: a.snapshotHash } });
                const spend = await this.campaigns.approvedSpend(c.id, tx);
                if (updated.status === 'PAUSED' && updated.pauseReason === 'BUDGET' && (0, campaign_guardrails_1.utilisationBp)(spend.approved, p.budgetTotalMinor) < 10_000)
                    await tx.growthCampaign.update({ where: { id: c.id }, data: { pauseReason: 'MANUAL' } });
                await this.stamp(tx, a, actor, 'APPROVED', dto.reason, now);
            }
            else {
                if (this.campaigns.hashOf(c) !== a.snapshotHash)
                    throw (0, growth_errors_1.growthError)('CAMPAIGN_LOCKED', 'The campaign changed since this approval was requested: ask again', { currentHash: this.campaigns.hashOf(c) });
                await tx.growthCampaign.update({ where: { id: c.id }, data: { approvedPayloadHash: a.snapshotHash } });
                await this.stamp(tx, a, actor, 'APPROVED', dto.reason, now);
                if (a.kind === 'ACTIVATE')
                    await this.campaigns.moveLocked(tx, await this.campaigns.must(c.id, tx), actor, 'SCHEDULED', { reasonCode: 'APPROVED', now });
            }
            await this.outbox.enqueue(tx, { type: 'CampaignApprovalDecided', aggregateType: 'GrowthCampaign', aggregateId: c.id, payload: { campaignId: c.id, approvalId: a.id, kind: a.kind, decision: dto.decision, snapshotHash: a.snapshotHash, decidedAt: now.toISOString() }, dedupeKey: `CampaignApprovalDecided:${a.id}` });
            return tx.growthCampaignApproval.findUniqueOrThrow({ where: { id: a.id } });
        });
        if (result.kind === 'BUDGET_INCREASE')
            await this.budget.recompute(result.campaignId);
        return this.present(result);
    }
    async stamp(tx, a, actor, decision, reason, at) {
        await tx.growthCampaignApproval.update({ where: { id: a.id }, data: { decidedBy: actor.sub, decision, decidedAt: at, reason: reason?.slice(0, 300) ?? null } });
        await this.campaigns.audit(tx, actor, `approval.${decision.toLowerCase()}`, a.campaignId, { approvalId: a.id, kind: a.kind, snapshotHash: a.snapshotHash });
    }
    async list(f = {}) {
        const rows = await this.prisma.growthCampaignApproval.findMany({
            where: { ...(f.campaignId ? { campaignId: f.campaignId } : {}), ...(f.status === 'pending' ? { decision: null } : f.status === 'decided' ? { decision: { not: null } } : {}) },
            orderBy: { requestedAt: 'desc' }, take: Math.min(Math.max(f.take ?? 100, 1), 200), include: { campaign: { select: { id: true, key: true, name: true, status: true, market: true, budgetTotalMinor: true, currency: true, channels: true } } },
        });
        return rows.map((r) => ({ ...this.present(r), campaign: r.campaign }));
    }
    async get(id) {
        const r = /^[A-Za-z0-9_-]{1,64}$/.test(id) ? await this.prisma.growthCampaignApproval.findUnique({ where: { id }, include: { campaign: true } }) : null;
        if (!r)
            throw (0, growth_errors_1.growthError)('CAMPAIGN_NOT_FOUND', 'Approval not found');
        return { ...this.present(r), campaign: await this.campaigns.present(r.campaign) };
    }
    present(a) {
        return { id: a.id, campaignId: a.campaignId, kind: a.kind, requestedBy: a.requestedBy, requestedAt: a.requestedAt.toISOString(), decidedBy: a.decidedBy, decidedAt: iso(a.decidedAt), decision: a.decision, reason: a.reason, snapshot: a.snapshot, snapshotHash: a.snapshotHash };
    }
};
exports.CampaignApprovalService = CampaignApprovalService;
exports.CampaignApprovalService = CampaignApprovalService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, campaign_service_1.CampaignService, campaign_budget_service_1.CampaignBudgetService, outbox_public_1.OutboxService])
], CampaignApprovalService);
//# sourceMappingURL=campaign-approval.service.js.map