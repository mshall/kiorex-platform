import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { signSnapshot, signWebhook as cSignWebhook } from '@kiorex/contracts';
import { FlagDefinition, FlagValue, Prisma } from '@prisma/client';
import { cfg } from '../common/config';
import { outboundFetch } from '../common/outbound-http';
import { decryptField, encryptField } from '../common/crypto';
import { badRequest, forbidden, notFound, conflict } from '../common/errors';
import { OutboxService } from '../outbox/outbox-public';
import { PrismaService } from '../prisma/prisma.service';
import { FLAG_CATALOGUE, FlagDef, FlagScope, PRODUCTS } from './flag-catalogue';
import { EvalContext, EvalResult, evaluateFlag, SnapshotFlag } from './flag-evaluator';
import { isSafetyControlKey } from './safety-controls';

export interface SetValueInput {
  key: string;
  scope: FlagScope;
  scopeId?: string;
  value: 'ON' | 'OFF';
  reason: string;
  ticket: string;
  expiresAt?: Date | null;
  startsAt?: Date | null;
  emergency?: boolean;
}

/** Dev/test evidence for flags that list gate ids is labelled `DEV-ONLY-NOT-A-REAL-GATE:<GATE>` (counts as that gate, never accepted in production). */
export const DEV_GATE_PREFIX = 'DEV-ONLY-NOT-A-REAL-GATE:';
const baseGateId = (id: string) => (id.startsWith(DEV_GATE_PREFIX) ? id.slice(DEV_GATE_PREFIX.length) : id);
const DEV_PRODUCT_SECRET = 'ff_dev_secret_change_me';
const EMERGENCY_REVIEW_MS = 24 * 3600_000;

interface Cache { at: number; version: number; map: Map<string, SnapshotFlag>; defs: Map<string, FlagDefinition> }

@Injectable()
export class FlagsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('flags');
  private cache?: Cache;
  private timer?: NodeJS.Timeout;
  constructor(private readonly prisma: PrismaService, private readonly outbox: OutboxService) {}

  onModuleInit() {
    this.outbox.register('flag.changed', (e) => this.deliverPush(e));
    if (cfg().jobsEnabled) {
      this.timer = setInterval(() => void this.sweep().catch((e) => this.log.error(e)), 30_000);
      this.timer.unref();
    }
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ───────────── evaluation (local, in-process) ─────────────

  invalidate() {
    this.cache = undefined;
  }

  private async load(): Promise<Cache> {
    if (this.cache && Date.now() - this.cache.at < 1000) return this.cache;
    const [defs, values, gates, state] = await Promise.all([
      this.prisma.flagDefinition.findMany(),
      this.prisma.flagValue.findMany({ where: { value: 'OFF' } }),
      this.prisma.flagGateEvidence.findMany(),
      this.prisma.controlState.findUnique({ where: { id: 1 } }),
    ]);
    const now = new Date();
    const gatesByFlag = new Map<string, Set<string>>();
    for (const g of gates) gatesByFlag.set(g.flagKey, (gatesByFlag.get(g.flagKey) ?? new Set()).add(baseGateId(g.gateId)));
    const map = new Map<string, SnapshotFlag>();
    for (const d of defs) {
      const f: SnapshotFlag = { key: d.key, class: d.class, scopes: d.scopes, dependsOn: d.dependsOn, launchLocked: d.launchLocked, gateSatisfied: !d.launchLocked || FlagsService.gatesSatisfied(d.gateIds, gatesByFlag.get(d.key)), values: { markets: {}, orgs: {} } };
      map.set(d.key, f);
    }
    let earliest = new Map<string, Date>();
    for (const v of values) {
      if (!this.isActive(v, now)) continue;
      const f = map.get(v.flagKey);
      if (!f) continue;
      if (v.scope === 'GLOBAL') f.values.global = 'OFF';
      else if (v.scope === 'MARKET') f.values.markets[v.scopeId.toUpperCase()] = 'OFF';
      else f.values.orgs[v.scopeId] = 'OFF';
      if (v.expiresAt && (!earliest.get(v.flagKey) || v.expiresAt < earliest.get(v.flagKey)!)) earliest.set(v.flagKey, v.expiresAt);
    }
    for (const [k, d] of earliest) map.get(k)!.expiresAt = d.toISOString();
    this.cache = { at: Date.now(), version: state?.version ?? 1, map, defs: new Map(defs.map((d) => [d.key, d])) };
    return this.cache;
  }

  /** Launch lock (ADR-024): when the definition names gate ids ALL must have human-recorded evidence (e.g. GHV1 + GHV2); otherwise any single evidence row satisfies it. */
  static gatesSatisfied(required: string[] | undefined, have: Set<string> | undefined): boolean {
    if (!have?.size) return false;
    return !required?.length || required.every((g) => have.has(g));
  }

  private isActive(v: FlagValue, now: Date) {
    return v.value === 'OFF' && (!v.startsAt || v.startsAt <= now) && (!v.expiresAt || v.expiresAt > now);
  }

  async evaluate(key: string, ctx: EvalContext = {}): Promise<EvalResult> {
    return evaluateFlag((await this.load()).map, key, ctx);
  }
  async isEnabled(key: string, ctx: EvalContext = {}): Promise<boolean> {
    return (await this.evaluate(key, ctx)).effective;
  }
  /** OFF contract: 403 FEATURE_DISABLED {key, scope} (KX-08 §08). Never used for reads of existing data. */
  async assertEnabled(key: string, ctx: EvalContext = {}): Promise<void> {
    const r = await this.evaluate(key, ctx);
    if (!r.effective) throw forbidden('FEATURE_DISABLED', 'Feature temporarily unavailable', { key, scope: r.scope ?? 'GLOBAL', reason: r.reason, ...(r.blockedBy ? { blockedBy: r.blockedBy } : {}) });
  }

  async currentVersion(): Promise<number> {
    return (await this.load()).version;
  }

  // ───────────── registry ─────────────

  async registerDefinition(actor: string, d: FlagDef) {
    if (isSafetyControlKey(d.key)) throw badRequest('SAFETY_CONTROL_NOT_A_FLAG', `ADR-025: "${d.key}" is a safety control and can never be a feature flag`);
    if (!/^[a-z0-9_.]+$/.test(d.key)) throw badRequest('INVALID_FLAG_KEY', 'Flag keys are lowercase [a-z0-9_.]');
    if (d.class === 'LAUNCH_LOCKED' && !d.launchLocked) d = { ...d, launchLocked: true };
    const row = await this.prisma.flagDefinition.upsert({
      where: { key: d.key },
      create: { key: d.key, product: d.product, class: d.class, scopes: d.scopes, dependsOn: d.dependsOn, launchLocked: !!d.launchLocked, moneyPath: !!d.moneyPath, description: d.description, whenOff: d.whenOff, gateHint: d.gateHint, gateIds: d.gateIds ?? [], edition: d.edition },
      update: { product: d.product, class: d.class, scopes: d.scopes, dependsOn: d.dependsOn, launchLocked: !!d.launchLocked, moneyPath: !!d.moneyPath, description: d.description, whenOff: d.whenOff, gateHint: d.gateHint, gateIds: d.gateIds ?? [], edition: d.edition },
    });
    await this.bump([d.key], actor, 'definition');
    return row;
  }

  /** Idempotent seed of the full KX-08 §09 catalogue + dev product keys. Never records gate evidence. */
  async seed(opts: { devKeys?: boolean } = { devKeys: true }) {
    for (const d of FLAG_CATALOGUE) {
      if (isSafetyControlKey(d.key)) throw new Error(`catalogue contains safety control ${d.key}`);
      await this.prisma.flagDefinition.upsert({
        where: { key: d.key },
        create: { key: d.key, product: d.product, class: d.class, scopes: d.scopes, dependsOn: d.dependsOn, launchLocked: !!d.launchLocked, moneyPath: !!d.moneyPath, description: d.description, whenOff: d.whenOff, gateHint: d.gateHint, gateIds: d.gateIds ?? [], edition: d.edition },
        update: { product: d.product, class: d.class, scopes: d.scopes, dependsOn: d.dependsOn, launchLocked: !!d.launchLocked, moneyPath: !!d.moneyPath, whenOff: d.whenOff, gateHint: d.gateHint, gateIds: d.gateIds ?? [], edition: d.edition },
      });
    }
    await this.prisma.controlState.upsert({ where: { id: 1 }, create: { id: 1, version: 1 }, update: {} });
    if (opts.devKeys !== false) {
      for (const p of PRODUCTS) {
        await this.prisma.productRegistration.upsert({
          where: { product: p },
          create: {
            product: p, keyId: `ff_${p}_dev`, secretEnc: encryptField(DEV_PRODUCT_SECRET),
            webhookUrl: p === 'kiorly-clinic' ? 'http://localhost:3010/api/v1/feature-flags/kiorex/changed' : null,
            webhookSecretEnc: encryptField(DEV_PRODUCT_SECRET),
          },
          update: {},
        });
      }
    }
    this.invalidate();
  }

  // ───────────── changes ─────────────

  private async def(key: string): Promise<FlagDefinition> {
    const d = (await this.load()).defs.get(key) ?? (await this.prisma.flagDefinition.findUnique({ where: { key } }));
    if (!d) throw notFound('FLAG_NOT_FOUND', `Unknown flag ${key}`);
    return d;
  }

  async setValue(actor: string, i: SetValueInput): Promise<{ status: 'APPLIED' | 'PENDING_APPROVAL'; requestId?: string; version?: number }> {
    const d = await this.def(i.key);
    const scopeId = i.scope === 'GLOBAL' ? '' : (i.scopeId ?? '').trim();
    if (!d.scopes.includes(i.scope)) throw badRequest('SCOPE_NOT_ALLOWED', `${i.key} cannot be set at ${i.scope} scope`, { allowed: d.scopes });
    if (i.scope !== 'GLOBAL' && !scopeId) throw badRequest('SCOPE_ID_REQUIRED', 'scopeId required for market/org scope');
    if (!i.reason?.trim() || !i.ticket?.trim()) throw badRequest('REASON_AND_TICKET_REQUIRED', 'reason and ticket are required (KXM-OP-08)');
    if (i.expiresAt && i.expiresAt <= new Date()) throw badRequest('EXPIRY_IN_PAST', 'expiresAt must be in the future');
    const sid = i.scope === 'MARKET' ? scopeId.toUpperCase() : scopeId;
    const twoPerson = i.value === 'OFF' && d.moneyPath && (i.scope === 'GLOBAL' || i.scope === 'MARKET');
    if (twoPerson && !i.emergency) {
      const req = await this.prisma.flagChangeRequest.create({ data: { flagKey: i.key, scope: i.scope, scopeId: sid, value: 'OFF', reason: i.reason, ticket: i.ticket, expiresAt: i.expiresAt ?? null, requestedBy: actor } });
      await this.auditRow({ flagKey: i.key, scope: i.scope, scopeId: sid, newValue: 'OFF', actor, reason: i.reason, ticket: i.ticket, event: 'REQUEST' });
      return { status: 'PENDING_APPROVAL', requestId: req.id };
    }
    const version = await this.apply(actor, d, i.scope, sid, i.value, i, !!(twoPerson && i.emergency));
    if (twoPerson && i.emergency) {
      await this.prisma.flagChangeRequest.create({ data: { flagKey: i.key, scope: i.scope, scopeId: sid, value: 'OFF', reason: i.reason, ticket: i.ticket, expiresAt: i.expiresAt ?? null, requestedBy: actor, status: 'APPROVED', approvedBy: actor, emergency: true, reviewDueAt: new Date(Date.now() + EMERGENCY_REVIEW_MS), decidedAt: new Date() } });
    }
    return { status: 'APPLIED', version };
  }

  private async apply(actor: string, d: FlagDefinition, scope: FlagScope, scopeId: string, value: 'ON' | 'OFF', i: { reason?: string; ticket?: string; expiresAt?: Date | null; startsAt?: Date | null }, emergency = false) {
    const prev = await this.prisma.flagValue.findUnique({ where: { flagKey_scope_scopeId: { flagKey: d.key, scope, scopeId } } });
    await this.prisma.flagValue.upsert({
      where: { flagKey_scope_scopeId: { flagKey: d.key, scope, scopeId } },
      create: { flagKey: d.key, scope, scopeId, value, reason: i.reason, ticket: i.ticket, setBy: actor, expiresAt: i.expiresAt ?? null, startsAt: i.startsAt ?? null },
      update: { value, reason: i.reason, ticket: i.ticket, setBy: actor, expiresAt: i.expiresAt ?? null, startsAt: i.startsAt ?? null },
    });
    await this.auditRow({ flagKey: d.key, scope, scopeId, oldValue: prev?.value ?? 'ON', newValue: value, actor, reason: i.reason, ticket: i.ticket, expiresAt: i.expiresAt ?? undefined, emergency, event: 'TOGGLE' });
    return this.bump([d.key], actor, `${d.key}:${scope}:${value}`);
  }

  async approveRequest(approver: string, id: string) {
    const r = await this.prisma.flagChangeRequest.findUnique({ where: { id } });
    if (!r) throw notFound('REQUEST_NOT_FOUND', 'Change request not found');
    if (r.status !== 'PENDING') throw conflict('REQUEST_NOT_PENDING', `Request is ${r.status}`);
    if (r.requestedBy === approver) throw forbidden('SECOND_APPROVER_REQUIRED', 'Two-person rule: a different admin must approve (KXM-OP-10)');
    const d = await this.def(r.flagKey);
    const version = await this.apply(approver, d, r.scope as FlagScope, r.scopeId, 'OFF', { reason: r.reason, ticket: r.ticket, expiresAt: r.expiresAt });
    await this.prisma.flagChangeRequest.update({ where: { id }, data: { status: 'APPROVED', approvedBy: approver, decidedAt: new Date() } });
    await this.auditRow({ flagKey: r.flagKey, scope: r.scope, scopeId: r.scopeId, newValue: 'OFF', actor: approver, reason: r.reason, ticket: r.ticket, event: 'APPROVE' });
    return { status: 'APPROVED', version };
  }

  async rejectRequest(actor: string, id: string) {
    const r = await this.prisma.flagChangeRequest.findUnique({ where: { id } });
    if (!r || r.status !== 'PENDING') throw notFound('REQUEST_NOT_FOUND', 'No pending request');
    await this.prisma.flagChangeRequest.update({ where: { id }, data: { status: 'REJECTED', approvedBy: actor, decidedAt: new Date() } });
    return { status: 'REJECTED' };
  }

  /** 24 h review of an emergency single-admin kill. */
  async reviewEmergency(reviewer: string, id: string) {
    const r = await this.prisma.flagChangeRequest.findUnique({ where: { id } });
    if (!r?.emergency) throw notFound('REQUEST_NOT_FOUND', 'Not an emergency change');
    await this.prisma.flagChangeRequest.update({ where: { id }, data: { reviewedBy: reviewer, reviewedAt: new Date() } });
    await this.auditRow({ flagKey: r.flagKey, scope: r.scope, scopeId: r.scopeId, newValue: 'OFF', actor: reviewer, reason: 'emergency review', event: 'REVIEW', emergency: true });
    return { status: 'REVIEWED' };
  }

  listRequests(status?: string) {
    return this.prisma.flagChangeRequest.findMany({ where: status ? { status } : {}, orderBy: { createdAt: 'desc' }, take: 200 });
  }
  async overdueEmergencyReviews() {
    return this.prisma.flagChangeRequest.findMany({ where: { emergency: true, reviewedAt: null, reviewDueAt: { lt: new Date() } } });
  }

  /**
   * Record launch-gate evidence (ADR-024). STOP action: only a human super admin calls this, through the HTTP route; application code
   * never records a gate (the dev seed may add DEV-ONLY-NOT-A-REAL-GATE rows). Flags whose definition lists gate ids (GHV1 + GHV2 ...) only
   * accept those ids, one evidence row per (flag, gate); the flag is effective once ALL required gates have evidence.
   */
  async recordGate(actor: string, key: string, g: { gateId: string; approver: string; approvedOn: Date; documentUrl: string }) {
    const d = await this.def(key);
    if (!d.launchLocked) throw badRequest('NOT_LAUNCH_LOCKED', `${key} is not launch-locked`);
    if (!g.gateId?.trim() || !g.approver?.trim() || !g.documentUrl?.trim() || !g.approvedOn) throw badRequest('GATE_EVIDENCE_INCOMPLETE', 'gateId, approver, approvedOn and documentUrl are required (KXM-OP-09)');
    if (!/^https?:\/\//i.test(g.documentUrl)) throw badRequest('GATE_DOCUMENT_URL_INVALID', 'documentUrl must be an http(s) link');
    const gateId = g.gateId.trim();
    if (gateId.startsWith(DEV_GATE_PREFIX) && cfg().isProd) throw badRequest('DEV_GATE_IN_PRODUCTION', 'DEV-ONLY gate evidence is never accepted in production');
    if (d.gateIds.length && !d.gateIds.includes(baseGateId(gateId))) throw badRequest('GATE_ID_NOT_REQUIRED', `${key} is unlocked by gate(s) ${d.gateIds.join(' + ')}, not ${gateId}`, { required: d.gateIds });
    await this.prisma.flagGateEvidence.upsert({ where: { flagKey_gateId: { flagKey: key, gateId } }, create: { flagKey: key, ...g, gateId, recordedBy: actor }, update: { ...g, gateId, recordedBy: actor } });
    await this.auditRow({ flagKey: key, scope: 'GLOBAL', newValue: 'GATE_SATISFIED', oldValue: 'AWAITING_GATE', actor, reason: `${gateId} approved by ${g.approver}`, event: 'GATE' });
    return { version: await this.bump([key], actor, `${key}:gate`) };
  }

  /** One human action for a gate shared by several flags (e.g. GHV1 unlocks clinic.home_visits and kiorex.home_visits): still one audited evidence row per flag. */
  async recordGateForAll(actor: string, gateId: string, g: { approver: string; approvedOn: Date; documentUrl: string }) {
    const defs = await this.prisma.flagDefinition.findMany({ where: { launchLocked: true, gateIds: { has: baseGateId(gateId) } } });
    if (!defs.length) throw notFound('GATE_NOT_FOUND', `No launch-locked flag lists gate ${gateId}`);
    let version = 0;
    for (const d of defs) version = (await this.recordGate(actor, d.key, { ...g, gateId })).version;
    return { gateId, flags: defs.map((d) => d.key), version };
  }

  async revokeGate(actor: string, key: string, reason: string, gateId?: string) {
    await this.def(key);
    await this.prisma.flagGateEvidence.deleteMany({ where: { flagKey: key, ...(gateId ? { OR: [{ gateId }, { gateId: `${DEV_GATE_PREFIX}${gateId}` }] } : {}) } });
    await this.auditRow({ flagKey: key, scope: 'GLOBAL', newValue: 'AWAITING_GATE', oldValue: 'GATE_SATISFIED', actor, reason: gateId ? `${gateId}: ${reason}` : reason, event: 'GATE' });
    return { version: await this.bump([key], actor, `${key}:gate-revoked`) };
  }

  /** Gate board for the super admin: every gate id, the flags it unlocks and who recorded what (no gate is ever implied). */
  async gateBoard() {
    const [defs, gates] = await Promise.all([this.prisma.flagDefinition.findMany({ where: { launchLocked: true }, orderBy: { key: 'asc' } }), this.prisma.flagGateEvidence.findMany()]);
    const ids = [...new Set(defs.flatMap((d) => d.gateIds))].sort();
    return {
      gates: ids.map((gateId) => ({
        gateId,
        flags: defs.filter((d) => d.gateIds.includes(gateId)).map((d) => {
          const ev = gates.find((x) => x.flagKey === d.key && baseGateId(x.gateId) === gateId);
          return { key: d.key, requiredGates: d.gateIds, evidence: ev ? { approver: ev.approver, approvedOn: ev.approvedOn, documentUrl: ev.documentUrl, recordedBy: ev.recordedBy } : null };
        }),
      })),
    };
  }

  private async auditRow(a: { flagKey: string; scope: string; scopeId?: string; oldValue?: string; newValue: string; actor: string; reason?: string; ticket?: string; expiresAt?: Date; emergency?: boolean; event: string }) {
    await this.prisma.flagAudit.create({ data: { flagKey: a.flagKey, scope: a.scope, scopeId: a.scopeId ?? '', oldValue: a.oldValue, newValue: a.newValue, actor: a.actor, reason: a.reason, ticket: a.ticket, expiresAt: a.expiresAt, emergency: !!a.emergency, event: a.event } });
  }

  /** Bump snapshot version and enqueue flag.changed push to every registered product (KXM-OP-11). */
  private async bump(keys: string[], actor: string, why: string): Promise<number> {
    const st = await this.prisma.controlState.upsert({ where: { id: 1 }, create: { id: 1, version: 2 }, update: { version: { increment: 1 }, updatedAt: new Date() } });
    this.invalidate();
    const regs = await this.prisma.productRegistration.findMany({ where: { active: true, webhookUrl: { not: null } } });
    for (const r of regs) {
      await this.outbox.enqueue(this.prisma, { type: 'flag.changed', aggregateType: 'Product', aggregateId: r.product, target: `PRODUCT:${r.product}`, payload: { product: r.product, version: st.version, keys, why, actor }, dedupeKey: `flag.changed:${r.product}:${st.version}` });
    }
    return st.version;
  }

  /** Expiry / scheduled-start sweep: expired OFFs revert to inherit (ON); transitions bump the snapshot version. */
  async sweep(): Promise<{ expired: number; started: number }> {
    const now = new Date();
    const expired = await this.prisma.flagValue.findMany({ where: { value: 'OFF', expiresAt: { lte: now } } });
    for (const v of expired) {
      await this.prisma.flagValue.update({ where: { id: v.id }, data: { value: 'ON', reason: `expired (was: ${v.reason ?? ''})` } });
      await this.auditRow({ flagKey: v.flagKey, scope: v.scope, scopeId: v.scopeId, oldValue: 'OFF', newValue: 'ON', actor: 'system', reason: 'expiry', event: 'EXPIRY' });
    }
    const sig = await this.prisma.kvState.findUnique({ where: { key: 'flags.sched' } });
    const started = await this.prisma.flagValue.findMany({ where: { value: 'OFF', startsAt: { lte: now, gt: new Date((sig?.value as any)?.at ?? 0) } } });
    await this.prisma.kvState.upsert({ where: { key: 'flags.sched' }, create: { key: 'flags.sched', value: { at: now.getTime() } }, update: { value: { at: now.getTime() } } });
    const keys = [...expired, ...started].map((v) => v.flagKey);
    if (keys.length) await this.bump(keys, 'system', 'sweep');
    return { expired: expired.length, started: started.length };
  }

  // ───────────── distribution ─────────────

  async productSecret(keyId: string) {
    const r = await this.prisma.productRegistration.findUnique({ where: { keyId } });
    if (!r || !r.active) return null;
    return { product: r.product, secret: decryptField(r.secretEnc) };
  }

  async snapshot(product: string, opts: { touch?: boolean } = {}) {
    const c = await this.load();
    const reg = await this.prisma.productRegistration.findUnique({ where: { product } });
    if (!reg) throw notFound('UNKNOWN_PRODUCT', `Unknown product ${product}`);
    // Nurse is an edition of Kiorly Clinic (ADR-031): nurse.* keys (product kiorly-nurse) are served in the kiorly-clinic snapshot.
    const own = [...c.defs.values()].filter((d) => d.product === product || d.product === 'all' || (product === 'kiorly-clinic' && d.product === 'kiorly-nurse')).map((d) => d.key);
    const include = new Set<string>();
    const visit = (k: string) => {
      if (include.has(k) || !c.map.has(k)) return;
      include.add(k);
      c.map.get(k)!.dependsOn.forEach(visit);
    };
    own.forEach(visit);
    const state = await this.prisma.controlState.findUnique({ where: { id: 1 } });
    const flags = [...include].sort().map((k) => {
      const f = c.map.get(k)!;
      return { key: f.key, class: f.class, scopes: f.scopes, dependsOn: f.dependsOn, launchLocked: f.launchLocked, gateSatisfied: f.gateSatisfied, values: f.values, ...(f.expiresAt ? { expiresAt: f.expiresAt } : {}) };
    });
    const generatedAt = (state?.updatedAt ?? new Date()).toISOString();
    const unsigned = { product, version: c.version, generatedAt, flags };
    const secret = decryptField(reg.secretEnc);
    const signature = signSnapshot(secret, unsigned);
    if (opts.touch) await this.prisma.productRegistration.update({ where: { product }, data: { lastFetchedVersion: c.version, lastFetchedAt: new Date() } });
    return { body: { ...unsigned, signature }, etag: `"v${c.version}:${product}"`, version: c.version };
  }

  private async deliverPush(e: { payload: any; aggregateId: string }) {
    const reg = await this.prisma.productRegistration.findUnique({ where: { product: e.aggregateId } });
    if (!reg?.webhookUrl) return;
    const secret = decryptField(reg.webhookSecretEnc ?? reg.secretEnc);
    // Contract envelope (kiorex-contracts events/flag.changed): Kiorly's receiver requires type === 'flag.changed' and data.product.
    const keys: string[] = e.payload.keys ?? [];
    const eventId = `flag.changed:${reg.product}:${e.payload.version}`;
    const body = JSON.stringify({
      eventId, type: 'flag.changed', aggregateType: 'Flag', aggregateId: keys[0] ?? reg.product, target: reg.product, occurredAt: new Date().toISOString(),
      data: { product: reg.product, key: keys[0] ?? '*', keys, snapshotVersion: e.payload.version, changedAt: new Date().toISOString(), reason: e.payload.why, actor: e.payload.actor },
    });
    const signed = cSignWebhook({ secret, body, eventType: 'flag.changed', eventId });
    try {
      const res = await outboundFetch(reg.webhookUrl, {
        method: 'POST',
        headers: { ...signed.headers }, // signed.headers already carries Content-Type; a second one made Express skip body parsing (no rawBody -> 401)
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await this.prisma.productRegistration.update({ where: { product: reg.product }, data: { lastPushedVersion: e.payload.version, lastPushedAt: new Date(), lastPushError: null } });
    } catch (err) {
      await this.prisma.productRegistration.update({ where: { product: reg.product }, data: { lastPushError: String(err).slice(0, 300) } });
      throw err;
    }
  }

  // ───────────── admin views ─────────────

  async propagation() {
    const [regs, state] = await Promise.all([this.prisma.productRegistration.findMany({ orderBy: { product: 'asc' } }), this.prisma.controlState.findUnique({ where: { id: 1 } })]);
    const cur = state?.version ?? 1;
    return {
      currentVersion: cur,
      products: regs.map((r) => {
        const age = r.lastFetchedAt ? Math.round((Date.now() - r.lastFetchedAt.getTime()) / 1000) : null;
        return {
          product: r.product, snapshotVersion: r.lastFetchedVersion, lastFetchedAt: r.lastFetchedAt, ageSeconds: age, versionsBehind: Math.max(0, cur - r.lastFetchedVersion),
          status: !r.lastFetchedAt ? 'NEVER_FETCHED' : r.lastFetchedVersion >= cur ? 'IN_SYNC' : age !== null && age > 60 ? 'STALE' : 'PROPAGATING',
          lastPush: { version: r.lastPushedVersion, at: r.lastPushedAt, error: r.lastPushError }, webhookConfigured: !!r.webhookUrl,
        };
      }),
    };
  }

  async listAdmin(opts: { market?: string; product?: string } = {}) {
    const [defs, values, gates, audits] = await Promise.all([
      this.prisma.flagDefinition.findMany({ where: opts.product ? { product: opts.product } : {}, orderBy: [{ product: 'asc' }, { key: 'asc' }] }),
      this.prisma.flagValue.findMany({ where: { value: 'OFF' } }),
      this.prisma.flagGateEvidence.findMany(),
      this.prisma.flagAudit.findMany({ orderBy: { createdAt: 'desc' }, take: 1000 }),
    ]);
    const c = await this.load();
    const market = (opts.market ?? 'EG').toUpperCase();
    return defs.map((d) => {
      const vals = values.filter((v) => v.flagKey === d.key && this.isActive(v, new Date()));
      const global = evaluateFlag(c.map, d.key, {});
      const marketEval = evaluateFlag(c.map, d.key, { market });
      const src = vals.find((v) => v.scope === 'GLOBAL') ?? vals.find((v) => v.scope === 'MARKET' && v.scopeId === market);
      const last = audits.find((a) => a.flagKey === d.key);
      const ev = gates.filter((g) => g.flagKey === d.key);
      const gate = ev[0];
      const missing = d.launchLocked ? (d.gateIds.length ? d.gateIds.filter((id) => !ev.some((e) => baseGateId(e.gateId) === id)) : ev.length ? [] : ['ANY']) : [];
      return {
        key: d.key, product: d.product, class: d.class, scopes: d.scopes, dependsOn: d.dependsOn, moneyPath: d.moneyPath, launchLocked: d.launchLocked, whenOff: d.whenOff, gateHint: d.gateHint,
        effective: { global: global.effective, market: { [market]: marketEval.effective } },
        state: marketEval.effective ? 'ON' : marketEval.reason === 'AWAITING_GATE' ? 'ON_AWAITING_GATE' : 'OFF',
        reason: marketEval.reason,
        source: src ? { scope: src.scope, scopeId: src.scopeId, reason: src.reason, ticket: src.ticket, setBy: src.setBy, expiresAt: src.expiresAt, at: src.updatedAt } : marketEval.reason === 'AWAITING_GATE' ? { scope: 'GATE' } : marketEval.reason === 'DEPENDENCY_OFF' ? { scope: 'DEPENDENCY', blockedBy: marketEval.blockedBy } : { scope: 'DEFAULT' },
        overrides: vals.map((v) => ({ scope: v.scope, scopeId: v.scopeId, reason: v.reason, ticket: v.ticket, expiresAt: v.expiresAt, startsAt: v.startsAt })),
        gate: gate ? { gateId: gate.gateId, approver: gate.approver, approvedOn: gate.approvedOn, documentUrl: gate.documentUrl } : null,
        gateIds: d.gateIds, edition: d.edition,
        gates: ev.map((e) => ({ gateId: e.gateId, approver: e.approver, approvedOn: e.approvedOn, documentUrl: e.documentUrl })),
        missingGates: missing,
        lastChange: last ? { at: last.createdAt, actor: last.actor, event: last.event, newValue: last.newValue, reason: last.reason } : null,
      };
    });
  }

  auditQuery(q: { flagKey?: string; from?: Date; to?: Date; limit?: number }) {
    const where: Prisma.FlagAuditWhereInput = { ...(q.flagKey ? { flagKey: q.flagKey } : {}), ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}) };
    return this.prisma.flagAudit.findMany({ where, orderBy: { createdAt: 'desc' }, take: q.limit ?? 1000 });
  }

  toCsv(rows: Record<string, unknown>[]): string {
    const cols = ['createdAt', 'flagKey', 'scope', 'scopeId', 'oldValue', 'newValue', 'actor', 'reason', 'ticket', 'expiresAt', 'emergency', 'event'];
    const esc = (v: unknown) => `"${String(v instanceof Date ? v.toISOString() : (v ?? '')).replace(/"/g, '""')}"`;
    return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  }
}
