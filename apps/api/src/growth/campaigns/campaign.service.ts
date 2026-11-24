import { Injectable, OnModuleInit } from '@nestjs/common';
import { type CampaignState } from '@kiorex/contracts';
import { FlagsService } from '../../control-plane/control-plane-public';
import { OutboxService } from '../../outbox/outbox-public';
import { Prisma, type GrowthCampaign } from '../../prisma/generated/client';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { marketFacts } from '../../market/market-public';
import { GrowthConfigService } from '../config/growth-config.service';
import { growthError } from '../growth-errors';
import { GROWTH_DEFAULT_MARKET, GROWTH_FLAG } from '../growth-flags';
import { validateEligibility } from './campaign-eligibility';
import { approvalRequired, budgetExhausted, budgetIncreaseNeedsApproval, ceilingBreach, utilisationBp, validateAssetRef, validatePlan, type CampaignPolicy } from './campaign-guardrails';
import { moneyHash } from './campaign-hash';
import { evaluateTransition, nextStates, type CampaignStatus, type PauseReason, type TransitionContext } from './campaign.state';
import { trackedLinks, utmCampaignOf, validateUtmConfig, type UtmConfig } from './campaign-utm';
import type { AddCreativeDto, CreateCampaignDto, UpdateCampaignDto } from './campaign-dto';
import { marketTimezone, nextDayBoundary } from './market-day';

export interface Actor { sub: string; kind: 'USER' | 'SYSTEM' }
export const SYSTEM = (name: string): Actor => ({ sub: `system:${name}`, kind: 'SYSTEM' });
export const CAMPAIGN_EVENTS = ['CampaignCreated', 'CampaignStatusChanged', 'CampaignBudgetThresholdReached', 'CampaignApprovalDecided'] as const;
const site = () => process.env.SITE_CANONICAL_HOST?.replace(/\/+$/, '') || 'https://kiorex.com';
const iso = (d: Date | null) => (d ? d.toISOString() : null);

export interface TransitionOptions { reasonCode?: string; reason?: string; pauseReason?: PauseReason; pausedUntil?: Date | null; now?: Date; tx?: Tx; skipCeiling?: boolean }

/**
 * Campaign management (GRW-P2-A, ADR-041..047 PROPOSED; AD-1). A campaign is a PLAN: channels, budgets, UTM, eligibility, landing page and creative REFERENCES. Nothing here creates,
 * edits or spends on an external ad platform; spend arrives as maker-checker entries and, later, read-only adapters (P2-F). Every state change goes through `transition`, which
 * serialises on the row (SELECT ... FOR UPDATE), checks the pure state machine, appends the history row, the audit row and the outbox event in one transaction.
 */
@Injectable()
export class CampaignService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService, private readonly config: GrowthConfigService, private readonly flags: FlagsService, private readonly outbox: OutboxService) {}

  /** Internal events have no consumer yet (reports read the tables); a no-op handler keeps the outbox clean instead of dead-lettering them. */
  onModuleInit() { for (const t of CAMPAIGN_EVENTS) this.outbox.register(t, async () => undefined); }

  // ───────────────────────── policy and facts ─────────────────────────
  async policy(market: string, at?: Date): Promise<{ payload: CampaignPolicy; versionId: string }> {
    const r = await this.config.resolve<CampaignPolicy>('CAMPAIGN_POLICY', { market, at });
    return { payload: r.payload, versionId: r.versionId };
  }
  approvalFlagOn(market: string) { return this.flags.isEnabled(GROWTH_FLAG.CAMPAIGN_APPROVAL_REQUIRED, { market }).catch(() => true); }
  moneyOf(c: GrowthCampaign) { return { budgetTotalMinor: c.budgetTotalMinor, budgetDailyMinor: c.budgetDailyMinor, currency: c.currency, channels: c.channels, startsAt: c.startsAt, endsAt: c.endsAt, eligibility: c.eligibility }; }
  hashOf(c: GrowthCampaign) { return moneyHash(this.moneyOf(c)); }
  approvalCurrent(c: GrowthCampaign) { return !!c.approvedPayloadHash && c.approvedPayloadHash === this.hashOf(c); }

  async approvedSpend(campaignId: string, client: Tx | PrismaService = this.prisma) {
    const g = await client.growthSpendEntry.groupBy({ by: ['status'], where: { campaignId }, _sum: { amountMinor: true } });
    const by = Object.fromEntries(g.map((r) => [r.status, r._sum.amountMinor ?? 0]));
    return { approved: by.APPROVED ?? 0, pending: by.PENDING ?? 0 };
  }

  // ───────────────────────── create, read, update ─────────────────────────
  async create(actor: Actor, dto: CreateCampaignDto) {
    const market = dto.market ?? GROWTH_DEFAULT_MARKET;
    const { payload: policy, versionId } = await this.policy(market);
    const currency = marketFacts(market).currency;
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : null; const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    const daily = dto.budgetDailyMinor ?? Math.min(dto.budgetTotalMinor, policy.dailyDefaultCapMinor);
    const errors = validatePlan({ budgetTotalMinor: dto.budgetTotalMinor, budgetDailyMinor: daily, currency, channels: dto.channels, startsAt, endsAt }, policy, currency);
    const elig = validateEligibility(dto.eligibility ?? {}); if (!elig.valid) errors.push(...elig.errors.map((m) => ({ path: '/eligibility', message: m })));
    const utm = validateUtmConfig(dto.utmConfig ?? {}, policy.utmNaming.maxTokenLength); if (!utm.valid) errors.push(...utm.errors.map((m) => ({ path: '/utmConfig', message: m })));
    if (errors.length) throw growthError('CAMPAIGN_INVALID', 'The campaign is not valid', { errors });
    if (dto.landingPageId) await this.assertLandingPage(dto.landingPageId, market);
    const utmCampaign = utmCampaignOf(market, dto.key);
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.growthCampaign.create({ data: { market, key: dto.key, utmCampaign, name: dto.name.trim(), objective: dto.objective, budgetTotalMinor: dto.budgetTotalMinor, budgetDailyMinor: daily, currency, channels: [...new Set(dto.channels)], startsAt, endsAt, eligibility: (elig as { value: object }).value as Prisma.InputJsonValue, utmConfig: (utm as { value: object }).value as Prisma.InputJsonValue, landingPageId: dto.landingPageId ?? null, policyVersionId: versionId, ownerSub: actor.sub } });
        await this.audit(tx, actor, 'create', created.id, { key: created.key, market, budgetTotalMinor: created.budgetTotalMinor });
        await this.outbox.enqueue(tx, { type: 'CampaignCreated', aggregateType: 'GrowthCampaign', aggregateId: created.id, payload: { campaignId: created.id, market, key: created.key, objective: created.objective, channels: created.channels, budgetTotalMinor: created.budgetTotalMinor, currency, createdAt: created.createdAt.toISOString() }, dedupeKey: `CampaignCreated:${created.id}` });
        return created;
      });
      return this.present(row);
    } catch (e) { if ((e as { code?: string }).code === 'P2002') throw growthError('CAMPAIGN_KEY_TAKEN', 'A campaign with this key already exists in this market'); throw e; }
  }

  async list(f: { market?: string; status?: string; q?: string; objective?: string; promotional?: boolean; take?: number } = {}) {
    const rows = await this.prisma.growthCampaign.findMany({
      where: { market: f.market ?? GROWTH_DEFAULT_MARKET, ...(f.status ? { status: f.status } : {}), ...(f.objective ? { objective: f.objective } : {}), ...(f.promotional ? { objective: 'PROMOTION' } : {}), ...(f.q ? { OR: [{ name: { contains: f.q, mode: 'insensitive' } }, { key: { contains: f.q.toLowerCase() } }] } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: Math.min(Math.max(f.take ?? 100, 1), 200),
    });
    const spend = await this.prisma.growthSpendEntry.groupBy({ by: ['campaignId'], where: { campaignId: { in: rows.map((r) => r.id) }, status: 'APPROVED' }, _sum: { amountMinor: true } });
    const m = new Map(spend.map((s) => [s.campaignId as string, s._sum.amountMinor ?? 0]));
    return rows.map((r) => ({ ...this.brief(r), approvedSpendMinor: m.get(r.id) ?? 0, utilisationBp: utilisationBp(m.get(r.id) ?? 0, r.budgetTotalMinor) }));
  }

  async must(id: string, client: Tx | PrismaService = this.prisma): Promise<GrowthCampaign> {
    const row = typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? await client.growthCampaign.findUnique({ where: { id } }) : null;
    if (!row) throw growthError('CAMPAIGN_NOT_FOUND', 'Campaign not found');
    return row;
  }
  async get(id: string, now = new Date()) { return this.present(await this.must(id), now); }

  async update(actor: Actor, id: string, dto: UpdateCampaignDto) {
    return this.prisma.$transaction(async (tx) => {
      const c = await this.lock(tx, id);
      if (c.version !== dto.version) throw growthError('CAMPAIGN_LOCKED', 'The campaign was changed by someone else: reload and try again', { currentVersion: c.version });
      if (['PENDING_APPROVAL', 'COMPLETED', 'ARCHIVED'].includes(c.status)) throw growthError('CAMPAIGN_LOCKED', `A ${c.status} campaign cannot be edited${c.status === 'PENDING_APPROVAL' ? ': send it back to draft first' : ''}`);
      const { payload: policy } = await this.policy(c.market);
      const startsAt = dto.startsAt !== undefined ? new Date(dto.startsAt) : c.startsAt; const endsAt = dto.endsAt !== undefined ? new Date(dto.endsAt) : c.endsAt;
      const channels = dto.channels ? [...new Set(dto.channels)] : c.channels;
      const total = dto.budgetTotalMinor ?? c.budgetTotalMinor; const daily = dto.budgetDailyMinor ?? (dto.budgetTotalMinor !== undefined ? Math.min(c.budgetDailyMinor, total) : c.budgetDailyMinor);
      const running = c.status === 'ACTIVE' || c.status === 'PAUSED';
      const errors = validatePlan({ budgetTotalMinor: total, budgetDailyMinor: daily, currency: c.currency, channels, startsAt, endsAt }, policy, marketFacts(c.market).currency);
      let elig: Record<string, unknown> = c.eligibility as Record<string, unknown>;
      if (dto.eligibility !== undefined) { const v = validateEligibility(dto.eligibility); if (!v.valid) errors.push(...v.errors.map((m) => ({ path: '/eligibility', message: m }))); else elig = v.value as Record<string, unknown>; }
      let utm: Record<string, unknown> = c.utmConfig as Record<string, unknown>;
      if (dto.utmConfig !== undefined) {
        if (c.activatedAt) errors.push({ path: '/utmConfig', message: 'The tracking configuration is fixed once the campaign has been active (links are already out)' });
        else { const v = validateUtmConfig(dto.utmConfig, policy.utmNaming.maxTokenLength); if (!v.valid) errors.push(...v.errors.map((m) => ({ path: '/utmConfig', message: m }))); else utm = v.value as Record<string, unknown>; }
      }
      if (errors.length) throw growthError('CAMPAIGN_INVALID', 'The campaign is not valid', { errors });
      if (dto.landingPageId) await this.assertLandingPage(dto.landingPageId, c.market);
      const spend = await this.approvedSpend(c.id, tx);
      if (total < spend.approved) throw growthError('CAMPAIGN_INVALID', 'The total budget cannot be below the spend already approved', { errors: [{ path: '/budgetTotalMinor', message: `Approved spend is ${spend.approved}` }] });
      // a running campaign's budget can only go UP through a BUDGET_INCREASE approval when the increase is above the policy percentage
      if (running && budgetIncreaseNeedsApproval(c.budgetTotalMinor, total, policy)) throw growthError('CAMPAIGN_APPROVAL_REQUIRED', 'A budget increase this large needs a second approver: request a BUDGET_INCREASE approval', { kind: 'BUDGET_INCREASE' });
      const next = { budgetTotalMinor: total, budgetDailyMinor: daily, channels, startsAt, endsAt, eligibility: elig };
      const moneyChanged = this.hashOf(c) !== this.hashOf({ ...c, ...next } as GrowthCampaign);
      const needsApproval = approvalRequired({ budgetTotalMinor: total, channels }, policy, await this.approvalFlagOn(c.market)).required;
      const data: Prisma.GrowthCampaignUpdateInput = {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}), ...(dto.objective ? { objective: dto.objective } : {}), ...(dto.landingPageId !== undefined ? { landingPageId: dto.landingPageId } : {}),
        budgetTotalMinor: total, budgetDailyMinor: daily, channels, startsAt, endsAt, eligibility: elig as Prisma.InputJsonValue, utmConfig: utm as Prisma.InputJsonValue, version: { increment: 1 },
        ...(endsAt && c.status === 'SCHEDULED' ? { autoExpiresAt: new Date(endsAt.getTime() + policy.autoExpiryGraceHours * 3600_000) } : {}),
      };
      // an edit of the money-relevant fields invalidates the approval (the hash no longer matches); a SCHEDULED campaign that needs approval goes back to DRAFT
      const after = { ...c, ...next } as GrowthCampaign;
      if (moneyChanged && c.approvedPayloadHash && this.hashOf(after) !== c.approvedPayloadHash) data.approvedPayloadHash = null;
      const row = await tx.growthCampaign.update({ where: { id }, data });
      await this.audit(tx, actor, 'update', id, { fields: Object.keys(dto).filter((k) => k !== 'version'), moneyChanged });
      if (moneyChanged && c.status === 'SCHEDULED' && needsApproval) await this.moveLocked(tx, row, actor, 'DRAFT', { reasonCode: 'EDITED_AFTER_APPROVAL', reason: 'Money-relevant fields changed after approval' });
      return this.present(await this.must(id, tx));
    });
  }

  // ───────────────────────── creatives ─────────────────────────
  async addCreative(actor: Actor, id: string, dto: AddCreativeDto) {
    const c = await this.must(id);
    if (['COMPLETED', 'ARCHIVED'].includes(c.status)) throw growthError('CAMPAIGN_LOCKED', `A ${c.status} campaign cannot take new creatives`);
    const { payload: policy } = await this.policy(c.market);
    const problem = validateAssetRef(dto.assetRef, c.market, c.id, policy); if (problem) throw growthError('CAMPAIGN_INVALID', 'The creative reference is not accepted', { errors: [{ path: '/assetRef', message: problem }] });
    const count = await this.prisma.growthCampaignCreative.count({ where: { campaignId: id, status: { not: 'RETIRED' } } });
    if (count >= policy.creativeRules.maxCreatives) throw growthError('CAMPAIGN_INVALID', `A campaign has at most ${policy.creativeRules.maxCreatives} creatives`, { errors: [{ path: '/', message: 'Too many creatives' }] });
    const row = await this.prisma.$transaction(async (tx) => {
      const r = await tx.growthCampaignCreative.create({ data: { campaignId: id, kind: dto.kind, assetRef: dto.assetRef, locale: dto.locale ?? 'ar', checksum: dto.checksum ?? null, createdBy: actor.sub } });
      await this.audit(tx, actor, 'creative.add', id, { creativeId: r.id, kind: r.kind });
      return r;
    });
    return { id: row.id, campaignId: row.campaignId, kind: row.kind, assetRef: row.assetRef, locale: row.locale, status: row.status, checksum: row.checksum, createdBy: row.createdBy, createdAt: row.createdAt.toISOString() };
  }
  async creatives(id: string) {
    await this.must(id);
    return (await this.prisma.growthCampaignCreative.findMany({ where: { campaignId: id }, orderBy: { createdAt: 'asc' } })).map((r) => ({ id: r.id, kind: r.kind, assetRef: r.assetRef, locale: r.locale, status: r.status, checksum: r.checksum, createdBy: r.createdBy, createdAt: r.createdAt.toISOString() }));
  }
  async history(id: string) {
    await this.must(id);
    return (await this.prisma.growthCampaignStatusHistory.findMany({ where: { campaignId: id }, orderBy: [{ at: 'asc' }, { id: 'asc' }] })).map((h) => ({ id: h.id, from: h.from, to: h.to, actor: h.actor, reasonCode: h.reasonCode, at: h.at.toISOString() }));
  }

  // ───────────────────────── transitions ─────────────────────────
  async transition(actor: Actor, id: string, to: string, o: TransitionOptions = {}) {
    const run = async (tx: Tx) => { const c = await this.lock(tx, id); return this.moveLocked(tx, c, actor, to as CampaignStatus, o); };
    const row = o.tx ? await run(o.tx) : await this.prisma.$transaction(run);
    return this.present(row, o.now);
  }

  /** Row lock: two instances (or the scheduler and an ops user) can never run two transitions of one campaign at once. */
  async lock(tx: Tx, id: string): Promise<GrowthCampaign> {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw growthError('CAMPAIGN_NOT_FOUND', 'Campaign not found');
    const r = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "GrowthCampaign" WHERE "id" = ${id} FOR UPDATE`);
    if (!r.length) throw growthError('CAMPAIGN_NOT_FOUND', 'Campaign not found');
    return this.must(id, tx);
  }

  async contextFor(tx: Tx, c: GrowthCampaign, actor: Actor, o: TransitionOptions): Promise<TransitionContext & { policy: CampaignPolicy }> {
    const now = o.now ?? new Date(); const { payload: policy } = await this.policy(c.market);
    const spend = await this.approvedSpend(c.id, tx);
    const need = approvalRequired({ budgetTotalMinor: c.budgetTotalMinor, channels: c.channels }, policy, await this.approvalFlagOn(c.market));
    return { now, startsAt: c.startsAt, endsAt: c.endsAt, approvalRequired: need.required, approvalCurrent: this.approvalCurrent(c), pauseReason: (c.pauseReason as PauseReason | null) ?? null, budgetExhausted: budgetExhausted(spend.approved, c.budgetTotalMinor), dailyPauseActive: !!c.pausedUntil && c.pausedUntil.getTime() > now.getTime(), hasReason: !!(o.reasonCode || o.reason), actorKind: actor.kind, requireReasonOnPause: policy.requireReasonOnPause, policy };
  }

  async moveLocked(tx: Tx, c: GrowthCampaign, actor: Actor, to: CampaignStatus, o: TransitionOptions = {}): Promise<GrowthCampaign> {
    const now = o.now ?? new Date(); const from = c.status as CampaignStatus;
    const ctx = await this.contextFor(tx, c, actor, { ...o, now });
    const v = evaluateTransition(from, to, ctx);
    if (!v.ok) throw growthError(v.code, v.message, { from, to });
    // entering the counted set (SCHEDULED or ACTIVE) from outside it is refused when the month's ceiling would be exceeded
    const entering = (to === 'SCHEDULED' && from !== 'SCHEDULED') || (to === 'ACTIVE' && from === 'PAUSED');
    if (entering && !o.skipCeiling) {
      const others = await tx.growthCampaign.findMany({ where: { market: c.market, id: { not: c.id }, status: { in: ['ACTIVE', 'SCHEDULED'] } }, select: { status: true, budgetTotalMinor: true, startsAt: true, endsAt: true } });
      const breach = ceilingBreach(c, others.map((x) => ({ ...x, status: x.status as CampaignStatus })), ctx.policy, marketTimezone(c.market));
      if (breach) throw growthError('CAMPAIGN_CEILING_EXCEEDED', `The monthly ceiling for ${breach.month} would be exceeded (${breach.plannedMinor} planned, ceiling ${breach.ceilingMinor})`, breach);
    }
    const reasonCode = o.reasonCode ?? (o.pauseReason ? o.pauseReason : 'MANUAL');
    const data: Prisma.GrowthCampaignUpdateInput = { status: to, statusReason: reasonCode, version: { increment: 1 } };
    if (to === 'SCHEDULED') data.autoExpiresAt = c.endsAt ? new Date(c.endsAt.getTime() + ctx.policy.autoExpiryGraceHours * 3600_000) : null;
    if (to === 'ACTIVE') { data.pauseReason = null; data.pausedUntil = null; if (!c.activatedAt) data.activatedAt = now; }
    if (to === 'PAUSED') { data.pauseReason = o.pauseReason ?? 'MANUAL'; data.pausedUntil = o.pauseReason === 'GUARDRAIL' ? (o.pausedUntil ?? nextDayBoundary(now, marketTimezone(c.market))) : null; }
    if (to === 'COMPLETED') { data.completedAt = now; data.pauseReason = null; data.pausedUntil = null; }
    if (to === 'ARCHIVED') data.archivedAt = now;
    if (to === 'DRAFT') data.approvedPayloadHash = null;
    const row = await tx.growthCampaign.update({ where: { id: c.id }, data });
    await tx.growthCampaignStatusHistory.create({ data: { campaignId: c.id, from, to, actor: actor.sub, reasonCode, at: now } });
    await this.audit(tx, actor, `transition.${to.toLowerCase()}`, c.id, { from, to, reasonCode });
    await this.outbox.enqueue(tx, { type: 'CampaignStatusChanged', aggregateType: 'GrowthCampaign', aggregateId: c.id, payload: { campaignId: c.id, market: c.market, from, to, reasonCode, actorKind: actor.kind, at: now.toISOString() }, dedupeKey: `CampaignStatusChanged:${c.id}:${row.version}` });
    return row;
  }

  // ───────────────────────── helpers ─────────────────────────
  async audit(tx: Tx | PrismaService, actor: Actor, action: string, id: string, metadata: Record<string, unknown>) {
    await tx.auditLog.create({ data: { actor: actor.sub, action: `growth.campaign.${action}`, resource: 'GrowthCampaign', resourceId: id, metadata: metadata as Prisma.InputJsonValue } });
  }
  private async assertLandingPage(id: string, market: string) {
    const p = await this.prisma.growthLandingPage.findFirst({ where: { id, market }, select: { id: true } });
    if (!p) throw growthError('CAMPAIGN_INVALID', 'The landing page does not exist in this market', { errors: [{ path: '/landingPageId', message: 'Unknown landing page' }] });
  }

  brief(c: GrowthCampaign) {
    return { id: c.id, market: c.market, key: c.key, utmCampaign: c.utmCampaign, name: c.name, objective: c.objective, status: c.status as CampaignStatus, channels: c.channels, budgetTotalMinor: c.budgetTotalMinor, budgetDailyMinor: c.budgetDailyMinor, currency: c.currency, startsAt: iso(c.startsAt), endsAt: iso(c.endsAt), ownerSub: c.ownerSub, pauseReason: c.pauseReason, version: c.version, createdAt: c.createdAt.toISOString() };
  }

  /** The full read model: the campaign, its tracking links, the approval state, the budget figures and which transitions are possible right now (with the reason when not). */
  async present(c: GrowthCampaign, now = new Date()) {
    const { payload: policy } = await this.policy(c.market);
    const spend = await this.approvedSpend(c.id);
    const flagOn = await this.approvalFlagOn(c.market);
    const need = approvalRequired({ budgetTotalMinor: c.budgetTotalMinor, channels: c.channels }, policy, flagOn);
    const approvals = await this.prisma.growthCampaignApproval.findMany({ where: { campaignId: c.id }, orderBy: { requestedAt: 'desc' }, take: 20 });
    const links = trackedLinks({ market: c.market, key: c.key, channels: c.channels, config: c.utmConfig as UtmConfig, host: site() });
    const ctxBase = { now, startsAt: c.startsAt, endsAt: c.endsAt, approvalRequired: need.required, approvalCurrent: this.approvalCurrent(c), pauseReason: (c.pauseReason as PauseReason | null) ?? null, budgetExhausted: budgetExhausted(spend.approved, c.budgetTotalMinor), dailyPauseActive: !!c.pausedUntil && c.pausedUntil.getTime() > now.getTime(), hasReason: true, actorKind: 'USER' as const, requireReasonOnPause: policy.requireReasonOnPause };
    const actions = nextStates(c.status as CampaignStatus).map((to) => { const v = evaluateTransition(c.status as CampaignStatus, to as CampaignState, ctxBase); return { to, allowed: v.ok, ...(v.ok ? {} : { code: v.code, message: v.message }) }; });
    return {
      ...this.brief(c), eligibility: c.eligibility, utmConfig: c.utmConfig, landingPageId: c.landingPageId, policyVersionId: c.policyVersionId, activatedAt: iso(c.activatedAt), completedAt: iso(c.completedAt), archivedAt: iso(c.archivedAt),
      autoExpiresAt: iso(c.autoExpiresAt), pausedUntil: iso(c.pausedUntil), statusReason: c.statusReason, thresholdsFiredBp: c.thresholdsFiredBp, links,
      approval: { required: need.required, reasons: need.reasons, current: this.approvalCurrent(c), payloadHash: this.hashOf(c), pending: approvals.filter((a) => !a.decision).map((a) => ({ id: a.id, kind: a.kind, requestedBy: a.requestedBy, requestedAt: a.requestedAt.toISOString() })) },
      budget: { approvedSpendMinor: spend.approved, pendingSpendMinor: spend.pending, utilisationBp: utilisationBp(spend.approved, c.budgetTotalMinor), remainingMinor: Math.max(0, c.budgetTotalMinor - spend.approved) },
      actions,
    };
  }
}
