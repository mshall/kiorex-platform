import { Injectable, Logger } from '@nestjs/common';
import { ApiError, conflict, forbidden, notFound } from '../../common/errors';
import { FlagsService } from '../../control-plane/control-plane-public';
import { Prisma } from '../../prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AI_RECOMMENDATIONS_FLAG } from '../automation/automation-flags';
import { CampaignService } from '../campaigns/campaign.service';
import { GrowthConfigService } from '../config/growth-config.service';
import { GROWTH_DEFAULT_MARKET } from '../growth-flags';
import { assertAggregateOnly } from './assert-aggregate-only';
import { AiSummaryService, type SummaryMode } from './ai-summary.service';
import { RecommendationInputsService } from './recommendation-inputs.service';
import { runRules } from './recommendation.engine';
import { RECOMMENDATION_KINDS, RECOMMENDATION_POLICY as P, type RuleProposal } from './recommendation.types';

export interface Actor { sub: string; kind: 'USER' | 'SYSTEM'; roles?: string[] }
const SYSTEM: Actor = { sub: 'system:recommendations', kind: 'SYSTEM' };
const DAY = 86_400_000;

/** Where a human continues after approving a kind that has no draft to create. Screens only, never an action. */
const NEXT: Record<string, { screen: string }> = { PAUSE_CAMPAIGN: { screen: '/growth/campaigns' }, CONTENT_SUGGESTION: { screen: '/growth/experiments' }, SEO_GAP: { screen: '/growth/seo' }, LIFECYCLE_HOLDOUT: { screen: '/growth/lifecycle' } };

/**
 * AI-assisted campaign recommendations (GRW-P3-E). ADVISORY: generation reads aggregates, writes PROPOSED rows and nothing else. A human APPROVES or REJECTS; approval creates at most a DRAFT
 * (a DRAFT campaign for a reallocation, a DRAFT LIFECYCLE_POLICY version for a journey holdout result) that still needs its own maker-checker approval. Nothing here activates a campaign,
 * sends a message, spends money, changes a budget or builds an audience, and there is no code path that could: the converter calls `CampaignService.create` (status DRAFT) and
 * `GrowthConfigService.createDraft` only. Expiry 14 days; reviewer feedback is stored for evaluation.
 */
@Injectable()
export class RecommendationService {
  private readonly log = new Logger('recommendations');
  constructor(
    private readonly prisma: PrismaService, private readonly flags: FlagsService, private readonly inputs: RecommendationInputsService, private readonly summary: AiSummaryService,
    private readonly campaigns: CampaignService, private readonly config: GrowthConfigService,
  ) {}

  private audit(actor: Actor, action: string, id: string, metadata: Record<string, unknown>) {
    return this.prisma.auditLog.create({ data: { actor: actor.sub, action: `growth.recommendation.${action}`, resource: 'GrowthRecommendation', resourceId: id, metadata: metadata as Prisma.InputJsonValue } });
  }

  /** The requested summary mode from the environment (default `mock`). */
  requestedMode(): SummaryMode { const m = process.env.RECOMMENDATION_MODEL_MODE; return m === 'rules' || m === 'real' ? m : 'mock'; }

  /** Build proposals from the aggregates of one market. Idempotent: an open proposal with the same fingerprint is kept, not duplicated. */
  async generate(actor: Actor, market = GROWTH_DEFAULT_MARKET, now = new Date()) {
    const inputs = await this.inputs.collect(market, now);
    const { proposals, dropped } = runRules(inputs);
    await this.expireDue(now);
    let created = 0; let existing = 0; let summarised = 0;
    const todaySummaries = await this.prisma.growthRecommendation.count({ where: { market, aiSummary: { not: Prisma.DbNull }, createdAt: { gte: new Date(now.getTime() - DAY) } } });
    const mode = this.requestedMode();
    for (const p of proposals) {
      const open = await this.prisma.growthRecommendation.findFirst({ where: { market, kind: p.kind, fingerprint: p.fingerprint, status: 'PROPOSED' }, select: { id: true } });
      if (open) { existing++; continue; }
      assertAggregateOnly({ payload: p.payload, evidence: p.evidenceRefs });
      let ai = null;
      if (mode !== 'rules' && todaySummaries + summarised < P.maxAiSummariesPerDay) { ai = await this.summary.summarise({ kind: p.kind, payload: p.payload, rationale: p.rationale }, mode, market); if (ai) summarised++; }
      try {
        const row = await this.prisma.growthRecommendation.create({ data: {
          market, kind: p.kind, fingerprint: p.fingerprint, payload: p.payload as Prisma.InputJsonValue, rationale: p.rationale.en, rationaleAr: p.rationale.ar, evidenceRefs: p.evidenceRefs as unknown as Prisma.InputJsonValue,
          confidence: p.confidence, modelMode: ai ? ai.mode : 'rules', aiSummary: ai ? ({ en: ai.en, ar: ai.ar, label: ai.label, model: ai.model } as Prisma.InputJsonValue) : Prisma.DbNull, expiresAt: new Date(now.getTime() + P.expiryDays * DAY),
        } });
        created++;
        await this.audit(actor, 'propose', row.id, { kind: p.kind, fingerprint: p.fingerprint, confidence: p.confidence, modelMode: row.modelMode });
      } catch (e) { if ((e as { code?: string }).code === 'P2002') { existing++; continue; } throw e; }
    }
    return { market, window: inputs.window, considered: proposals.length, created, existing, dropped, mode };
  }

  async expireDue(now = new Date()) {
    const due = await this.prisma.growthRecommendation.findMany({ where: { status: 'PROPOSED', expiresAt: { lte: now } }, select: { id: true } });
    if (!due.length) return 0;
    const r = await this.prisma.growthRecommendation.updateMany({ where: { id: { in: due.map((d) => d.id) }, status: 'PROPOSED' }, data: { status: 'EXPIRED' } });
    for (const d of due) await this.audit(SYSTEM, 'expire', d.id, {});
    return r.count;
  }

  private present(r: Awaited<ReturnType<RecommendationService['must']>>) {
    return {
      id: r.id, market: r.market, kind: r.kind, payload: r.payload, rationale: { en: r.rationale, ar: r.rationaleAr }, evidenceRefs: r.evidenceRefs, confidence: r.confidence, status: r.status, decidedBy: r.decidedBy, decidedAt: r.decidedAt,
      decisionNote: r.decisionNote, convertedRef: r.convertedRef, modelMode: r.modelMode, aiAssisted: !!r.aiSummary, aiSummary: r.aiSummary, feedback: r.feedback, expiresAt: r.expiresAt, createdAt: r.createdAt,
      next: r.status === 'APPROVED' || r.status === 'CONVERTED' ? (r.kind === 'LIFECYCLE_HOLDOUT' && String((r.payload as { journey?: string }).journey).startsWith('auto.') ? { screen: '/growth/automation' } : (NEXT[r.kind] ?? null)) : null,
    };
  }
  private async must(id: string) { const r = await this.prisma.growthRecommendation.findUnique({ where: { id } }); if (!r) throw notFound('RECOMMENDATION_NOT_FOUND', 'No such recommendation'); return r; }

  async list(f: { market?: string; status?: string; kind?: string; take?: number } = {}) {
    await this.expireDue();
    const rows = await this.prisma.growthRecommendation.findMany({ where: { ...(f.market ? { market: f.market } : {}), ...(f.status ? { status: f.status } : {}), ...(f.kind ? { kind: f.kind } : {}) }, orderBy: [{ createdAt: 'desc' }], take: Math.min(f.take ?? 100, 200) });
    return rows.map((r) => this.present(r));
  }
  async get(id: string) { return this.present(await this.must(id)); }

  /** The whole feature is `growth.ai_recommendations` (launch-locked once registered by contracts 1.13.0): OFF answers 403 FEATURE_DISABLED on writes, reads keep working. */
  async assertOn(market: string) {
    const r = await this.flags.evaluate(AI_RECOMMENDATIONS_FLAG, { market });
    if (!r.effective) throw forbidden('FEATURE_DISABLED', 'Feature temporarily unavailable', { key: AI_RECOMMENDATIONS_FLAG, scope: r.scope ?? 'GLOBAL', reason: r.reason });
  }

  async feedback(actor: Actor, id: string, value: unknown) {
    if (value !== 'USEFUL' && value !== 'NOT_USEFUL') throw new ApiError(400, 'RECOMMENDATION_FEEDBACK_INVALID', 'feedback is USEFUL or NOT_USEFUL');
    await this.must(id);
    const r = await this.prisma.growthRecommendation.update({ where: { id }, data: { feedback: value, feedbackBy: actor.sub, feedbackAt: new Date() } });
    await this.audit(actor, 'feedback', id, { value });
    return this.present(r);
  }

  /** APPROVE or REJECT a PROPOSED recommendation. Atomic on the status; approving creates at most a DRAFT (see class doc). The proposer is the system, so any super admin decides. */
  async decide(actor: Actor, id: string, decision: unknown, note: unknown, now = new Date()) {
    if (decision !== 'APPROVE' && decision !== 'REJECT') throw new ApiError(400, 'RECOMMENDATION_DECISION_INVALID', 'decision is APPROVE or REJECT');
    const cur = await this.must(id);
    await this.assertOn(cur.market);
    if (cur.status !== 'PROPOSED') throw conflict('RECOMMENDATION_NOT_PROPOSED', `This recommendation is ${cur.status}`);
    if (cur.expiresAt <= now) { await this.prisma.growthRecommendation.updateMany({ where: { id, status: 'PROPOSED' }, data: { status: 'EXPIRED' } }); throw conflict('RECOMMENDATION_EXPIRED', 'This recommendation has expired'); }
    const text = typeof note === 'string' ? note.trim().slice(0, 300) : '';
    if (decision === 'REJECT' && text.length < 3) throw new ApiError(400, 'RECOMMENDATION_NOTE_REQUIRED', 'A short reason is required to reject');
    const won = await this.prisma.growthRecommendation.updateMany({ where: { id, status: 'PROPOSED' }, data: { status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', decidedBy: actor.sub, decidedAt: now, decisionNote: text || null } });
    if (won.count !== 1) throw conflict('RECOMMENDATION_NOT_PROPOSED', 'Someone else decided this recommendation first');
    await this.audit(actor, decision === 'APPROVE' ? 'approve' : 'reject', id, { kind: cur.kind });
    let conversionError: string | null = null;
    if (decision === 'APPROVE') {
      try { await this.convert(actor, cur); } catch (e) { conversionError = (e as { response?: { code?: string } }).response?.code ?? (e as Error).message.slice(0, 120); this.log.warn(`recommendation ${id} approved, draft not created: ${conversionError}`); await this.audit(actor, 'convert-failed', id, { error: conversionError }); }
    }
    return { ...this.present(await this.must(id)), conversionError };
  }

  /** Approval to DRAFT. Creates a DRAFT campaign or a DRAFT config version, then marks the recommendation CONVERTED with its reference. Every other kind stays APPROVED and points at a screen. */
  private async convert(actor: Actor, r: Awaited<ReturnType<RecommendationService['must']>>) {
    const p = r.payload as Record<string, unknown>;
    let ref: string | null = null;
    if (r.kind === 'REALLOCATE_BUDGET') {
      const toChannel = String(p.toChannel); const shift = Number(p.shiftMinor);
      const c = await this.campaigns.create({ sub: actor.sub, kind: 'USER' }, { key: `rec-${r.id.slice(-10).toLowerCase()}`, name: `Proposed: more on ${toChannel}`, objective: 'ACQUISITION', market: r.market, budgetTotalMinor: Math.max(1, shift), channels: [toChannel] } as never);
      ref = `campaign:${(c as { id: string }).id}`;
    } else if (r.kind === 'LIFECYCLE_HOLDOUT' && p.action === 'DISABLE_JOURNEY' && /^[a-z0-9][a-z0-9_-]{1,47}$/.test(String(p.journey))) { // a builder journey (key with dots) has its own kill switch instead
      const cur = await this.config.resolve<Record<string, unknown>>('LIFECYCLE_POLICY', { market: r.market });
      const payload = JSON.parse(JSON.stringify(cur.payload)) as { journeys?: Record<string, Record<string, unknown>> } & Record<string, unknown>;
      payload.journeys = { ...(payload.journeys ?? {}), [String(p.journey)]: { messageClass: 'MARKETING', ...(payload.journeys?.[String(p.journey)] ?? {}), enabled: false } };
      const v = await this.config.createDraft({ sub: actor.sub, roles: actor.roles?.length ? actor.roles : ['super_admin'] }, { kind: 'LIFECYCLE_POLICY', scope: 'MARKET', scopeId: r.market, payload, reason: `Recommendation ${r.id}: no measured lift for ${String(p.journey)}`, announcement: `Recommendation ${r.id} proposes switching off the journey ${String(p.journey)} (no booking lift against the holdout).` });
      ref = `config:${(v as { id: string }).id}`;
    }
    if (ref) await this.prisma.growthRecommendation.update({ where: { id: r.id }, data: { status: 'CONVERTED', convertedRef: ref } });
    return ref;
  }

  /** For the console: the closed vocabulary and the policy numbers. */
  catalog() { return { kinds: RECOMMENDATION_KINDS, policy: P, mode: this.requestedMode() }; }
}
