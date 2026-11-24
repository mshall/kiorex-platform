import { Injectable } from '@nestjs/common';
import { ApiError, conflict, forbidden, notFound } from '../../common/errors';
import { FlagsService } from '../../control-plane/control-plane-public';
import { Prisma } from '../../prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GROWTH_DEFAULT_MARKET, GROWTH_FLAG } from '../growth-flags';
import { AUTOMATION_FLAG } from './automation-flags';
import { compileGraph, type CompiledJourney } from './journey.compiler';
import { dryRun, type DryRunOptions } from './journey.dryrun';
import { AUTOMATION_POLICY, BRANCH_SURFACE, checksumOf, CHANNELS, SEND_TEMPLATES, TRIGGER_EVENTS, type JourneyGraph } from './journey.graph';
import { allowedChannels, templateClass, validateGraph, type ValidationError } from './journey.validator';
import { SEGMENT_ATTRIBUTES } from '../lifecycle/lifecycle-segments';
import { LifecyclePolicyService } from '../lifecycle/lifecycle-policy.service';

export interface Actor { sub: string; kind: 'USER' | 'SYSTEM' }
const KEY = /^[a-z0-9][a-z0-9-]{1,47}$/;

export const invalid = (errors: ValidationError[]) => new ApiError(422, 'JOURNEY_INVALID', 'The journey graph is not valid', { errors });

@Injectable()
export class JourneyDefinitionService {
  constructor(private readonly prisma: PrismaService, private readonly flags: FlagsService, private readonly policies: LifecyclePolicyService) {}

  catalog() {
    return {
      nodeTypes: ['TRIGGER', 'WAIT', 'CONDITION', 'SEND', 'BRANCH_EXPERIMENT', 'END'], triggers: TRIGGER_EVENTS, channels: CHANNELS, attributes: SEGMENT_ATTRIBUTES, branchSurface: BRANCH_SURFACE, policy: AUTOMATION_POLICY,
      templates: SEND_TEMPLATES.map((t) => ({ key: t, messageClass: templateClass(t), channels: allowedChannels(t) })),
    };
  }

  /** What the console banner shows: is the automation switch on, and is the marketing licence flag effective (MARKETING sends are skipped, with a reason, while it is not). */
  async status(market = GROWTH_DEFAULT_MARKET) {
    const [auto, marketing] = await Promise.all([this.flags.evaluate(AUTOMATION_FLAG, { market }), this.flags.evaluate(GROWTH_FLAG.MARKETING_MESSAGING, { market })]);
    return { market, automation: { effective: auto.effective, reason: auto.reason }, marketingLicence: { effective: marketing.effective, reason: marketing.reason, flag: GROWTH_FLAG.MARKETING_MESSAGING }, lifecycleJourneys: await this.policies.journeysOn(market) };
  }

  private async must(id: string) { const r = await this.prisma.lifecycleJourneyDefinition.findUnique({ where: { id } }); if (!r) throw notFound('JOURNEY_NOT_FOUND', 'No such journey'); return r; }
  private audit(tx: Prisma.TransactionClient | PrismaService, actor: Actor, action: string, id: string, metadata: Record<string, unknown>) {
    return tx.auditLog.create({ data: { actor: actor.sub, action: `growth.automation.${action}`, resource: 'LifecycleJourneyDefinition', resourceId: id, metadata: metadata as Prisma.InputJsonValue } });
  }
  private present(r: Awaited<ReturnType<JourneyDefinitionService['must']>>) {
    return { id: r.id, market: r.market, key: r.key, version: r.version, status: r.status, name: r.name, graph: r.graph, checksum: r.checksum, createdBy: r.createdBy, approvedBy: r.approvedBy, submittedAt: r.submittedAt, publishedAt: r.publishedAt, retiredAt: r.retiredAt, killedAt: r.killedAt, killedBy: r.killedBy, killReason: r.killReason, createdAt: r.createdAt };
  }

  /** Validate, compile and dry-run a graph without saving it (the builder calls this on every change). */
  preview(graph: unknown, o: Partial<DryRunOptions> & { market?: string; key?: string } = {}) {
    const v = validateGraph(graph);
    if (!v.valid) return { valid: false as const, errors: v.errors };
    const c = compileGraph(v.graph, { definitionId: 'preview', market: o.market ?? GROWTH_DEFAULT_MARKET, key: o.key ?? 'preview', version: 0 });
    return { valid: true as const, errors: [] as ValidationError[], checksum: c.checksum, compiled: this.view(c) };
  }
  view(c: CompiledJourney) { return { steps: c.steps, gateNodes: c.gateNodes, truncated: c.truncated, trigger: c.trigger, key: c.def.key }; }

  async dryRunGraph(graph: unknown, market: string, o: { size?: number; seed?: number } = {}) {
    const v = validateGraph(graph); if (!v.valid) throw invalid(v.errors);
    const c = compileGraph(v.graph, { definitionId: 'dry-run', market, key: 'dry-run', version: 0 });
    const marketingFlagOn = await this.policies.marketingOn(market);
    const policy = await this.policies.resolve(market);
    return { checksum: c.checksum, compiled: this.view(c), result: dryRun(c, { ...o, marketingFlagOn, holdoutBps: policy.holdoutBps, caps: policy.caps, quiet: policy.quiet }) };
  }
  async dryRunSaved(id: string, o: { size?: number; seed?: number } = {}) { const r = await this.must(id); return { id, ...(await this.dryRunGraph(r.graph, r.market, o)) }; }

  async create(actor: Actor, body: { key?: unknown; name?: unknown; graph?: unknown; market?: unknown }) {
    const key = typeof body.key === 'string' ? body.key : ''; if (!KEY.test(key)) throw new ApiError(400, 'JOURNEY_KEY_INVALID', 'key must match [a-z0-9][a-z0-9-]{1,47}');
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : ''; const market = typeof body.market === 'string' && /^[A-Z]{2}$/.test(body.market) ? body.market : GROWTH_DEFAULT_MARKET;
    const v = validateGraph(body.graph); if (!v.valid) throw invalid(v.errors);
    const open = await this.prisma.lifecycleJourneyDefinition.findFirst({ where: { market, key, status: { in: ['DRAFT', 'PENDING_APPROVAL'] } } });
    if (open) throw conflict('JOURNEY_DRAFT_EXISTS', 'This journey already has an open draft; edit or reject it first');
    const last = await this.prisma.lifecycleJourneyDefinition.findFirst({ where: { market, key }, orderBy: { version: 'desc' }, select: { version: true } });
    const row = await this.prisma.$transaction(async (tx) => {
      const r = await tx.lifecycleJourneyDefinition.create({ data: { market, key, version: (last?.version ?? 0) + 1, name, graph: v.graph as unknown as Prisma.InputJsonValue, checksum: checksumOf(v.graph), createdBy: actor.sub } });
      await this.audit(tx, actor, 'create', r.id, { key, version: r.version, checksum: r.checksum });
      return r;
    });
    return this.present(row);
  }

  async update(actor: Actor, id: string, body: { name?: unknown; graph?: unknown }) {
    const cur = await this.must(id);
    if (cur.status !== 'DRAFT') throw conflict('JOURNEY_NOT_EDITABLE', 'Only a draft can be edited; a published journey is immutable (make a new version)');
    if (cur.createdBy !== actor.sub) throw forbidden('JOURNEY_AUTHOR_ONLY', 'Only the author edits a draft');
    const data: Prisma.LifecycleJourneyDefinitionUpdateInput = {};
    if (body.graph !== undefined) { const v = validateGraph(body.graph); if (!v.valid) throw invalid(v.errors); data.graph = v.graph as unknown as Prisma.InputJsonValue; data.checksum = checksumOf(v.graph); }
    if (typeof body.name === 'string') data.name = body.name.trim().slice(0, 120);
    const row = await this.prisma.$transaction(async (tx) => { const r = await tx.lifecycleJourneyDefinition.update({ where: { id }, data }); await this.audit(tx, actor, 'update', id, { checksum: r.checksum }); return r; });
    return this.present(row);
  }

  /** A branch must name a real experiment on the win-back surface of the same market (the P3-A registry owns what an experiment may do). */
  private async assertBranchExperiments(graph: JourneyGraph, market: string) {
    for (const n of graph.nodes) if (n.type === 'BRANCH_EXPERIMENT') {
      const e = await this.prisma.growthExperiment.findUnique({ where: { market_key: { market, key: n.experiment } }, select: { surface: true, status: true, variants: true } });
      if (!e || e.surface !== BRANCH_SURFACE) throw new ApiError(422, 'JOURNEY_INVALID', 'The journey graph is not valid', { errors: [{ code: 'BRANCH_INVALID', path: `/nodes/${n.id}/experiment`, message: `experiment "${n.experiment}" does not exist on the surface ${BRANCH_SURFACE}` }] });
      const have = new Set(((e.variants as Array<{ key: string }>) ?? []).map((x) => x.key));
      for (const ed of graph.edges.filter((x) => x.from === n.id)) if (!have.has(ed.label!)) throw new ApiError(422, 'JOURNEY_INVALID', 'The journey graph is not valid', { errors: [{ code: 'BRANCH_INVALID', path: `/edges`, message: `variant "${ed.label}" is not a variant of experiment "${n.experiment}"` }] });
    }
  }

  async submit(actor: Actor, id: string) {
    const cur = await this.must(id);
    if (cur.status !== 'DRAFT') throw conflict('JOURNEY_INVALID_TRANSITION', 'Only a draft can be submitted');
    const v = validateGraph(cur.graph); if (!v.valid) throw invalid(v.errors);
    await this.assertBranchExperiments(v.graph, cur.market);
    const row = await this.prisma.$transaction(async (tx) => { const r = await tx.lifecycleJourneyDefinition.update({ where: { id }, data: { status: 'PENDING_APPROVAL', submittedAt: new Date() } }); await this.audit(tx, actor, 'submit', id, { checksum: r.checksum }); return r; });
    return this.present(row);
  }

  async reject(actor: Actor, id: string, reason: string) {
    const cur = await this.must(id);
    if (cur.status !== 'PENDING_APPROVAL') throw conflict('JOURNEY_INVALID_TRANSITION', 'Only a pending journey can be rejected');
    if (cur.createdBy === actor.sub) throw forbidden('JOURNEY_TWO_PERSON_RULE', 'The author cannot decide their own journey');
    const row = await this.prisma.$transaction(async (tx) => { const r = await tx.lifecycleJourneyDefinition.update({ where: { id }, data: { status: 'DRAFT', submittedAt: null } }); await this.audit(tx, actor, 'reject', id, { reason: reason.slice(0, 300) }); return r; });
    return this.present(row);
  }

  /** Maker-checker: a DIFFERENT super admin approves and publishes. The previous published version of the key is retired in the same transaction (its running enrolments end with RETIRED). */
  async approve(actor: Actor, id: string, now = new Date()) {
    const cur = await this.must(id);
    if (cur.status !== 'PENDING_APPROVAL') throw conflict('JOURNEY_INVALID_TRANSITION', 'Only a pending journey can be approved');
    if (cur.createdBy === actor.sub) throw forbidden('JOURNEY_TWO_PERSON_RULE', 'A different person must approve (two-person rule)');
    const v = validateGraph(cur.graph); if (!v.valid) throw invalid(v.errors);
    await this.assertBranchExperiments(v.graph, cur.market);
    const hasMarketing = v.graph.nodes.some((n) => n.type === 'SEND' && templateClass(n.template) === 'MARKETING');
    const status = await this.status(cur.market);
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.lifecycleJourneyDefinition.updateMany({ where: { market: cur.market, key: cur.key, status: 'PUBLISHED' }, data: { status: 'RETIRED', retiredAt: now } });
      const r = await tx.lifecycleJourneyDefinition.update({ where: { id }, data: { status: 'PUBLISHED', approvedBy: actor.sub, publishedAt: now } });
      await this.audit(tx, actor, 'publish', id, { key: cur.key, version: cur.version, checksum: cur.checksum, marketingFlagEffective: status.marketingLicence.effective });
      return r;
    });
    return { ...this.present(row), warnings: hasMarketing && !status.marketingLicence.effective ? ['MARKETING_FLAG_OFF'] : [] };
  }

  async retire(actor: Actor, id: string, now = new Date()) {
    const cur = await this.must(id);
    if (cur.status !== 'PUBLISHED') throw conflict('JOURNEY_INVALID_TRANSITION', 'Only a published journey can be retired');
    const row = await this.prisma.$transaction(async (tx) => { const r = await tx.lifecycleJourneyDefinition.update({ where: { id }, data: { status: 'RETIRED', retiredAt: now } }); await this.audit(tx, actor, 'retire', id, {}); return r; });
    return this.present(row);
  }

  /** The kill switch of one journey: takes effect on the next evaluation of every enrolment (they end with KILLED). Never flag-gated; one person is enough (stopping is always safe). */
  async kill(actor: Actor, id: string, reason: string, now = new Date()) {
    const cur = await this.must(id);
    if (cur.status !== 'PUBLISHED') throw conflict('JOURNEY_INVALID_TRANSITION', 'Only a published journey can be killed');
    if (!reason || reason.trim().length < 3) throw new ApiError(400, 'JOURNEY_REASON_REQUIRED', 'A reason is required');
    const row = await this.prisma.$transaction(async (tx) => { const r = await tx.lifecycleJourneyDefinition.update({ where: { id }, data: { killedAt: now, killedBy: actor.sub, killReason: reason.trim().slice(0, 300) } }); await this.audit(tx, actor, 'kill', id, { reason: reason.slice(0, 300) }); return r; });
    return this.present(row);
  }

  async list(f: { market?: string; status?: string; take?: number } = {}) {
    const rows = await this.prisma.lifecycleJourneyDefinition.findMany({ where: { ...(f.market ? { market: f.market } : {}), ...(f.status ? { status: f.status } : {}) }, orderBy: [{ createdAt: 'desc' }], take: Math.min(f.take ?? 100, 200) });
    return rows.map((r) => this.present(r));
  }

  async get(id: string) {
    const r = await this.must(id);
    const v = validateGraph(r.graph);
    const logs = await this.prisma.lifecycleJourneyRunLog.findMany({ where: { definitionId: id }, orderBy: { day: 'desc' }, take: 30 });
    const active = await this.prisma.lifecycleEnrollment.count({ where: { state: 'ACTIVE', journeyKey: { startsWith: `auto.${r.market.toLowerCase()}.${r.key}#` }, journeyVersion: r.version } });
    return {
      ...this.present(r), compiled: v.valid ? this.view(compileGraph(v.graph, { definitionId: r.id, market: r.market, key: r.key, version: r.version, name: r.name })) : null, activeEnrolments: active,
      runLog: logs.map((l) => ({ day: l.day.toISOString().slice(0, 10), enrolled: l.enrolled, sent: l.sent, skipped: l.skipped, ended: l.ended, byReason: l.byReason })),
    };
  }
}
