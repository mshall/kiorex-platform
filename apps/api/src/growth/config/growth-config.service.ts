import { Injectable } from '@nestjs/common';
import { GROWTH_CONFIG_KINDS, GROWTH_CONFIG_STATES, growthCanonicalJson, validateGrowthConfig as validateContractConfig, type GrowthConfigKind } from '@kiorex/contracts';
import { validateSeoExtensions } from '../seo/seo-public';
import { validateFraudRules } from '../fraud/fraud-config';
import { validateSeoAutomation } from '../seo-automation/seo-automation-config';
import { validateLtvPolicy } from '../cohorts/ltv-policy';
import { validateLoyaltyRules } from '../loyalty/loyalty-config';
import { validateMarketProfile } from '../../market/market-core-public';
import { forbidden } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { growthError } from '../growth-errors';
import { POLICY_ANNOUNCEMENT_KINDS, POLICY_GLOBAL_ONLY, POLICY_KINDS, isPolicyKind, validatePolicy } from '../policy/policy-registry';
import { sha256Hex } from '../growth-secrets';
import { GROWTH_DEFAULT_PAYLOADS, PROPOSED_DEFAULT_MARKER } from './growth-defaults';
import { ConfigReaders } from './config-readers';
import { diffPayload } from '../admin/config-diff';
import { DAILY_VERSION_BUDGET, evaluateGuardrails, findSecretViolations } from '../admin/config-guardrails';

export type ConfigScope = { scope: 'GLOBAL'; scopeId?: '' } | { scope: 'MARKET'; scopeId: string };
export interface ConfigActor { sub: string; roles: string[] }
/** Kinds whose change moves money or evidence rules: effectiveFrom must be at least 7 days after approval and an announcement text is required (ARCH section 16). */
export const MONEY_POLICY_KINDS: readonly string[] = ['ATTRIBUTION_POLICY', 'COMMISSION', 'SPONSORED_PROMOTION_POLICY']; // the last: a clinic's sponsored discount changes what a provider funds, so it needs notice
export const MONEY_POLICY_LEAD_MS = 7 * 86_400_000;
/** GRW-P2: kinds that move marketing money or messaging need an announcement text (10+ characters) but NO 7-day notice: they never change what a provider is charged. */
export const ANNOUNCEMENT_KINDS: readonly string[] = ['CAMPAIGN_POLICY', 'REFERRAL_RULES', 'REWARD_RULES', 'LIFECYCLE_POLICY', 'ASSISTANT_POLICY', 'LOYALTY_RULES', ...POLICY_ANNOUNCEMENT_KINDS]; // GRW-P4-D: points rules move marketing money (no 7-day notice: they never change what a provider is charged)
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

/**
 * SEO keys of package F that ride in the SEO payload next to the contract keys (templates, pagination, review markup, same-day window). The contract schema
 * (additionalProperties false) knows only its own keys until kiorex-contracts adds these as optional, so the contract part is validated by the JSON Schema and this
 * part by F's validator. Both run on every write; nothing else may be added.
 */
export const SEO_EXTENSION_KEYS = ['templates', 'paginatedIndexable', 'reviewMarkupMinCount', 'sameDayWindowHours', 'minAvailableProviders', 'maxParentSimilarityPercent'] as const;
/** GRW-P3-C and P3-G kinds that the vendored contracts do not know yet (1.13.0 adds them): validated here, accepted by `assertKind`. */
export const LOCAL_CONFIG_KINDS: readonly string[] = ['LTV_POLICY', 'MARKET_PROFILE', 'LOYALTY_RULES', ...POLICY_KINDS]; // POLICY_KINDS: configurability sweep (contracts 1.13.0 schemas mirrored in policy/policy-schemas.generated.ts until publish)
export function validateGrowthConfig(kind: string, payload: unknown): { valid: true; value: Record<string, unknown> } | { valid: false; errors: string[] } {
  if (isPolicyKind(kind)) { const errors = validatePolicy(kind, payload); return errors.length ? { valid: false, errors } : { valid: true, value: payload as Record<string, unknown> }; }
  if (kind === 'LTV_POLICY' || kind === 'MARKET_PROFILE' || kind === 'LOYALTY_RULES') {
    const errors = kind === 'LTV_POLICY' ? validateLtvPolicy(payload).errors : kind === 'LOYALTY_RULES' ? validateLoyaltyRules(payload).errors : validateMarketProfile(payload);
    return errors.length ? { valid: false, errors } : { valid: true, value: payload as Record<string, unknown> };
  }
  // GRW-P3-D and P3-F: the two Wave 7 kinds are validated by their own validators (the contract schema joins them with 1.13.0; both must pass once it does)
  if (kind === 'FRAUD_RULES' || kind === 'SEO_AUTOMATION') {
    const mine = kind === 'FRAUD_RULES' ? validateFraudRules(payload) : validateSeoAutomation(payload);
    const known = (GROWTH_CONFIG_KINDS as readonly string[]).includes(kind);
    const theirs = known ? validateContractConfig(kind, payload) : ({ valid: true } as { valid: true });
    const errors = [...(theirs.valid ? [] : theirs.errors), ...mine.errors];
    return errors.length ? { valid: false, errors } : { valid: true, value: payload as Record<string, unknown> };
  }
  if (kind !== 'SEO' || !payload || typeof payload !== 'object' || Array.isArray(payload)) return validateContractConfig(kind, payload);
  const base: Record<string, unknown> = {}; const ext: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) ((SEO_EXTENSION_KEYS as readonly string[]).includes(k) ? ext : base)[k] = v;
  const a = validateContractConfig(kind, base); const b = validateSeoExtensions(ext);
  const errors = [...(a.valid ? [] : a.errors), ...b.errors];
  return errors.length ? { valid: false, errors } : { valid: true, value: payload as Record<string, unknown> };
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
  /** Propagation monitor: other readers of a growth config (the SEO renderer, the widget host) call `readers.record(name, resolved)` too. */
  readonly readers: ConfigReaders;
  private readonly cache = new Map<string, { until: number; value: ResolvedConfig }>();
  constructor(private readonly prisma: PrismaService) { this.readers = new ConfigReaders(prisma); }

  /**
   * Read-through cache for LIVE reads (no explicit `at`). It refreshes by itself: an entry lives at most GROWTH_CONFIG_CACHE_TTL_MS (default 5 s; 0 in tests) and never
   * past the instant a newer approved version takes over, so a change reaches every instance without a redeploy and an effective date is honoured to the second on the
   * instance that approved it and within the TTL on the others. Local transitions invalidate at once.
   */
  cacheTtlMs(): number {
    const raw = process.env.GROWTH_CONFIG_CACHE_TTL_MS;
    const n = raw === undefined || raw === '' ? NaN : Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : process.env.NODE_ENV === 'test' ? 0 : 5000;
  }
  /** Listeners (the policy registry) told after every transition, so a change reaches the in-process snapshot at once. */
  static readonly onChange: Array<() => void> = [];
  invalidate(): void { this.cache.clear(); for (const f of GrowthConfigService.onChange) { try { f(); } catch { /* a listener never breaks a transition */ } } }

  // ───────────────────────── resolution ─────────────────────────

  /** MARKET scope first, then GLOBAL, then PROPOSED_DEFAULT (never throws for a kind that has a default). */
  async resolve<T = Record<string, unknown>>(kind: GrowthConfigKind | string, o: { market?: string; at?: Date } = {}): Promise<ResolvedConfig<T>> {
    const ttl = this.cacheTtlMs();
    if (o.at || ttl === 0) return this.resolveUncached<T>(kind, o);
    const key = `${kind}|${o.market ?? ''}`; const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && hit.until > now) { await this.readers.record('config-service', hit.value); return hit.value as ResolvedConfig<T>; }
    const value = await this.resolveUncached<T>(kind, o);
    const nextDue = await this.prisma.growthConfigVersion.findFirst({ where: { kind, status: 'APPROVED', effectiveFrom: { gt: new Date(now) } }, orderBy: { effectiveFrom: 'asc' }, select: { effectiveFrom: true } });
    const bounds = [now + ttl, nextDue?.effectiveFrom?.getTime() ?? Infinity];
    this.cache.set(key, { until: Math.min(...bounds), value: value as ResolvedConfig });
    return value;
  }

  private async resolveUncached<T = Record<string, unknown>>(kind: GrowthConfigKind | string, o: { market?: string; at?: Date } = {}): Promise<ResolvedConfig<T>> {
    const at = o.at ?? new Date();
    if (!o.at || at.getTime() >= Date.now() - 1000) await this.activateDue(at);
    const scopes: ConfigScope[] = [...(o.market ? [{ scope: 'MARKET', scopeId: o.market } as ConfigScope] : []), { scope: 'GLOBAL', scopeId: '' }];
    for (const s of scopes) {
      const row = await this.prisma.growthConfigVersion.findFirst({
        where: { kind, scope: s.scope, scopeId: s.scopeId ?? '', status: { in: ['ACTIVE', 'SUPERSEDED', 'ROLLED_BACK'] }, effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }] },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (row) return this.noted(o, this.present<T>(row));
    }
    const def = (GROWTH_DEFAULT_PAYLOADS as Record<string, Record<string, unknown> | undefined>)[kind];
    if (!def) throw growthError('GROWTH_CONFIG_NOT_FOUND', `No active growth configuration and no default for ${kind}`);
    const row = await this.ensureDefaultRow(kind);
    return this.noted(o, { ...this.present<T>(row), payload: def as T, source: 'PROPOSED_DEFAULT' });
  }
  /** Live reads report to the propagation monitor (historical `at` reads are replays, not serving). */
  private async noted<T>(o: { at?: Date }, r: ResolvedConfig<T>): Promise<ResolvedConfig<T>> {
    if (!o.at) await this.readers.record('config-service', r);
    return r;
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
    if (i.kind === 'MARKET_PROFILE' && (i.scope !== 'MARKET' || i.payload.cc !== i.scopeId)) throw growthError('GROWTH_CONFIG_INVALID', 'A market profile belongs to its own market scope', { errors: ['/cc must equal the MARKET scopeId'] });
    if (i.kind === 'ATTRIBUTION_POLICY' && i.payload.precedence === 'FIRST_TOUCH') throw growthError('GROWTH_CONFIG_INVALID', 'FIRST_TOUCH is reporting only and cannot be the commission precedence', { errors: ['/precedence FIRST_TOUCH is not allowed for commission'] });
    await this.guard({ kind: i.kind, scope: i.scope, scopeId: i.scopeId ?? '', payload: i.payload, ticket: i.ticket }, true);
    const row = await this.createRow({ kind: i.kind, scope: i.scope, scopeId: i.scopeId ?? '', payload: i.payload, createdBy: actor.sub, effectiveFrom: i.effectiveFrom ?? null, ticket: i.ticket, reason: i.reason, announcement: i.announcement, status: 'DRAFT' });
    await this.audit(actor.sub, 'create', row, { after: row.checksum });
    return row;
  }

  /**
   * A DRAFT created by the system (the fraud calibration job proposes weights). It is an ordinary DRAFT: it still goes through submit and a super admin's approval, and the approver
   * can never be the creator (`system:...`), so the proposal is never applied by itself.
   */
  async createSystemDraft(i: ConfigScope & { kind: string; payload: Record<string, unknown>; reason?: string }) {
    this.assertKind(i.kind); this.assertScope(i);
    const v = validateGrowthConfig(i.kind, i.payload);
    if (!v.valid) throw growthError('GROWTH_CONFIG_INVALID', 'Payload does not match the schema for this kind', { errors: v.errors });
    const row = await this.createRow({ kind: i.kind, scope: i.scope, scopeId: i.scopeId ?? '', payload: i.payload, createdBy: 'system:fraud-calibration', effectiveFrom: null, reason: i.reason, status: 'DRAFT' });
    await this.audit('system:fraud-calibration', 'create', row, { after: row.checksum });
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
      await this.guard({ kind: row.kind, scope: row.scope, scopeId: row.scopeId, payload: patch.payload, ticket: patch.ticket ?? row.ticket }, false);
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
    await this.guard({ kind: row.kind, scope: row.scope, scopeId: row.scopeId, payload: row.payload as Record<string, unknown>, ticket: row.ticket }, false);
    await this.assertNoOtherPending(row);
    return this.move(actor.sub, 'submit', row, { status: 'PENDING_APPROVAL' }, ['DRAFT']);
  }

  /** Dry run for the console: schema, guardrails and the money-policy rules, without changing anything. */
  async validate(id: string, now = new Date()) {
    const row = await this.must(id);
    const errors: string[] = []; const warnings: string[] = [];
    const v = validateGrowthConfig(row.kind, row.payload);
    if (!v.valid) errors.push(...v.errors);
    errors.push(...findSecretViolations(row.payload));
    const current = await this.inForcePayload(row.kind, row.scope, row.scopeId, row.id);
    const g = evaluateGuardrails({ kind: row.kind, scope: row.scope, scopeId: row.scopeId, payload: row.payload as Record<string, unknown>, current, ticket: row.ticket });
    errors.push(...g.errors); warnings.push(...g.warnings);
    if (ANNOUNCEMENT_KINDS.includes(row.kind) && (!row.announcement || row.announcement.trim().length < 10)) errors.push('/announcement: an announcement (10+ characters) is required for this kind');
    if (MONEY_POLICY_KINDS.includes(row.kind)) {
      if (!row.announcement || row.announcement.trim().length < 10) errors.push('/announcement: a provider-facing announcement (10+ characters) is required for this kind');
      const min = now.getTime() + MONEY_POLICY_LEAD_MS;
      if (!row.effectiveFrom || row.effectiveFrom.getTime() < min) errors.push(`/effectiveFrom: must be at least 7 days after approval (earliest ${new Date(min).toISOString()} if approved now)`);
    }
    return { valid: errors.length === 0, errors, warnings };
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
    await this.assertNoOtherPending({ id: '', kind: i.kind, scope: i.scope, scopeId: i.scopeId ?? '' });
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
    if (n > 0) this.invalidate();
    return n;
  }

  /**
   * Explicit activation (checker). An APPROVED version activates at its stated effectiveFrom; asking earlier is refused (the date is the promise made to providers),
   * asking at or after it activates now. Idempotent for a version that is already ACTIVE.
   */
  async activate(actor: ConfigActor, id: string, now = new Date()) {
    if (!isSuper(actor)) throw forbidden('FORBIDDEN_ROLE', 'Insufficient role', { required: ['super_admin'] });
    const row = await this.must(id);
    if (row.status === 'ACTIVE') return row;
    if (row.status !== 'APPROVED') throw growthError('GROWTH_CONFIG_TRANSITION_FORBIDDEN', 'Only an approved version can be activated', { status: row.status });
    if (row.effectiveFrom && row.effectiveFrom.getTime() > now.getTime()) throw growthError('GROWTH_CONFIG_EFFECTIVE_TOO_SOON', 'This version is approved and scheduled: it activates at its effective date', { effectiveFrom: row.effectiveFrom.toISOString() });
    await this.activateDue(now);
    return this.must(id);
  }

  // ───────────────────────── diff and propagation ─────────────────────────

  /** Field-level diff of a version against another one (default: the version it replaces, else the one in force when it is a first version). */
  async diff(id: string, againstId?: string) {
    const row = await this.must(id);
    let base = againstId ? await this.must(againstId) : null;
    if (!base && row.supersedesId) base = await this.prisma.growthConfigVersion.findUnique({ where: { id: row.supersedesId } });
    if (!base) base = await this.prisma.growthConfigVersion.findFirst({ where: { kind: row.kind, scope: row.scope, scopeId: row.scopeId, version: { lt: row.version }, status: { in: ['ACTIVE', 'SUPERSEDED', 'ROLLED_BACK'] } }, orderBy: { version: 'desc' } });
    const against = base ? { id: base.id, version: base.version, status: base.status } : null;
    const before = base ? (base.payload as Record<string, unknown>) : ((GROWTH_DEFAULT_PAYLOADS as Record<string, Record<string, unknown> | undefined>)[row.kind] ?? {});
    return { id: row.id, version: row.version, against, againstIsDefault: !base, changes: diffPayload(before, row.payload) };
  }

  /** Which readers serve which version of (kind, scope), against the version in force at `now`. */
  async propagation(kind: string, scope: string, scopeId: string, now = new Date()) {
    this.assertKind(kind); this.assertScope({ scope, scopeId } as ConfigScope);
    const inForce = await this.prisma.growthConfigVersion.findFirst({ where: { kind, scope, scopeId, status: 'ACTIVE' } });
    const pending = await this.prisma.growthConfigVersion.findMany({ where: { kind, scope, scopeId, status: 'APPROVED' }, orderBy: { effectiveFrom: 'asc' }, select: { id: true, version: true, effectiveFrom: true } });
    const status = await this.readers.status(kind, scope, scopeId, inForce ? { versionId: inForce.id, version: inForce.version } : null, now);
    return { kind, scope, scopeId, cacheTtlMs: this.cacheTtlMs(), ...status, scheduled: pending.map((p) => ({ id: p.id, version: p.version, effectiveFrom: p.effectiveFrom?.toISOString() ?? null })) };
  }

  // ───────────────────────── reads ─────────────────────────

  async list(o: { kind?: string; status?: string; scope?: string; scopeId?: string } = {}) {
    if (o.status && !(GROWTH_CONFIG_STATES as readonly string[]).includes(o.status)) throw growthError('GROWTH_INVALID_REQUEST', 'Unknown status');
    return this.prisma.growthConfigVersion.findMany({ where: { ...(o.kind ? { kind: o.kind } : {}), ...(o.status ? { status: o.status } : {}), ...(o.scope ? { scope: o.scope } : {}), ...(o.scopeId !== undefined ? { scopeId: o.scopeId } : {}) }, orderBy: [{ kind: 'asc' }, { scope: 'asc' }, { scopeId: 'asc' }, { version: 'desc' }], take: 200 });
  }
  get(id: string) { return this.must(id); }
  /** Every audit row of one version, oldest first (checksums and states only). */
  auditTrail(id: string) { return this.prisma.auditLog.findMany({ where: { resource: 'GrowthConfigVersion', resourceId: id }, orderBy: { createdAt: 'asc' }, select: { id: true, actor: true, action: true, metadata: true, createdAt: true } }); }

  /** The payload serving a scope right now (own scope first; a MARKET scope without a version of its own answers with GLOBAL), excluding one version id. */
  private async inForcePayload(kind: string, scope: string, scopeId: string, excludeId?: string): Promise<Record<string, unknown> | null> {
    const own = await this.prisma.growthConfigVersion.findFirst({ where: { kind, scope, scopeId, status: 'ACTIVE', ...(excludeId ? { id: { not: excludeId } } : {}) } });
    if (own) return own.payload as Record<string, unknown>;
    if (scope === 'MARKET') { const g = await this.prisma.growthConfigVersion.findFirst({ where: { kind, scope: 'GLOBAL', scopeId: '', status: 'ACTIVE', ...(excludeId ? { id: { not: excludeId } } : {}) } }); if (g) return g.payload as Record<string, unknown>; }
    return ((GROWTH_DEFAULT_PAYLOADS as Record<string, Record<string, unknown> | undefined>)[kind] ?? null);
  }
  /** Raw secrets are refused at every write; guardrails compare with what is in force; the daily version budget limits churn. */
  private async guard(i: { kind: string; scope: string; scopeId: string; payload: Record<string, unknown>; ticket?: string | null }, countBudget: boolean) {
    const secrets = findSecretViolations(i.payload);
    if (secrets.length) throw growthError('GROWTH_CONFIG_INVALID', 'Configuration may reference secrets by name only', { errors: secrets });
    const g = evaluateGuardrails({ ...i, current: await this.inForcePayload(i.kind, i.scope, i.scopeId) });
    if (g.errors.length) throw growthError('GROWTH_CONFIG_INVALID', 'Change refused by a guardrail', { errors: g.errors, warnings: g.warnings });
    if (countBudget) {
      const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
      const made = await this.prisma.growthConfigVersion.count({ where: { kind: i.kind, scope: i.scope, scopeId: i.scopeId, createdAt: { gte: dayStart }, NOT: { ticket: PROPOSED_DEFAULT_MARKER } } });
      if (made >= DAILY_VERSION_BUDGET()) throw growthError('GROWTH_RATE_LIMITED', 'Daily version budget for this configuration is used up', { budget: DAILY_VERSION_BUDGET() });
    }
  }
  private async assertNoOtherPending(row: { id: string; kind: string; scope: string; scopeId: string }) {
    const other = await this.prisma.growthConfigVersion.findFirst({ where: { kind: row.kind, scope: row.scope, scopeId: row.scopeId, status: 'PENDING_APPROVAL', id: { not: row.id } }, select: { version: true } });
    if (other) throw growthError('GROWTH_CONFIG_TRANSITION_FORBIDDEN', 'Another version of this configuration is already waiting for approval; approve or reject it first', { pendingVersion: other.version });
  }

  // ───────────────────────── internals ─────────────────────────

  private assertKind(kind: string) { if (!(GROWTH_CONFIG_KINDS as readonly string[]).includes(kind) && !LOCAL_CONFIG_KINDS.includes(kind)) throw growthError('GROWTH_INVALID_REQUEST', `Unknown config kind ${kind}`); }
  private assertScope(s: ConfigScope & { kind?: string }) {
    if (s.kind && POLICY_GLOBAL_ONLY.includes(s.kind) && s.scope !== 'GLOBAL') throw growthError('GROWTH_INVALID_REQUEST', `${s.kind} exists at GLOBAL scope only (it is read by process-wide code; a market row would be ignored)`);
    if (s.scope === 'GLOBAL' && (s.scopeId ?? '') !== '') throw growthError('GROWTH_INVALID_REQUEST', 'GLOBAL scope has no scopeId');
    if (s.scope === 'MARKET' && !/^[A-Z]{2}$/.test(s.scopeId)) throw growthError('GROWTH_INVALID_REQUEST', 'MARKET scope needs an ISO country code as scopeId');
  }
  private assertMoneyPolicy(row: { kind: string; effectiveFrom: Date | null; announcement: string | null }, now: Date) {
    if (ANNOUNCEMENT_KINDS.includes(row.kind) && (!row.announcement || row.announcement.trim().length < 10)) throw growthError('GROWTH_CONFIG_INVALID', 'An announcement text is required for this kind', { errors: ['/announcement required'] });
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
    this.invalidate();
    await this.audit(actor, transition, next, { before: row.checksum, after: next.checksum, from: row.status, to: next.status });
    return next;
  }
  private audit(actor: string, transition: string, row: { id: string; kind: string; scope: string; scopeId: string; version: number; ticket: string | null }, extra: Record<string, unknown>) {
    return this.prisma.auditLog.create({ data: { actor, action: `growth.config.${transition}`, resource: 'GrowthConfigVersion', resourceId: row.id, metadata: { kind: row.kind, scope: row.scope, scopeId: row.scopeId, version: row.version, ticket: row.ticket, ...extra } as never } });
  }
}
