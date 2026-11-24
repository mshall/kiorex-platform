import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { ApiError, conflict, forbidden, notFound } from '../../common/errors';
import { FlagsService } from '../../control-plane/control-plane-public';
import { OutboxService } from '../../outbox/outbox-public';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '../../prisma/generated/client';
import { GROWTH_DEFAULT_MARKET, GROWTH_FLAG } from '../growth-flags';
import { type ExperimentDraft, parseDraft, plannedSample } from './experiment-dto';
import { EXPERIMENT_POLICY, metricByKey } from './experiment.types';
import { assertFlagKeyAllowed, assertSurfaceAllowed } from './surfaces';
import { safetyTokens } from './safety-tokens';

export interface Actor { sub: string; kind: 'USER' | 'SYSTEM' }
type Tx = Prisma.TransactionClient;
export const EXPERIMENT_EVENTS = ['ExperimentStarted', 'ExperimentStopped', 'ExperimentConcluded', 'ExperimentSrmDetected', 'ExperimentShipRequested'] as const;

/**
 * Experiment lifecycle (GRW-P3-A). DRAFT -> PENDING_APPROVAL (submit) -> RUNNING (a DIFFERENT super admin approves and starts) -> STOPPED | CONCLUDED -> ARCHIVED.
 * Every transition appends a GrowthExperimentEvent and an audit row in the same transaction; the database freezes the design once started and refuses a self-approval (CHECK).
 * An experiment never changes money, commission, attribution or a safety surface: surface and flag key are checked against the closed allowlist and the shared safety file before a row exists.
 */
@Injectable()
export class ExperimentService implements OnModuleInit {
  private readonly log = new Logger('experiments');
  constructor(private readonly prisma: PrismaService, private readonly flags: FlagsService, private readonly outbox: OutboxService) {}
  onModuleInit() { for (const t of EXPERIMENT_EVENTS) this.outbox.register(t, async () => undefined); }

  private async must(id: string, tx: Tx | PrismaService = this.prisma) { const e = await tx.growthExperiment.findUnique({ where: { id } }); if (!e) throw notFound('EXPERIMENT_NOT_FOUND', 'Experiment not found'); return e; }
  private async event(tx: Tx, id: string, kind: string, actor: string, reason?: string | null, diff: Record<string, unknown> = {}) { await tx.growthExperimentEvent.create({ data: { experimentId: id, kind, actor, reason: reason ?? null, diff: diff as Prisma.InputJsonValue } }); }
  private async audit(tx: Tx, actor: string, action: string, id: string, metadata: Record<string, unknown>) { await tx.auditLog.create({ data: { actor, action: `growth.experiment.${action}`, resource: 'GrowthExperiment', resourceId: id, metadata: metadata as Prisma.InputJsonValue } }); }

  private checkDesign(d: Partial<ExperimentDraft>) {
    const tokens = safetyTokens();
    if (d.surface !== undefined) {
      const s = assertSurfaceAllowed(d.surface, [], tokens);
      if (d.primaryMetric) { const m = metricByKey(d.primaryMetric)!; if (m.unit === 'BOOKING' && !s.units.includes('SUB') && !s.units.includes('VISITOR')) throw new ApiError(400, 'EXPERIMENT_INVALID', 'primary metric does not fit the surface'); }
      if (d.eligibility?.platforms?.some((p) => !s.platforms.includes(p))) throw new ApiError(400, 'EXPERIMENT_INVALID', `surface ${s.key} is not on every platform you selected`);
    }
    if (d.flagKey) assertFlagKeyAllowed(d.flagKey, tokens);
  }

  async create(actor: Actor, body: unknown) {
    const d = parseDraft(body) as ExperimentDraft; this.checkDesign(d);
    const market = d.market ?? GROWTH_DEFAULT_MARKET;
    const exists = await this.prisma.growthExperiment.findUnique({ where: { market_key: { market, key: d.key } } });
    if (exists) throw conflict('EXPERIMENT_KEY_TAKEN', 'An experiment with this key already exists in this market');
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.growthExperiment.create({ data: {
        market, key: d.key, name: d.name, surface: d.surface, hypothesis: d.hypothesis, variants: d.variants as unknown as Prisma.InputJsonValue, allocationBp: d.allocationBp ?? 10000, eligibility: (d.eligibility ?? {}) as Prisma.InputJsonValue,
        primaryMetric: d.primaryMetric, guardrails: (d.guardrails ?? []) as unknown as Prisma.InputJsonValue, mode: d.mode ?? 'FIXED', alphaBp: d.alphaBp ?? 500, minSample: plannedSample(d), plannedDays: d.plannedDays ?? 14,
        salt: randomBytes(16).toString('hex'), createdBy: actor.sub, flagKey: d.flagKey ?? null,
      } });
      await this.event(tx, row.id, 'CREATED', actor.sub, null, { key: row.key, surface: row.surface, variants: d.variants, allocationBp: row.allocationBp, primaryMetric: row.primaryMetric, mode: row.mode, minSample: row.minSample });
      await this.audit(tx, actor.sub, 'create', row.id, { key: row.key, surface: row.surface });
      return row;
    });
  }

  async update(actor: Actor, id: string, body: unknown) {
    const cur = await this.must(id);
    if (cur.status !== 'DRAFT') throw conflict('EXPERIMENT_NOT_EDITABLE', `A ${cur.status} experiment cannot be edited (design is frozen once submitted)`);
    const d = parseDraft(body, true); if ('key' in d && d.key !== cur.key) throw new ApiError(400, 'EXPERIMENT_INVALID', 'key cannot change');
    this.checkDesign({ ...d, surface: d.surface ?? cur.surface, primaryMetric: d.primaryMetric ?? cur.primaryMetric });
    const diff: Record<string, unknown> = {};
    const data: Prisma.GrowthExperimentUpdateInput = {};
    for (const k of ['name', 'surface', 'hypothesis', 'allocationBp', 'primaryMetric', 'mode', 'alphaBp', 'plannedDays', 'flagKey'] as const) if (d[k] !== undefined) { (data as Record<string, unknown>)[k] = d[k]; diff[k] = { from: (cur as Record<string, unknown>)[k], to: d[k] }; }
    if (d.variants) { data.variants = d.variants as unknown as Prisma.InputJsonValue; diff.variants = { from: cur.variants, to: d.variants }; }
    if (d.eligibility) { data.eligibility = d.eligibility as Prisma.InputJsonValue; diff.eligibility = { from: cur.eligibility, to: d.eligibility }; }
    if (d.guardrails) { data.guardrails = d.guardrails as unknown as Prisma.InputJsonValue; diff.guardrails = { from: cur.guardrails, to: d.guardrails }; }
    if (d.minSample !== undefined || (d.baselineRate && d.mdeAbs)) { data.minSample = plannedSample({ ...d, alphaBp: d.alphaBp ?? cur.alphaBp }); diff.minSample = { from: cur.minSample, to: data.minSample }; }
    return this.prisma.$transaction(async (tx) => { const row = await tx.growthExperiment.update({ where: { id }, data }); await this.event(tx, id, 'EDITED', actor.sub, null, diff); await this.audit(tx, actor.sub, 'update', id, { fields: Object.keys(diff) }); return row; });
  }

  async submit(actor: Actor, id: string) {
    const cur = await this.must(id);
    if (cur.status !== 'DRAFT') throw conflict('EXPERIMENT_INVALID_TRANSITION', `Only a DRAFT can be submitted (this one is ${cur.status})`);
    this.checkDesign({ surface: cur.surface, flagKey: cur.flagKey ?? undefined });
    return this.prisma.$transaction(async (tx) => { const row = await tx.growthExperiment.update({ where: { id }, data: { status: 'PENDING_APPROVAL' } }); await this.event(tx, id, 'SUBMITTED', actor.sub); await this.audit(tx, actor.sub, 'submit', id, {}); return row; });
  }

  /** A different person approves AND starts. Serialised per (market, surface) with an advisory lock so two starts cannot both pass the concurrency check. */
  async approveAndStart(actor: Actor, id: string, now = new Date()) {
    const cur = await this.must(id);
    if (cur.status !== 'PENDING_APPROVAL') throw conflict('EXPERIMENT_INVALID_TRANSITION', `Only a PENDING_APPROVAL experiment can be started (this one is ${cur.status})`);
    if (cur.createdBy === actor.sub) throw forbidden('SECOND_APPROVER_REQUIRED', 'Two-person rule: the author of an experiment cannot approve it');
    if (!(await this.flags.isEnabled(GROWTH_FLAG.EXPERIMENTS, { market: cur.market }))) throw forbidden('FEATURE_DISABLED', 'growth.experiments is OFF', { key: GROWTH_FLAG.EXPERIMENTS });
    this.checkDesign({ surface: cur.surface, flagKey: cur.flagKey ?? undefined });
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`exp:${cur.market}:${cur.surface}`}))`;
      const running = await tx.growthExperiment.count({ where: { market: cur.market, surface: cur.surface, status: 'RUNNING' } });
      if (running >= EXPERIMENT_POLICY.maxConcurrentPerSurface) throw conflict('EXPERIMENT_SURFACE_BUSY', 'Another experiment is already running on this surface in this market', { surface: cur.surface });
      const r = await tx.growthExperiment.update({ where: { id }, data: { status: 'RUNNING', approvedBy: actor.sub, startedAt: now } });
      await this.event(tx, id, 'APPROVED', actor.sub); await this.event(tx, id, 'STARTED', actor.sub, null, { startedAt: now.toISOString(), allocationBp: cur.allocationBp, variants: cur.variants });
      await this.audit(tx, actor.sub, 'start', id, { surface: cur.surface });
      await this.outbox.enqueue(tx, { type: 'ExperimentStarted', aggregateType: 'GrowthExperiment', aggregateId: id, payload: { experimentId: id, market: cur.market, key: cur.key, surface: cur.surface, at: now.toISOString() }, dedupeKey: `ExperimentStarted:${id}` });
      return r;
    });
    return row;
  }

  /** Stopping reverts every unit to control at once: assignment checks the status on every call. */
  async stop(actor: Actor, id: string, reason: string, now = new Date(), kind: 'MANUAL' | 'SYSTEM' = 'MANUAL') {
    if (typeof reason !== 'string' || reason.trim().length < 3) throw new ApiError(400, 'EXPERIMENT_INVALID', 'A stop reason of at least 3 characters is required');
    return this.prisma.$transaction(async (tx) => {
      const cur = await this.must(id, tx);
      if (cur.status !== 'RUNNING') throw conflict('EXPERIMENT_INVALID_TRANSITION', `Only a RUNNING experiment can be stopped (this one is ${cur.status})`);
      const row = await tx.growthExperiment.update({ where: { id }, data: { status: 'STOPPED', stoppedAt: now, stopReason: reason.trim().slice(0, 200) } });
      await this.event(tx, id, 'STOPPED', actor.sub, reason.trim().slice(0, 200), { by: kind });
      await this.audit(tx, actor.sub, 'stop', id, { reason: reason.slice(0, 200), by: kind });
      await this.outbox.enqueue(tx, { type: 'ExperimentStopped', aggregateType: 'GrowthExperiment', aggregateId: id, payload: { experimentId: id, market: cur.market, key: cur.key, reason: reason.slice(0, 200), by: kind, at: now.toISOString() }, dedupeKey: `ExperimentStopped:${id}` });
      return row;
    });
  }

  async conclude(actor: Actor, id: string, verdict: string, now = new Date()) {
    return this.prisma.$transaction(async (tx) => {
      const cur = await this.must(id, tx);
      if (cur.status !== 'RUNNING') throw conflict('EXPERIMENT_INVALID_TRANSITION', `Only a RUNNING experiment can be concluded (this one is ${cur.status})`);
      const row = await tx.growthExperiment.update({ where: { id }, data: { status: 'CONCLUDED', stoppedAt: now, stopReason: `CONCLUDED:${verdict}` } });
      await this.event(tx, id, 'CONCLUDED', actor.sub, verdict, {});
      await this.outbox.enqueue(tx, { type: 'ExperimentConcluded', aggregateType: 'GrowthExperiment', aggregateId: id, payload: { experimentId: id, market: cur.market, key: cur.key, verdict, at: now.toISOString() }, dedupeKey: `ExperimentConcluded:${id}` });
      return row;
    });
  }

  async archive(actor: Actor, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const cur = await this.must(id, tx);
      if (cur.status === 'RUNNING' || cur.status === 'PENDING_APPROVAL') throw conflict('EXPERIMENT_INVALID_TRANSITION', `Stop the experiment before archiving it (it is ${cur.status})`);
      if (cur.status === 'ARCHIVED') return cur;
      const row = await tx.growthExperiment.update({ where: { id }, data: { status: 'ARCHIVED' } });
      await this.event(tx, id, 'ARCHIVED', actor.sub); await this.audit(tx, actor.sub, 'archive', id, {});
      return row;
    });
  }

  /**
   * "Ship winner" never applies anything. It records a SHIP_REQUESTED proposal in the append-only history (and an audit row) for a human to carry out through the EXISTING maker-checker
   * (a GrowthConfigVersion draft or a flag change in the Super Admin). Only a CONCLUDED experiment whose latest result is a WINNER can be shipped.
   */
  async shipWinner(actor: Actor, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const cur = await this.must(id, tx);
      if (cur.status !== 'CONCLUDED') throw conflict('EXPERIMENT_NOT_SHIPPABLE', 'Only a CONCLUDED experiment can be shipped');
      const last = await tx.growthExperimentResult.findFirst({ where: { experimentId: id }, orderBy: { computedAt: 'desc' } });
      const payload = (last?.payload ?? {}) as { winner?: string | null };
      if (last?.verdict !== 'WINNER' || !payload.winner) throw conflict('EXPERIMENT_NOT_SHIPPABLE', 'The latest result is not a WINNER');
      const already = await tx.growthExperimentEvent.findFirst({ where: { experimentId: id, kind: 'SHIP_REQUESTED' } });
      if (already) return { requested: true, duplicate: true, proposal: already.diff };
      const proposal = { winner: payload.winner, flagKey: cur.flagKey, surface: cur.surface, nextStep: cur.flagKey ? 'Change the flag in the Super Admin (flag change goes through the control-plane audit)' : 'Create a Growth config version draft or ship the copy in code; both need a second person', autoApplied: false };
      await this.event(tx, id, 'SHIP_REQUESTED', actor.sub, null, proposal); await this.audit(tx, actor.sub, 'ship_requested', id, proposal);
      await this.outbox.enqueue(tx, { type: 'ExperimentShipRequested', aggregateType: 'GrowthExperiment', aggregateId: id, payload: { experimentId: id, ...proposal }, dedupeKey: `ExperimentShipRequested:${id}` });
      return { requested: true, duplicate: false, proposal };
    });
  }

  async list(f: { market?: string; status?: string; surface?: string; take?: number } = {}) {
    return this.prisma.growthExperiment.findMany({ where: { market: f.market, status: f.status, surface: f.surface }, orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(f.take ?? 100, 1), 200) });
  }
  async get(id: string) {
    const e = await this.must(id);
    const [latest, events] = await Promise.all([
      this.prisma.growthExperimentResult.findFirst({ where: { experimentId: id }, orderBy: { computedAt: 'desc' } }),
      this.prisma.growthExperimentEvent.findMany({ where: { experimentId: id }, orderBy: { at: 'asc' }, take: 500 }),
    ]);
    return { ...e, latestResult: latest ? this.redact(latest, e.status) : null, events };
  }
  history(id: string) { return this.prisma.growthExperimentEvent.findMany({ where: { experimentId: id }, orderBy: { at: 'asc' }, take: 1000 }); }
  async results(id: string) { const e = await this.must(id); return (await this.prisma.growthExperimentResult.findMany({ where: { experimentId: id }, orderBy: { computedAt: 'desc' }, take: 200 })).map((r) => this.redact(r, e.status)); }

  /** While SRM, a blocker or a guardrail breach stands the payload carries no p-value, interval or winner (hidden rows are kept for audit but shown redacted). */
  redact<T extends { verdict: string; payload: unknown }>(r: T, _status: string): T {
    const p = (r.payload ?? {}) as { hidden?: boolean };
    if (r.verdict === 'SRM_DETECTED' || r.verdict === 'COLLECTING' || p.hidden) { const { arms, srm, blockers, dayNumber } = (r.payload ?? {}) as Record<string, unknown>; return { ...r, payload: { hidden: true, arms, srm, blockers, dayNumber } }; }
    return r;
  }
}
