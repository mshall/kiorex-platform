import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { badRequest, forbidden, notFound } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { GROWTH_DEFAULT_MARKET } from '../growth-flags';
import { validateSpendLine } from '../campaigns/campaign-guardrails';
import { CampaignBudgetService } from '../campaigns/campaign-budget.service';
import { marketTimezone } from '../campaigns/market-day';
import type { CampaignStatus } from '../campaigns/campaign.state';
import { growthError } from '../growth-errors';

export interface SpendInput { day: string; amountMinor: number; campaign?: string; channel?: string; sourceKind?: string; note?: string; market?: string; /** GRW-P2-A: the spend belongs to this campaign (its budget guardrails count it). */ campaignId?: string; /** MANUAL (default) | ADAPTER (read-only integration pull, P2-F); an ADAPTER line is idempotent on (campaignId, day, source, adapterRef). */ source?: 'MANUAL' | 'ADAPTER'; adapterRef?: string }
const TOKEN = /^[A-Za-z0-9_.:-]{0,64}$/;
const SOURCE_KINDS = ['', 'ORGANIC_SEARCH', 'CAMPAIGN', 'REFERRAL', 'WHATSAPP', 'DIRECT', 'PROVIDER_LINK', 'PROVIDER_QR', 'WIDGET', 'OFFLINE'];
const MAX_MINOR = 1_000_000_000; // EGP 10 million per entry, a typo guard

/**
 * Manual marketing spend (GRW-P1-J; KX-32 section 03, "Roadmap: manual entry, integrations later"). Maker-checker: one person enters, a DIFFERENT ops person approves
 * (a database CHECK enforces it too). Only APPROVED entries count in CAC, ROAS and MER. Campaign budgets (Phase 2) will write the same table. No personal data.
 */
@Injectable()
export class GrowthSpendService {
  constructor(private readonly prisma: PrismaService, private readonly moduleRef: ModuleRef) {}

  /** The campaign budget service lives in the campaigns module of the same bounded context; resolved lazily so the two modules never import each other. */
  private budget() { return this.moduleRef.get(CampaignBudgetService, { strict: false }); }

  async create(actor: string, i: SpendInput) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(i.day) || Number.isNaN(Date.parse(i.day))) throw badRequest('INVALID_DAY', 'day must be YYYY-MM-DD');
    if (!Number.isInteger(i.amountMinor) || i.amountMinor <= 0 || i.amountMinor > MAX_MINOR) throw badRequest('INVALID_AMOUNT', 'amountMinor must be a positive whole number of piastres');
    for (const [k, v] of [['campaign', i.campaign ?? ''], ['channel', i.channel ?? '']] as const) if (!TOKEN.test(v)) throw badRequest('INVALID_FIELD', `${k} must be a short token`);
    if (!SOURCE_KINDS.includes(i.sourceKind ?? '')) throw badRequest('INVALID_SOURCE_KIND', 'sourceKind is not a known source kind');
    const note = (i.note ?? '').slice(0, 300);
    if (/[\w.+-]+@[\w-]+\.[\w.]+|\+?\d[\d\s-]{8,}/.test(note)) throw badRequest('INVALID_NOTE', 'the note must not contain contact details');
    let campaign = i.campaign ?? ''; let market = i.market ?? GROWTH_DEFAULT_MARKET; let sourceKind = i.sourceKind ?? '';
    if (i.campaignId) {
      const c = await this.prisma.growthCampaign.findUnique({ where: { id: i.campaignId } });
      if (!c) throw growthError('CAMPAIGN_NOT_FOUND', 'Campaign not found');
      const problems = validateSpendLine({ day: i.day, amountMinor: i.amountMinor }, { startsAt: c.startsAt, status: c.status as CampaignStatus }, new Date(), marketTimezone(c.market));
      if (problems.length) throw growthError('CAMPAIGN_INVALID', 'The spend line is not valid for this campaign', { errors: problems.map((m) => ({ path: '/', message: m })) });
      campaign = c.utmCampaign; market = c.market; sourceKind = 'CAMPAIGN';
    }
    if (i.source === 'ADAPTER' && (!i.adapterRef || !i.campaignId)) throw badRequest('INVALID_FIELD', 'An adapter spend line needs a campaign and an adapterRef');
    let row;
    try {
      row = await this.prisma.growthSpendEntry.create({ data: { market, day: new Date(`${i.day}T00:00:00Z`), amountMinor: i.amountMinor, campaign, channel: i.channel ?? '', sourceKind, note, createdBy: actor, campaignId: i.campaignId ?? null, source: i.source ?? 'MANUAL', adapterRef: i.adapterRef ?? null } });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002' && i.source === 'ADAPTER') return this.present(await this.prisma.growthSpendEntry.findFirstOrThrow({ where: { campaignId: i.campaignId, day: new Date(`${i.day}T00:00:00Z`), source: 'ADAPTER', adapterRef: i.adapterRef } })); // a re-run of the same pull
      throw e;
    }
    await this.prisma.auditLog.create({ data: { actor, action: 'growth.spend.create', resource: 'GrowthSpendEntry', resourceId: row.id, metadata: { day: i.day, amountMinor: i.amountMinor, campaign, channel: i.channel ?? '', campaignId: i.campaignId ?? null } as never } });
    if (row.campaignId) await this.budget().recompute(row.campaignId);
    return this.present(row);
  }

  async decide(actor: string, id: string, decision: 'APPROVE' | 'REJECT') {
    const row = await this.prisma.growthSpendEntry.findUnique({ where: { id } });
    if (!row) throw notFound('SPEND_NOT_FOUND', 'Spend entry not found');
    if (row.createdBy === actor) throw forbidden('MAKER_CHECKER', 'The person who entered a spend line cannot approve it');
    if (row.status !== 'PENDING') throw badRequest('ALREADY_DECIDED', `The entry is already ${row.status}`);
    const r = await this.prisma.growthSpendEntry.updateMany({ where: { id, status: 'PENDING' }, data: { status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', decidedBy: actor, decidedAt: new Date() } });
    if (!r.count) throw badRequest('ALREADY_DECIDED', 'The entry was decided concurrently');
    await this.prisma.auditLog.create({ data: { actor, action: `growth.spend.${decision.toLowerCase()}`, resource: 'GrowthSpendEntry', resourceId: id, metadata: { amountMinor: row.amountMinor, campaignId: row.campaignId } as never } });
    if (row.campaignId) await this.budget().recompute(row.campaignId); // approved spend moves the utilisation, the alerts and the guardrails
    return this.present(await this.prisma.growthSpendEntry.findUniqueOrThrow({ where: { id } }));
  }

  async list(f: { from?: string; to?: string; status?: string; campaignId?: string } = {}) {
    const rows = await this.prisma.growthSpendEntry.findMany({ where: { ...(f.status ? { status: f.status } : {}), ...(f.campaignId ? { campaignId: f.campaignId } : {}), ...(f.from || f.to ? { day: { ...(f.from ? { gte: new Date(`${f.from}T00:00:00Z`) } : {}), ...(f.to ? { lte: new Date(`${f.to}T00:00:00Z`) } : {}) } } : {}) }, orderBy: [{ day: 'desc' }, { createdAt: 'desc' }], take: 200 });
    return rows.map((r) => this.present(r));
  }

  private present(r: { id: string; market: string; day: Date; campaign: string; channel: string; sourceKind: string; amountMinor: number; currency: string; note: string; status: string; createdBy: string; createdAt: Date; decidedBy: string | null; decidedAt: Date | null; campaignId?: string | null; source?: string; adapterRef?: string | null }) {
    return { campaignId: r.campaignId ?? null, source: r.source ?? 'MANUAL', adapterRef: r.adapterRef ?? null, id: r.id, market: r.market, day: r.day.toISOString().slice(0, 10), campaign: r.campaign, channel: r.channel, sourceKind: r.sourceKind, amountMinor: r.amountMinor, currency: r.currency, note: r.note, status: r.status, createdBy: r.createdBy, createdAt: r.createdAt.toISOString(), decidedBy: r.decidedBy, decidedAt: r.decidedAt?.toISOString() ?? null };
  }
}
