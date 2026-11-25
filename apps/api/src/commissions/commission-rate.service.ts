import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { badRequest, conflict, forbidden, notFound } from '../common/errors';
import { newId } from '../common/ids';
import { partnerRequest } from '../common/partner-http';
import { KiorlyClient } from '../kiorly/kiorly-public';
import { PartnerRegistry } from '../partners/partners-public';
import { OutboxService } from '../outbox/outbox-public';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { RATE_PRODUCTS, snapshotOf, type RateSnapshot, type EffectiveRate, type RateKind, type RateProduct, type RateRowLite, type RateScope, effectiveFromAtApproval, effectiveFromProblem, parseRate, rateProblems, resolveRate } from './commission-rate';

const ORG_RE = /^[A-Za-z0-9_-]{3,64}$/;
const PRODUCT_SET = new Set<string>(RATE_PRODUCTS);
export const RATE_PUSH_EVENT = 'kiorly.commission_rate';

type Row = Awaited<ReturnType<PrismaService['commissionRatePolicy']['findFirstOrThrow']>>;
const lite = (r: Row): RateRowLite => ({ id: r.id, scope: r.scope as RateScope, kind: r.kind as RateKind, version: r.version, status: r.status, spec: r.spec, effectiveFrom: r.effectiveFrom, reason: r.reason });
const specOut = (r: EffectiveRate) => (r.spec ? { ...r.spec } : null);
const effOut = (e: EffectiveRate) => ({ state: e.state, source: e.source, policyId: e.policyId, version: e.version, effectiveFrom: e.effectiveFrom, reason: e.reason, spec: specOut(e) });

/**
 * COM-2 commission rates per organisation type (default) and per organisation (override). Maker-checker (a DIFFERENT super admin decides), append-only, effective-dated, audited.
 * No numeric rate is shipped: with no active default and no override the organisation's state is NOT_SET (no charge, visibly "rate not set").
 * The provider (organisation) side only ever sees `partnerView`: the effective rate, the default, whether an override applies, and the history of effective rows (never who proposed or decided).
 */
@Injectable()
export class CommissionRateService implements OnModuleInit {
  private readonly log = new Logger('commission-rates');
  constructor(private readonly prisma: PrismaService, @Optional() private readonly outbox?: OutboxService, @Optional() private readonly kiorly?: KiorlyClient, @Optional() private readonly partners?: PartnerRegistry) {}

  onModuleInit() {
    this.outbox?.register(RATE_PUSH_EVENT, (e) => this.pushToPartner(e.payload.orgRef));
  }

  private audit(actor: string, action: string, resourceId: string, metadata: Record<string, unknown>) {
    return this.prisma.auditLog.create({ data: { actor, action, resource: 'CommissionRatePolicy', resourceId, metadata: metadata as object } });
  }
  private assertProduct(p: string): RateProduct {
    if (!PRODUCT_SET.has(p)) throw badRequest('INVALID_PRODUCT', 'product must be CLINIC, PHARMACY or LAB');
    return p as RateProduct;
  }

  // ───────────── propose / decide ─────────────
  /** Propose the platform default rate for one organisation type. */
  async proposeDefault(i: { product: string; spec: unknown; effectiveFrom?: string; note?: string; actor: string }, now = new Date()) {
    const product = this.assertProduct(i.product);
    return this.propose({ scope: 'DEFAULT', product, scopeRef: product, kind: 'RATE', spec: i.spec, effectiveFrom: i.effectiveFrom, reason: i.note, actor: i.actor }, now);
  }

  /** Propose an override for one organisation (kind RATE) or its return to the default (kind INHERIT). A reason is mandatory. */
  async proposeOrg(i: { orgRef: string; product: string; kind: string; spec?: unknown; effectiveFrom?: string; reason: string; actor: string }, now = new Date()) {
    const product = this.assertProduct(i.product);
    if (!ORG_RE.test(i.orgRef)) throw badRequest('INVALID_ORG', 'Invalid organisation reference');
    if (!i.reason || !i.reason.trim()) throw badRequest('REASON_REQUIRED', 'A reason is required for an organisation rate change');
    if (i.kind !== 'RATE' && i.kind !== 'INHERIT') throw badRequest('INVALID_KIND', 'kind must be RATE or INHERIT');
    const link = await this.prisma.commissionOrgRateLink.findUnique({ where: { orgRef: i.orgRef } });
    if (link && link.product !== product) throw conflict('PRODUCT_MISMATCH', `This organisation belongs to ${link.product}`);
    await this.ensureLink(i.orgRef, product);
    return this.propose({ scope: 'ORG', product, scopeRef: i.orgRef, kind: i.kind, spec: i.spec, effectiveFrom: i.effectiveFrom, reason: i.reason, actor: i.actor }, now);
  }

  private async propose(i: { scope: RateScope; product: RateProduct; scopeRef: string; kind: RateKind; spec?: unknown; effectiveFrom?: string; reason?: string; actor: string }, now: Date) {
    let specOut: object | null = null;
    if (i.kind === 'RATE') {
      const problems = rateProblems(i.spec);
      if (problems.length) throw badRequest('INVALID_RATE', 'The rate is not valid', { problems });
      specOut = parseRate(i.spec) as unknown as object;
    } else if (i.spec != null) throw badRequest('INVALID_RATE', 'An INHERIT change carries no rate');
    const from = i.effectiveFrom ? new Date(i.effectiveFrom) : now;
    const bad = effectiveFromProblem(from, now);
    if (bad) throw badRequest('INVALID_EFFECTIVE_FROM', bad);
    const open = await this.prisma.commissionRatePolicy.count({ where: { scope: i.scope, scopeRef: i.scopeRef, status: 'PENDING' } });
    if (open) throw conflict('PROPOSAL_ALREADY_OPEN', 'Decide the open proposal before proposing another');
    const last = await this.prisma.commissionRatePolicy.findFirst({ where: { scope: i.scope, scopeRef: i.scopeRef }, orderBy: { version: 'desc' }, select: { version: true } });
    const row = await this.prisma.commissionRatePolicy.create({ data: { id: newId('crp'), scope: i.scope, product: i.product, scopeRef: i.scopeRef, kind: i.kind, version: (last?.version ?? 0) + 1, spec: (specOut ?? undefined) as object | undefined, effectiveFrom: from, reason: i.reason?.slice(0, 300) || null, proposedBy: i.actor } });
    await this.audit(i.actor, 'commission.rate_proposed', row.id, { scope: i.scope, product: i.product, scopeRef: i.scopeRef, kind: i.kind, version: row.version, spec: specOut, effectiveFrom: from, reason: row.reason });
    return row;
  }

  async decide(i: { id: string; approve: boolean; actor: string; note?: string }, now = new Date()) {
    const row = await this.prisma.commissionRatePolicy.findUnique({ where: { id: i.id } });
    if (!row) throw notFound('RATE_NOT_FOUND', 'No such proposal');
    if (row.status !== 'PENDING') throw conflict('ALREADY_DECIDED', 'This proposal was already decided');
    if (row.proposedBy === i.actor) throw forbidden('TWO_PERSON_RULE', 'A different super admin must decide this proposal (maker-checker)');
    const effectiveFrom = i.approve ? effectiveFromAtApproval(row.effectiveFrom, now) : row.effectiveFrom;
    const moved = effectiveFrom.getTime() !== row.effectiveFrom.getTime();
    const out = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.commissionRatePolicy.updateMany({ where: { id: row.id, status: 'PENDING' }, data: { status: i.approve ? 'ACTIVE' : 'REJECTED', decidedBy: i.actor, decidedAt: now, decisionNote: i.note?.slice(0, 300), effectiveFrom, ...(moved ? { requestedFrom: row.effectiveFrom } : {}) } });
      if (claimed.count !== 1) throw conflict('ALREADY_DECIDED', 'This proposal was already decided');
      const decided = await tx.commissionRatePolicy.findUniqueOrThrow({ where: { id: row.id } });
      if (i.approve) await this.enqueuePushes(tx, decided);
      return decided;
    });
    await this.audit(i.actor, i.approve ? 'commission.rate_approved' : 'commission.rate_rejected', row.id, { scope: row.scope, product: row.product, scopeRef: row.scopeRef, version: row.version, proposedBy: row.proposedBy, effectiveFrom, ...(moved ? { requestedFrom: row.effectiveFrom } : {}) });
    return out;
  }

  // ───────────── reads ─────────────
  async listDefaults(now = new Date()) {
    const out = [];
    for (const product of RATE_PRODUCTS) {
      const rows = await this.prisma.commissionRatePolicy.findMany({ where: { scope: 'DEFAULT', scopeRef: product }, orderBy: { version: 'desc' }, take: 50 });
      const eff = resolveRate(rows.map(lite), [], now);
      const pending = rows.find((r) => r.status === 'PENDING') ?? null;
      const future = rows.filter((r) => r.status === 'ACTIVE' && r.effectiveFrom > now).sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime())[0] ?? null;
      out.push({ product, effective: effOut(eff), pending, upcoming: future, history: rows });
    }
    return out;
  }

  /** The full operator view of one organisation: default, override, effective, upcoming, pending and the whole history (with who proposed and decided). */
  async orgView(orgRef: string, product?: string, now = new Date()) {
    const link = await this.prisma.commissionOrgRateLink.findUnique({ where: { orgRef } });
    const prod = product ? this.assertProduct(product) : ((link?.product as RateProduct | undefined) ?? 'CLINIC');
    const [defaults, orgRows] = await Promise.all([
      this.prisma.commissionRatePolicy.findMany({ where: { scope: 'DEFAULT', scopeRef: prod }, orderBy: { version: 'desc' }, take: 50 }),
      this.prisma.commissionRatePolicy.findMany({ where: { scope: 'ORG', scopeRef: orgRef }, orderBy: { version: 'desc' }, take: 100 }),
    ]);
    const effective = resolveRate(defaults.map(lite), orgRows.map(lite), now);
    const defaultOnly = resolveRate(defaults.map(lite), [], now);
    const overrideNow = effective.source === 'OVERRIDE' ? effective : null;
    const upcoming = [...orgRows, ...defaults].filter((r) => r.status === 'ACTIVE' && r.effectiveFrom > now).sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime())[0] ?? null;
    return {
      orgRef, product: prod, linked: !!link, linkedAt: link?.linkedAt ?? null, inheritedDefaultVersion: link?.defaultVersion ?? null,
      mode: effective.spec?.mode ?? null,
      state: effective.state, effective: effOut(effective), default: effOut(defaultOnly), override: overrideNow ? effOut(overrideNow) : null, inheriting: effective.source !== 'OVERRIDE',
      pending: orgRows.find((r) => r.status === 'PENDING') ?? null, upcoming, history: orgRows,
    };
  }

  /** Effective rate of an organisation at an instant (claims snapshot this). */
  async effectiveAt(orgRef: string, product: RateProduct, at: Date, db: PrismaService | Tx = this.prisma): Promise<EffectiveRate> {
    const [defaults, orgRows] = await Promise.all([
      db.commissionRatePolicy.findMany({ where: { scope: 'DEFAULT', scopeRef: product, status: 'ACTIVE' } }),
      db.commissionRatePolicy.findMany({ where: { scope: 'ORG', scopeRef: orgRef, status: 'ACTIVE' } }),
    ]);
    return resolveRate(defaults.map(lite), orgRows.map(lite), at);
  }

  /** For a pharmacy order or lab booking: link the partner to its product default (inherit on first sight) and return the rate to keep on the order; null when no rate is set. A missing partner reference (env-default registration) has no rate. */
  async snapshotForOrder(orgRef: string | null | undefined, product: RateProduct, at = new Date()): Promise<RateSnapshot | null> {
    if (!orgRef) return null;
    await this.ensureLink(orgRef, product);
    return snapshotOf(await this.effectiveAt(orgRef, product, at));
  }

  /** What the organisation's own admin / finance may see (read only): no actor identities. */
  async partnerView(orgRef: string, now = new Date()) {
    const v = await this.orgView(orgRef, undefined, now);
    const strip = (r: Row) => ({ version: r.version, scope: r.scope, kind: r.kind, effectiveFrom: r.effectiveFrom, reason: r.scope === 'ORG' ? r.reason : null, spec: r.spec });
    const [defaults, orgRows] = await Promise.all([
      this.prisma.commissionRatePolicy.findMany({ where: { scope: 'DEFAULT', scopeRef: v.product, status: 'ACTIVE' }, orderBy: { effectiveFrom: 'desc' }, take: 50 }),
      this.prisma.commissionRatePolicy.findMany({ where: { scope: 'ORG', scopeRef: orgRef, status: 'ACTIVE' }, orderBy: { effectiveFrom: 'desc' }, take: 100 }),
    ]);
    return { orgRef, product: v.product, state: v.state, effective: v.effective, default: v.default, override: v.override, inheriting: v.inheriting, mode: v.mode, history: [...orgRows, ...defaults].sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime()).map(strip), version: await this.viewVersion(orgRef, v.product), asOf: now.toISOString() };
  }

  /** Monotonic version of an organisation's view for idempotent pushes: the newest decided row of either scope. */
  private async viewVersion(orgRef: string, product: string): Promise<string> {
    const [o, d] = await Promise.all([
      this.prisma.commissionRatePolicy.findFirst({ where: { scope: 'ORG', scopeRef: orgRef, status: { not: 'PENDING' } }, orderBy: { decidedAt: 'desc' }, select: { id: true, decidedAt: true } }),
      this.prisma.commissionRatePolicy.findFirst({ where: { scope: 'DEFAULT', scopeRef: product, status: { not: 'PENDING' } }, orderBy: { decidedAt: 'desc' }, select: { id: true, decidedAt: true } }),
    ]);
    const t = Math.max(o?.decidedAt?.getTime() ?? 0, d?.decidedAt?.getTime() ?? 0);
    return String(t);
  }

  // ───────────── org link (inherit on creation) ─────────────
  /** Idempotent: the organisation is linked to its product default the first time it is seen, recording which default version it inherited. */
  async ensureLink(orgRef: string, product: RateProduct, db: PrismaService | Tx = this.prisma) {
    const have = await db.commissionOrgRateLink.findUnique({ where: { orgRef } });
    if (have) return have;
    const d = await db.commissionRatePolicy.findFirst({ where: { scope: 'DEFAULT', scopeRef: product, status: 'ACTIVE', effectiveFrom: { lte: new Date() } }, orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }], select: { id: true, version: true } });
    return db.commissionOrgRateLink.upsert({ where: { orgRef }, create: { orgRef, product, defaultPolicyId: d?.id ?? null, defaultVersion: d?.version ?? null }, update: {} });
  }

  // ───────────── partner channel ─────────────
  private async enqueuePushes(tx: Tx, row: Row) {
    if (!this.outbox) return;
    const orgs = row.scope === 'ORG' ? [row.scopeRef] : (await tx.commissionOrgRateLink.findMany({ where: { product: row.product }, select: { orgRef: true }, take: 5000 })).map((l) => l.orgRef);
    for (const orgRef of orgs) await this.outbox.enqueue(tx, { type: RATE_PUSH_EVENT, target: 'KIORLY', aggregateType: 'CommissionRatePolicy', aggregateId: row.id, payload: { orgRef }, dedupeKey: `${RATE_PUSH_EVENT}:${row.id}:${orgRef}` });
  }

  /** Re-send every linked organisation's current view (ops action after a partner was down). Returns how many were queued. */
  async resync(product: string | undefined, actor: string): Promise<{ queued: number }> {
    const where = product ? { product: this.assertProduct(product) } : {};
    const links = await this.prisma.commissionOrgRateLink.findMany({ where, select: { orgRef: true }, take: 5000 });
    if (!this.outbox) return { queued: 0 };
    const stamp = Date.now().toString(36);
    for (const l of links) await this.outbox.enqueue(this.prisma, { type: RATE_PUSH_EVENT, target: 'KIORLY', aggregateType: 'CommissionOrgRateLink', aggregateId: l.orgRef, payload: { orgRef: l.orgRef }, dedupeKey: `${RATE_PUSH_EVENT}:resync:${l.orgRef}:${stamp}` });
    await this.audit(actor, 'commission.rate_resync', product ?? 'ALL', { queued: links.length });
    return { queued: links.length };
  }

  /** One idempotent POST of the organisation's view to its product (Clinic: the Kiorly marketplace API; Pharmacy / Lab: their partner API). The partner keeps the newest `version`. */
  private async pushToPartner(orgRef: string) {
    const link = await this.prisma.commissionOrgRateLink.findUnique({ where: { orgRef } });
    if (!link) return;
    const view = await this.partnerView(orgRef);
    const body = view as unknown as Record<string, unknown>;
    if (link.product === 'CLINIC') {
      if (!this.kiorly) return;
      await this.kiorly.recordCommissionRate(body);
    } else {
      if (!this.partners) return;
      await partnerRequest(await this.partners.conn(link.product as 'PHARMACY' | 'LAB', orgRef), { method: 'POST', path: '/commission-rates', body });
    }
    await this.prisma.commissionOrgRateLink.update({ where: { orgRef }, data: { lastPushedAt: new Date(), lastPushedVersion: view.version } });
  }
}
