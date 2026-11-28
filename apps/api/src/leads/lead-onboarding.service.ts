import { Injectable, Logger } from '@nestjs/common';
import { badRequest, conflict, forbidden, notFound } from '../common/errors';
import { newId } from '../common/ids';
import { OPS_ROLES, type AuthUser } from '../common/auth';
import { PrismaService } from '../prisma/prisma.service';
import { LeadConfigService } from './lead-config.service';
import { LeadNotifier } from './lead-notifier';
import { ONBOARDING_KINDS, ONBOARDING_STATUSES, canMove, draftFromLead, draftStatuses, submitBlockers, type OnboardingKind } from './lead-onboarding';

type Req = NonNullable<Awaited<ReturnType<PrismaService['leadOnboardingRequest']['findUnique']>>>;
type LeadRow = NonNullable<Awaited<ReturnType<PrismaService['lead']['findUnique']>>>;
const PAGE_MAX = 100;

/**
 * DRAFT onboarding requests created by won join requests. Ids, statuses and counts in logs; never contact details. Every transition is audited
 * (`AuditLog lead_onboarding.*`) and shown on the lead's trail (`LeadEvent ONBOARDING`).
 */
@Injectable()
export class LeadOnboardingService {
  private readonly log = new Logger('lead-onboarding');
  constructor(private readonly prisma: PrismaService, private readonly notifier: LeadNotifier, private readonly config: LeadConfigService) {}

  private audit(actor: string, action: string, id: string, metadata?: object) {
    return this.prisma.auditLog.create({ data: { actor, action: `lead_onboarding.${action}`, resource: 'LeadOnboardingRequest', resourceId: id, metadata: metadata as never } });
  }
  private trail(leadId: string, actor: string, actorName: string | null, data: Record<string, unknown>) {
    return this.prisma.leadEvent.create({ data: { id: newId('le'), leadId, kind: 'ONBOARDING', actor, actorName, data: data as never } });
  }

  view(r: Req, lead?: { status: string; ref: string } | null) {
    return {
      id: r.id, leadId: r.leadId, contactRef: r.contactRef, status: r.status, kind: r.kind, legalName: r.legalName, providerType: r.providerType, mode: r.mode, modules: r.modules, market: r.market,
      assigneeSub: r.assigneeSub, assigneeName: r.assigneeName, note: r.note, isTest: r.isTest, createdBy: r.createdBy, submittedBy: r.submittedBy, submittedAt: r.submittedAt,
      decidedBy: r.decidedBy, decidedAt: r.decidedAt, decisionNote: r.decisionNote, createdAt: r.createdAt, updatedAt: r.updatedAt,
      leadStatus: lead?.status ?? null, blockers: lead ? submitBlockers(r, lead.status) : [], kinds: ONBOARDING_KINDS,
    };
  }
  private async row(id: string) { const r = await this.prisma.leadOnboardingRequest.findUnique({ where: { id } }); if (!r) throw notFound('LEAD_ONBOARDING_NOT_FOUND', 'Onboarding request not found'); return r; }
  private async withLead(r: Req) { const l = await this.prisma.lead.findUnique({ where: { id: r.leadId }, select: { status: true, ref: true } }); return this.view(r, l); }

  /** Summary shown on the lead (link lead -> draft). */
  async summaryForLead(leadId: string) {
    const r = await this.prisma.leadOnboardingRequest.findUnique({ where: { leadId } });
    return r ? { id: r.id, status: r.status, kind: r.kind, assigneeSub: r.assigneeSub, assigneeName: r.assigneeName } : null;
  }

  /**
   * Exactly one draft per lead: `leadId` is unique, a second call (a reopened WON -> ONBOARDING -> WON, a retry, a concurrent save) returns the existing row and changes nothing.
   * Never called for a LOST lead. Creates nothing but the draft row, its trail event and its audit line.
   */
  async ensureForLead(actor: { sub: string; name?: string | null } | null, lead: LeadRow): Promise<{ request: Req; created: boolean }> {
    if (!draftStatuses().includes(lead.status as never)) throw conflict('LEAD_NOT_READY', `An onboarding request is created when a join request is ${draftStatuses().join(' or ')}`, { status: lead.status });
    const existing = await this.prisma.leadOnboardingRequest.findUnique({ where: { leadId: lead.id } });
    if (existing) return { request: existing, created: false };
    const by = actor?.sub ?? 'system:lead-won';
    let request: Req;
    try {
      request = await this.prisma.leadOnboardingRequest.create({ data: { id: newId('lor'), ...draftFromLead(lead), createdBy: by } });
    } catch (e) {
      if ((e as { code?: string }).code !== 'P2002') throw e;
      const won = await this.prisma.leadOnboardingRequest.findUnique({ where: { leadId: lead.id } }); // a concurrent save created it first
      if (!won) throw e;
      return { request: won, created: false };
    }
    await this.trail(lead.id, by, actor?.name ?? null, { action: 'DRAFT_CREATED', requestId: request.id, assignee: request.assigneeSub });
    await this.audit(by, 'draft_created', request.id, { leadId: lead.id, kind: request.kind, mode: request.mode });
    this.log.log(`lead onboarding draft created id=${request.id} lead=${lead.id} kind=${request.kind ?? 'none'} mode=${request.mode}`);
    if (request.assigneeSub) void this.notifyAssigned(request, lead.ref);
    return { request, created: true };
  }

  /** Manual path (button): the same rule, for a request that was won before this feature existed or whose automatic creation failed. */
  async createForLead(u: AuthUser, leadId: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw notFound('LEAD_NOT_FOUND', 'Join request not found');
    const r = await this.ensureForLead(u, lead);
    return { ...(await this.withLead(r.request)), created: r.created };
  }

  private async notifyAssigned(r: Req, ref: string) {
    if (!r.assigneeSub || (r.isTest && process.env.LEADS_NOTIFY_TEST !== 'true')) return;
    try { const cfg = await this.config.current(); if (cfg.notifications.teamAlert) await this.notifier.onOnboardingAssigned({ leadId: r.leadId, requestId: r.id, ref, assigneeSub: r.assigneeSub, providerType: r.providerType, mode: r.mode }); }
    catch (e) { this.log.warn(`assignment notice failed id=${r.id}: ${(e as Error).message}`); }
  }

  async list(f: { status?: string; assignee?: string; mode?: string; test?: string; page?: string; pageSize?: string }) {
    const where: Record<string, unknown> = {};
    if (f.status) { if (!(ONBOARDING_STATUSES as readonly string[]).includes(f.status)) throw badRequest('INVALID_STATUS', 'Unknown status'); where.status = f.status; }
    if (f.assignee) where.assigneeSub = f.assignee === 'none' ? null : f.assignee;
    if (f.mode) { if (!['STANDALONE', 'CONNECTED'].includes(f.mode)) throw badRequest('INVALID_MODE', 'Unknown mode'); where.mode = f.mode; }
    if (f.test === 'only') where.isTest = true; else if (f.test === 'exclude') where.isTest = false;
    const pageSize = Math.min(Math.max(parseInt(f.pageSize ?? '25', 10) || 25, 1), PAGE_MAX); const page = Math.max(parseInt(f.page ?? '1', 10) || 1, 1);
    const [total, rows] = await Promise.all([this.prisma.leadOnboardingRequest.count({ where: where as never }), this.prisma.leadOnboardingRequest.findMany({ where: where as never, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize })]);
    return { total, page, pageSize, items: rows.map((r) => this.view(r)) };
  }

  async get(id: string) { return this.withLead(await this.row(id)); }

  async update(u: AuthUser, id: string, b: { kind?: string | null; assigneeSub?: string | null; note?: string | null }) {
    const r = await this.row(id);
    if (r.status !== 'DRAFT') throw conflict('NOT_A_DRAFT', 'Only a draft can be edited', { status: r.status });
    const data: Record<string, unknown> = {}; const changed: string[] = []; let assigned = false;
    if (b.kind !== undefined && b.kind !== r.kind) {
      if (b.kind !== null && !(ONBOARDING_KINDS as readonly string[]).includes(b.kind)) throw badRequest('INVALID_KIND', 'Unknown product kind', { allowed: ONBOARDING_KINDS });
      data.kind = b.kind as OnboardingKind | null; changed.push('kind');
    }
    if (b.note !== undefined && (b.note ?? null) !== r.note) {
      const t = (b.note ?? '').trim();
      // eslint-disable-next-line no-control-regex
      if (t.length > 300 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(t)) throw badRequest('INVALID_NOTE', 'A note is at most 300 characters');
      data.note = t || null; changed.push('note');
    }
    if (b.assigneeSub !== undefined && (b.assigneeSub ?? null) !== r.assigneeSub) {
      if (!b.assigneeSub) { data.assigneeSub = null; data.assigneeName = null; }
      else {
        const s = await this.prisma.opsStaffContact.findUnique({ where: { sub: b.assigneeSub } });
        if (!s) throw badRequest('OWNER_NOT_FOUND', 'That team member is not known to the console yet');
        data.assigneeSub = s.sub; data.assigneeName = (s.name ?? s.sub).slice(0, 80); assigned = true;
      }
      changed.push('assignee');
    }
    if (!changed.length) return this.withLead(r);
    const res = await this.prisma.leadOnboardingRequest.updateMany({ where: { id, status: 'DRAFT' }, data: data as never });
    if (res.count !== 1) throw conflict('NOT_A_DRAFT', 'Only a draft can be edited');
    const fresh = await this.row(id);
    await this.audit(u.sub, 'updated', id, { fields: changed });
    await this.trail(r.leadId, u.sub, u.name ?? null, { action: 'UPDATED', requestId: id, fields: changed });
    if (assigned) void this.notifyAssigned(fresh, r.contactRef);
    return this.withLead(fresh);
  }

  /** Atomic status move: the WHERE carries the expected current status, so two reviewers cannot both win. */
  private async move(id: string, from: string, to: string, data: Record<string, unknown>) {
    const res = await this.prisma.leadOnboardingRequest.updateMany({ where: { id, status: from }, data: { status: to, ...data } as never });
    if (res.count !== 1) throw conflict('INVALID_STATE', `The request is no longer ${from}`, { expected: from });
    return this.row(id);
  }

  async submit(u: AuthUser, id: string) {
    const r = await this.row(id);
    if (!canMove(r.status, 'SUBMITTED')) throw conflict('INVALID_STATE', `A request that is ${r.status} cannot be submitted`, { status: r.status });
    const lead = await this.prisma.lead.findUnique({ where: { id: r.leadId }, select: { status: true, ref: true } });
    const blockers = submitBlockers(r, lead?.status ?? 'LOST');
    if (blockers.length) throw conflict('SUBMIT_BLOCKED', 'The request cannot be submitted yet', { blockers });
    const n = await this.move(id, 'DRAFT', 'SUBMITTED', { submittedBy: u.sub, submittedAt: new Date(), decidedBy: null, decidedAt: null, decisionNote: null });
    await this.audit(u.sub, 'submitted', id, { kind: n.kind }); await this.trail(r.leadId, u.sub, u.name ?? null, { action: 'SUBMITTED', requestId: id });
    return this.withLead(n);
  }

  /** super_admin only (controller) and never the person who submitted it; the database repeats the rule with a CHECK. Approving records the decision and nothing else: no organisation, enrolment code or identity is created. */
  async approve(u: AuthUser, id: string, note?: string) {
    const r = await this.row(id);
    if (r.status !== 'SUBMITTED') throw conflict('INVALID_STATE', 'Nothing awaits approval', { status: r.status });
    if (r.submittedBy === u.sub) throw forbidden('TWO_PERSON_RULE', 'Approval needs a different person than the one who submitted it');
    const n = await this.move(id, 'SUBMITTED', 'APPROVED', { decidedBy: u.sub, decidedAt: new Date(), decisionNote: (note ?? '').trim().slice(0, 300) || null });
    await this.audit(u.sub, 'approved', id, { by: u.sub }); await this.trail(r.leadId, u.sub, u.name ?? null, { action: 'APPROVED', requestId: id });
    return this.withLead(n);
  }

  async reject(u: AuthUser, id: string, reason: string) {
    const t = (reason ?? '').trim(); if (!t || t.length > 300) throw badRequest('REASON_REQUIRED', 'A reason of 1 to 300 characters is required', { field: 'reason' });
    const r = await this.row(id);
    if (r.status !== 'SUBMITTED') throw conflict('INVALID_STATE', 'Nothing awaits a decision', { status: r.status });
    if (r.submittedBy === u.sub) throw forbidden('TWO_PERSON_RULE', 'A different person than the one who submitted it decides');
    const n = await this.move(id, 'SUBMITTED', 'REJECTED', { decidedBy: u.sub, decidedAt: new Date(), decisionNote: t });
    await this.audit(u.sub, 'rejected', id); await this.trail(r.leadId, u.sub, u.name ?? null, { action: 'REJECTED', requestId: id });
    return this.withLead(n);
  }

  async cancel(u: AuthUser, id: string, reason?: string) {
    const r = await this.row(id);
    if (!canMove(r.status, 'CANCELLED')) throw conflict('INVALID_STATE', `A request that is ${r.status} cannot be cancelled`, { status: r.status });
    const n = await this.move(id, r.status, 'CANCELLED', { decidedBy: u.sub, decidedAt: new Date(), decisionNote: (reason ?? '').trim().slice(0, 300) || null });
    await this.audit(u.sub, 'cancelled', id); await this.trail(r.leadId, u.sub, u.name ?? null, { action: 'CANCELLED', requestId: id });
    return this.withLead(n);
  }

  /** Back to DRAFT after a rejection or cancellation. Still the same single row: a reopened request never creates a second one. */
  async reopen(u: AuthUser, id: string) {
    const r = await this.row(id);
    if (!canMove(r.status, 'DRAFT')) throw conflict('INVALID_STATE', `A request that is ${r.status} cannot be reopened`, { status: r.status });
    const n = await this.move(id, r.status, 'DRAFT', { submittedBy: null, submittedAt: null, decidedBy: null, decidedAt: null, decisionNote: null });
    await this.audit(u.sub, 'reopened', id); await this.trail(r.leadId, u.sub, u.name ?? null, { action: 'REOPENED', requestId: id });
    return this.withLead(n);
  }
}
export const isOpsUser = (u: AuthUser) => !!u.roles?.some((r) => OPS_ROLES.includes(r));
