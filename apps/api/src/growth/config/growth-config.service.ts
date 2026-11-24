import { Injectable } from '@nestjs/common';
import { GROWTH_CONFIG_KINDS, GROWTH_CONFIG_STATES, growthCanonicalJson, validateGrowthConfig, type GrowthConfigKind } from '@kiorex/contracts';
import { forbidden } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { growthError } from '../growth-errors';
import { sha256Hex } from '../growth-secrets';
import { GROWTH_DEFAULT_PAYLOADS, PROPOSED_DEFAULT_MARKER } from './growth-defaults';

export type ConfigScope = { scope: 'GLOBAL'; scopeId?: '' } | { scope: 'MARKET'; scopeId: string };
export interface ConfigActor { sub: string; roles: string[] }
/** Kinds whose change moves money or evidence rules: effectiveFrom must be at least 7 days after approval and an announcement text is required (ARCH section 16). */
export const MONEY_POLICY_KINDS: readonly string[] = ['ATTRIBUTION_POLICY', 'COMMISSION'];
export const MONEY_POLICY_LEAD_MS = 7 * 86_400_000;
export const DEFAULT_ACTOR = 'system:proposed-default';

export interface ResolvedConfig<T = Record<string, unknown>> {
  /** GrowthConfigVersion.id: decisions store it so an old booking is explained by the policy that was active then. */
  versionId: string;
  version: number;
  kind: string;
  scope: string;
  scopeId: string;
  payload: T;
  /** ACTIVE = a maker-checker version; PROPOSED_DEFAULT = the code defaults (founder has not ratified anything for this kind yet). */
  source: 'ACTIVE' | 'PROPOSED_DEFAULT';
  effectiveFrom: Date | null;
}

const checksumOf = (payload: unknown) => sha256Hex(growthCanonicalJson(payload));
const isSuper = (a: ConfigActor) => a.roles.includes('super_admin');

/**
 * Versioned growth configuration (ARCH section 16). Rows are immutable once they leave DRAFT; every transition writes an AuditLog row
 * (`growth.config.<transition>`, checksums only, never payload secrets: there are none, only secretRef names).
 *
 *   DRAFT -> PENDING_APPROVAL -> APPROVED -> ACTIVE -> SUPERSEDED | ROLLED_BACK       (REJECTED from PENDING_APPROVAL)
 *
 * Maker-checker: approver is a super admin and is not the creator (also a CHECK in the database). Money-policy kinds additionally need
 * effectiveFrom >= approval + 7 days and an announcement. Rollback never edits history: it creates a NEW version that copies an older payload and goes
 * through the same approval. Resolution reads the version whose window contains `at`; with none, the PROPOSED_DEFAULT payloads answer.
 * Controllers live in package K; this is the service they call.
 */
@Injectable()
export class GrowthConfigService {
  constructor(private readonly prisma: PrismaService) {}

  // ───────────────────────── resolution ─────────────────────────

  /** MARKET scope first, then GLOBAL, then PROPOSED_DEFAULT (never throws for a kind that has a default). */
  async resolve<T = Record<string, unknown>>(kind: GrowthConfigKind | string, o: { market?: string; at?: Date } = {}): Promise<ResolvedConfig<T>> {
    const at = o.at ?? new Date();
    if (!o.at || at.getTime() >= Date.now() - 1000) await this.activateDue(at);
    const scopes: ConfigScope[] = [...(o.market ? [{ scope: 'MARKET', scopeId: o.market } as ConfigScope] : []), { scope: 'GLOBAL', scopeId: '' }];
    for (const s of scopes) {
      const row = await this.prisma.growthConfigVersion.findFirst({
        where: { kind, scope: s.scope, scopeId: s.scopeId ?? '', status: { in: ['ACTIVE', 'SUPERSEDED', 'ROLLED_BACK'] }, effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }] },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (row) return this.present<T>(row);
    }
    const def = (GROWTH_DEFAULT_PAYLOADS as Record<string, Record<string, unknown> | undefined>)[kind];
    if (!def) throw growthError('GROWTH_CONFIG_NOT_FOUND', `No active growth configuration and no default for ${kind}`);
    const row = await this.ensureDefaultRow(kind);
    return { ...this.present<T>(row), payload: def as T, source: 'PROPOSED_DEFAULT' };
  }

  private present<T>(row: { id: string; version: number; kind: string; scope: string; scopeId: string; payload: unknown; ticket: string | null; effectiveFrom: Date | null }): ResolvedConfig<T> {
    return { versionId: row.id, version: row.version, kind: row.kind, scope: row.scope, scopeId: row.scopeId, payload: row.payload as T, source: row.ticket === PROPOSED_DEFAULT_MARKER ? 'PROPOSED_DEFAULT' : 'ACTIVE', effectiveFrom: row.effectiveFrom };
  }

  /**
   * A decision references its policy version by id (foreign key), so the fallback defaults are materialised once as an ACTIVE row marked
   * `ticket = PROPOSED_DEFAULT`, created by `system:proposed-default` with no approver. It is superseded by the first approved version.
   */
  private async ensureDefaultRow(kind: string) {
    const find = () => this.prisma.growthConfigVersion.findFirst({ where: { kind, scope: 'GLOBAL', scopeId: '', ticket: PROPOSED_DEFAULT_MARKER, status: { in: ['ACTIVE', 'SUPERSEDED'] } }, orderBy: { version: 'asc' } });
    const existing = await find();
    if (existing) return existing;
    const payload = (GROWTH_DEFAULT_PAYLOADS as Record<string, Record<string, unknown>>)[kind]!;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const next = ((await this.prisma.growthConfigVersion.aggregate({ where: { kind, scope: 'GLOBAL', scopeId: '' }, _max: { version: true } }))._max.version ?? 0) + 1;
        // a real version may already be ACTIVE (a lookup in the past, before it took over): the default row then only describes the earlier window
        const active = await this.prisma.growthConfigVersion.findFirst({ where: { kind, scope: 'GLOBAL', scopeId: '', status: 'ACTIVE' } });
        if (active?.ticket === PROPOSED_DEFAULT_MARKER) return active; // a concurrent request just materialised it
        return await this.prisma.growthConfigVersion.create({ data: { kind, scope: 'GLOBAL', scopeId: '', version: next, status: active ? 'SUPERSEDED' : 'ACTIVE', effectiveTo: active ? (active.effectiveFrom ?? new Date(1)) : null, payload: payload as never, effectiveFrom: new Date(0), createdBy: DEFAULT_ACTOR, ticket: PROPOSED_DEFAULT_MARKER, reason: 'Code defaults (PROPOSED_DEFAULT) until the first approved version', checksum: checksumOf(payload) } });
      } catch (e) {
        if ((e as { code?: string }).code !== 'P2002') throw e;
        const raced = await find(); // another request created it first (or another version took the number)
        if (raced) return raced;
      }
    }
    throw growthError('GROWTH_CONFIG_NOT_FOUND', `Could not materialise the default ${kind} version`);
  }

  // ───────────────────────── maker side ─────────────────────────

  async createDraft(actor: ConfigActor, i: ConfigScope & { kind: string; payload: Record<string, unknown>; effectiveFrom?: Date | null; ticket?: string; reason?: string; announcement?: string }) {
    if (!isSuper(actor)) throw forbidden('FORBIDDEN_ROLE', 'Insufficient role', { required: ['super_admin'] });
    this.assertKind(i.kind); this.assertScope(i);
    const v = validateGrowthConfig(i.kind, i.payload);
    if (!v.valid) throw growthError('GROWTH_CONFIG_INVALID', 'Payload does not match the schema for this kind', { errors: v.errors });
    if (i.kind === 'ATTRIBUTION_POLICY' && i.payload.precedence === 'FIRST_TOUCH') throw growthError('GROWTH_CONFIG_INVALID', 'FIRST_TOUCH is reporting only and cannot be the commission precedence', { errors: ['/precedence FIRST_TOUCH is not allowed for commission'] });
    const row = await this.createRow({ kind: i.kind, scope: i.scope, scopeId: i.scopeId ?? '', payload: i.payload, createdBy: actor.sub, effectiveFrom: i.effectiveFrom ?? null, ticket: i.ticket, reason: i.reason, announcement: i.announcement, status: 'DRAFT' });
    await this.audit(actor.sub, 'create', row, { after: row.checksum });
    return row;
  }

  /** Only a DRAFT may change, and only its creator may change it. Everything else is history. */
  async updateDraft(actor: ConfigActor, id: string, patch: { payload?: Record<string, unknown>; effectiveFrom?: Date | null; ticket?: string; reason?: string; announcement?: string }) {
    const row = await this.must(id);
    if (row.status !== 'DRAFT') throw growthError('GROWTH_CONFIG_TRANSITION_FORBIDDEN', 'Only a DRAFT can be edited; create a new version instead', { status: row.status });
    if (row.createdBy !== actor.sub) throw forbidden('FORBIDDEN_NOT_AUTHOR', 'Only the author can edit a draft');
    if (patch.payload) {
      const v = validateGrowthConfig(row.kind, patch.payload);
      if (!v.valid) throw growthError('GROWTH_CONFIG_INVALID', 'Payload does not match the schema for this kind', { errors: v.errors });
    }
    const payload = patch.payload ?? (row.payload as Record<string, unknown>);
    const next = await this.prisma.growthConfigVersion.update({ where: { id }, data: { payload: payload as never, checksum: checksumOf(payload), ...(patch.effectiveFrom !== undefined ? { effectiveFrom: patch.effectiveFrom } : {}), ...(patch.ticket !== undefined ? { ticket: patch.ticket } : {}), ...(patch.reason !== undefined ? { reason: patch.reason } : {}), ...(patch.announcement !== undefined ? { announcement: patch.announcement } : {}) } });
    await this.audit(actor.sub, 'update', next, { before: row.checksum, after: next.checksum });
    return next;
  }

  async submit(actor: ConfigActor, id: string, now = new Date()) {
    const row = await this.must(id);
    if (row.status !== 'DRAFT') throw growthError('GROWTH_CONFIG_TRANSITION_FORBIDDEN', 'Only a DRAFT can be submitted', { status: row.status });
    if (row.createdBy !== actor.sub) throw forbidden('FORBIDDEN_NOT_AUTHOR', 'Only the author can submit a draft');
    this.assertMoneyPolicy(row, now);
    return this.move(actor.sub, 'submit', row, { status: 'PENDING_APPROVAL' }, ['DRAFT']);
  }

  // ───────────────────────── checker side ─────────────────────────

  async approve(actor: ConfigActor, id: string, now = new Date()) {
    if (!isSuper(actor)) throw forbidden('FORBIDDEN_ROLE', 'Insufficient role', { required: ['super_admin'] });
    const row = await this.must(id);
    if (row.status !== 'PENDING_APPROVAL') throw growthError('GROWTH_CONFIG_TRANSITION_FORBIDDEN', 'Only a version waiting for approval can be approved', { status: row.status });
    if (row.createdBy === actor.sub) throw growthError('GROWTH_CONFIG_SELF_APPROVAL', 'The approver must be a different super admin than the author');
    this.assertMoneyPolicy(row, now); // the 7 days run from the approval, not from the draft
    const approved = await this.move(actor.sub, 'approve', row, { status: 'APPROVED', approvedBy: actor.sub, approvedAt: now, effectiveFrom: row.effectiveFrom ?? now }, ['PENDING_APPROVAL']);
    await this.activateDue(now);
    return (await this.prisma.growthConfigVersion.findUnique({ where: { id } })) ?? approved;
  }

  async reject(actor: ConfigActor, id: string, reason: string) {
    if (!isSuper(actor)) throw forbidden('FORBIDDEN_ROLE', 'Insufficient role', { required: ['super_admin'] });
    const row = await this.must(id);
    if (row.createdBy === actor.sub) throw growthError('GROWTH_CONFIG_SELF_APPROVAL', 'Reject is a checker action: use a different super admin (the author can leave the draft)');
    return this.move(actor.sub, 'reject', row, { status: 'REJECTED', reason: `${row.reason ?? ''}${row.reason ? ' | ' : ''}rejected: ${reason}`.slice(0, 500) }, ['PENDING_APPROVAL']);
  }

  /**
   * Rollback = a NEW version that copies the payload of an older one (`supersedesId` points at it). It is submitted by the actor and needs the same
   * approval, and for ATTRIBUTION_POLICY the same 7-day lead and announcement. When it activates, the version it replaces is marked ROLLED_BACK.
   */
  async rollback(actor: ConfigActor, i: { kind: string; toVersion: number; reason: string; effectiveFrom?: Date | null; ticket?: string; announcement?: string } & ConfigScope, now = new Date()) {
    if (!isSuper(actor)) throw forbidden('FORBIDDEN_ROLE', 'Insufficient role', { required: ['super_admin'] });
    this.assertKind(i.kind); this.assertScope(i);
    const target = await this.prisma.growthConfigVersion.findUnique({ where: { kind_scope_scopeId_version: { kind: i.kind, scope: i.scope, scopeId: i.scopeId ?? '', version: i.toVersion } } });
    if (!target) throw growthError('GROWTH_CONFIG_NOT_FOUND', `Version ${i.toVersion} of ${i.kind} does not exist`);
    if (!['ACTIVE', 'SUPERSEDED', 'ROLLED_BACK'].includes(target.status)) throw growthError('GROWTH_CONFIG_TRANSITION_FORBIDDEN', 'Only a version that has been active can be restored', { status: target.status });
    const row = await this.createRow({ kind: i.kind, scope: i.scope, scopeId: i.scopeId ?? '', payload: target.payload as Record<string, unknown>, createdBy: actor.sub, effectiveFrom: i.effectiveFrom ?? null, ticket: i.ticket, reason: `rollback to v${i.toVersion}: ${i.reason}`.slice(0, 500), announcement: i.announcement, status: 'DRAFT', supersedesId: target.id });
    await this.audit(actor.sub, 'rollback', row, { after: row.checksum, restoredVersion: i.toVersion });
    this.assertMoneyPolicy(row, now);
    return this.move(actor.sub, 'submit', row, { status: 'PENDING_APPROVAL' }, ['DRAFT']);
  }

  /**
   * Activates every APPROVED version whose effectiveFrom has arrived (oldest first): the previous ACTIVE row is closed at that instant
   * (SUPERSEDED, or ROLLED_BACK when the newcomer is a rollback) and the newcomer becomes the single ACTIVE row, in one transaction.
   * Idempotent and safe to call from several instances (the partial unique index is the arbiter).
   */
  async activateDue(now = new Date()): Promise<number> {
    const due = await this.prisma.growthConfigVersion.findMany({ where: { status: 'APPROVED', effectiveFrom: { lte: now } }, orderBy: [{ effectiveFrom: 'asc' }, { version: 'asc' }] });
    let n = 0;
    for (const row of due) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const cur = await tx.growthConfigVersion.findFirst({ where: { kind: row.kind, scope: row.scope, scopeId: row.scopeId, status: 'ACTIVE' } });
          const from = row.effectiveFrom!;
          if (cur) await tx.growthConfigVersion.update({ where: { id: cur.id }, data: { status: row.supersedesId ? 'ROLLED_BACK' : 'SUPERSEDED', effectiveTo: new Date(Math.max(from.getTime(), (cur.effectiveFrom?.getTime() ?? 0) + 1)) } });
          const claimed = await tx.growthConfigVersion.updateMany({ where: { id: row.id, status: 'APPROVED' }, data: { status: 'ACTIVE' } });
          if (!claimed.count) throw new Error('already activated'); // another instance won: roll the supersede back, nothing is lost
          await tx.auditLog.create({ data: { actor: 'system:growth', action: 'growth.config.activate', resource: 'GrowthConfigVersion', resourceId: row.id, metadata: { kind: row.kind, scope: row.scope, scopeId: row.scopeId, version: row.version, checksum: row.checksum, supersededVersion: cur?.version ?? null } as never } });
        });
        n++;
      } catch (e) {
        if ((e as { code?: string }).code !== 'P2002' && (e as Error).message !== 'already activated') throw e;
      }
    }
    return n;
  }

  // ───────────────────────── reads ─────────────────────────

  async list(o: { kind?: string; status?: string; scope?: string; scopeId?: string } = {}) {
    if (o.status && !(GROWTH_CONFIG_STATES as readonly string[]).includes(o.status)) throw growthError('GROWTH_INVALID_REQUEST', 'Unknown status');
    return this.prisma.growthConfigVersion.findMany({ where: { ...(o.kind ? { kind: o.kind } : {}), ...(o.status ? { status: o.status } : {}), ...(o.scope ? { scope: o.scope } : {}), ...(o.scopeId !== undefined ? { scopeId: o.scopeId } : {}) }, orderBy: [{ kind: 'asc' }, { scope: 'asc' }, { scopeId: 'asc' }, { version: 'desc' }], take: 200 });
  }
  get(id: string) { return this.must(id); }

  // ───────────────────────── internals ─────────────────────────

  private assertKind(kind: string) { if (!(GROWTH_CONFIG_KINDS as readonly string[]).includes(kind)) throw growthError('GROWTH_INVALID_REQUEST', `Unknown config kind ${kind}`); }
  private assertScope(s: ConfigScope) {
    if (s.scope === 'GLOBAL' && (s.scopeId ?? '') !== '') throw growthError('GROWTH_INVALID_REQUEST', 'GLOBAL scope has no scopeId');
    if (s.scope === 'MARKET' && !/^[A-Z]{2}$/.test(s.scopeId)) throw growthError('GROWTH_INVALID_REQUEST', 'MARKET scope needs an ISO country code as scopeId');
  }
  private assertMoneyPolicy(row: { kind: string; effectiveFrom: Date | null; announcement: string | null }, now: Date) {
    if (!MONEY_POLICY_KINDS.includes(row.kind)) return;
    if (!row.announcement || row.announcement.trim().length < 10) throw growthError('GROWTH_CONFIG_INVALID', 'An announcement text for providers is required for this kind', { errors: ['/announcement required'] });
    if (!row.effectiveFrom || row.effectiveFrom.getTime() < now.getTime() + MONEY_POLICY_LEAD_MS) throw growthError('GROWTH_CONFIG_EFFECTIVE_TOO_SOON', 'effectiveFrom must be at least 7 days after approval for this kind', { minEffectiveFrom: new Date(now.getTime() + MONEY_POLICY_LEAD_MS).toISOString() });
  }
  private async must(id: string) {
    const row = await this.prisma.growthConfigVersion.findUnique({ where: { id } });
    if (!row) throw growthError('GROWTH_CONFIG_NOT_FOUND', 'Config version not found');
    return row;
  }
  private async createRow(d: { kind: string; scope: string; scopeId: string; payload: Record<string, unknown>; createdBy: string; effectiveFrom: Date | null; ticket?: string; reason?: string; announcement?: string; status: string; supersedesId?: string }) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const version = ((await this.prisma.growthConfigVersion.aggregate({ where: { kind: d.kind, scope: d.scope, scopeId: d.scopeId }, _max: { version: true } }))._max.version ?? 0) + 1;
      try {
        return await this.prisma.growthConfigVersion.create({ data: { kind: d.kind, scope: d.scope, scopeId: d.scopeId, version, status: d.status, payload: d.payload as never, effectiveFrom: d.effectiveFrom, createdBy: d.createdBy, ticket: d.ticket, reason: d.reason, announcement: d.announcement, supersedesId: d.supersedesId, checksum: checksumOf(d.payload) } });
      } catch (e) { if ((e as { code?: string }).code !== 'P2002' || attempt === 4) throw e; } // two makers took the same number: retry with the next
    }
    throw new Error('unreachable');
  }
  /** Compare-and-set on the current status so two concurrent transitions cannot both win. */
  private async move(actor: string, transition: string, row: { id: string; status: string; checksum: string; kind: string; scope: string; scopeId: string; version: number }, data: Record<string, unknown>, from: string[]) {
    const r = await this.prisma.growthConfigVersion.updateMany({ where: { id: row.id, status: { in: from } }, data: data as never });
    if (!r.count) throw growthError('GROWTH_CONFIG_TRANSITION_FORBIDDEN', 'The version changed state meanwhile', { status: (await this.must(row.id)).status });
    const next = await this.must(row.id);
    await this.audit(actor, transition, next, { before: row.checksum, after: next.checksum, from: row.status, to: next.status });
    return next;
  }
  private audit(actor: string, transition: string, row: { id: string; kind: string; scope: string; scopeId: string; version: number; ticket: string | null }, extra: Record<string, unknown>) {
    return this.prisma.auditLog.create({ data: { actor, action: `growth.config.${transition}`, resource: 'GrowthConfigVersion', resourceId: row.id, metadata: { kind: row.kind, scope: row.scope, scopeId: row.scopeId, version: row.version, ticket: row.ticket, ...extra } as never } });
  }
}
