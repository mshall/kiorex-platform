import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { cfg } from '../common/config';
import { badRequest, notFound } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { POLICY_DEFS, POLICY_KEYS, PROPOSED_DEFAULT_NOTE, PolicyKey, PolicyScope, PolicyValues } from './policy.defaults';

export type PolicySource = 'ORG' | 'MARKET' | 'GLOBAL' | 'PROPOSED_DEFAULT';
export interface Resolved<T> { key: string; value: T; source: PolicySource; proposedDefault: boolean; note?: string }
export interface PolicyScopeRef { market?: string; orgId?: string }
type Row = { key: string; scope: string; scopeId: string; value: unknown; note: string | null; updatedBy: string; updatedAt: Date };
type ValueOf<K extends PolicyKey> = PolicyValues[K];

/**
 * Policy resolver. Overrides live in PolicySetting (ops-editable per market / organisation); the in-code value is the PROPOSED_DEFAULT.
 * Reads are synchronous against a short-lived in-memory cache so hot paths (deposit computation) never wait on the DB; writes refresh the cache
 * immediately and other instances pick changes up within POLICY_CACHE_SECONDS.
 */
@Injectable()
export class PolicyService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('policy');
  private rows: Row[] = [];
  private loadedAt = 0;
  private timer?: NodeJS.Timeout;
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.refresh().catch((e) => this.log.warn(`initial policy load failed: ${(e as Error).message}`));
    this.timer = setInterval(() => void this.refresh().catch(() => undefined), Math.max(5, cfg().policyCacheSeconds) * 1000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async refresh() {
    this.rows = (await this.prisma.policySetting.findMany()) as Row[];
    this.loadedAt = Date.now();
  }
  /** Await before reading when a fresh view matters (tests, ops reads). */
  async ensureFresh(maxAgeMs = 2000) { if (Date.now() - this.loadedAt > maxAgeMs) await this.refresh(); }

  /** ORG > MARKET > GLOBAL > PROPOSED_DEFAULT. A stored value that no longer validates is ignored (the next level applies) and logged. */
  get<K extends PolicyKey>(key: K, scope: PolicyScopeRef = {}): Resolved<ValueOf<K>> {
    const def = POLICY_DEFS[key] as unknown as { validate(v: unknown): unknown; defaults: unknown };
    const market = scope.market?.toUpperCase();
    const order: Array<[PolicySource, string, string | undefined]> = [['ORG', 'ORG', scope.orgId], ['MARKET', 'MARKET', market], ['GLOBAL', 'GLOBAL', '']];
    for (const [source, s, id] of order) {
      if (id === undefined) continue;
      const row = this.rows.find((r) => r.key === key && r.scope === s && r.scopeId === id);
      if (!row) continue;
      try { return { key, value: def.validate(row.value) as ValueOf<K>, source, proposedDefault: false, note: row.note ?? undefined }; } catch (e) { this.log.warn(`ignoring invalid ${key} override at ${s}:${id}: ${(e as Error).message}`); }
    }
    return { key, value: def.defaults as ValueOf<K>, source: 'PROPOSED_DEFAULT', proposedDefault: true, note: PROPOSED_DEFAULT_NOTE };
  }

  /** Ops view for one market: resolved value, where it came from, every stored override, and the in-code default. */
  async describe(market: string) {
    await this.refresh();
    const cc = market.toUpperCase();
    return {
      market: cc, proposedDefaultNote: PROPOSED_DEFAULT_NOTE,
      items: POLICY_KEYS.map((key) => {
        const def = POLICY_DEFS[key]; const r = this.get(key, { market: cc }) as Resolved<unknown>;
        return {
          key, titleEn: def.titleEn, titleAr: def.titleAr, descriptionEn: def.descriptionEn, descriptionAr: def.descriptionAr,
          value: r.value as Record<string, unknown>, source: r.source, proposedDefault: r.proposedDefault, note: r.proposedDefault ? PROPOSED_DEFAULT_NOTE : (r.note ?? null),
          defaults: def.defaults as unknown as Record<string, unknown>, scopes: def.scopes,
          overrides: this.rows.filter((x) => x.key === key && (x.scope !== 'MARKET' || x.scopeId === cc)).map((x) => ({ scope: x.scope, scopeId: x.scopeId, value: x.value as Record<string, unknown>, note: x.note, updatedBy: x.updatedBy, updatedAt: x.updatedAt.toISOString() })),
        };
      }),
    };
  }

  private def(key: string) { const d = (POLICY_DEFS as Record<string, (typeof POLICY_DEFS)[PolicyKey]>)[key]; if (!d) throw notFound('POLICY_UNKNOWN', 'Unknown policy key'); return d; }
  private ref(scope: PolicyScope, scopeId?: string) {
    if (scope === 'GLOBAL') return '';
    const id = (scope === 'MARKET' ? scopeId?.toUpperCase() : scopeId)?.trim();
    if (!id) throw badRequest('SCOPE_ID_REQUIRED', `${scope} scope needs scopeId`);
    if (scope === 'MARKET' && !/^[A-Z]{2}$/.test(id)) throw badRequest('INVALID_MARKET', 'market must be an ISO 3166-1 alpha-2 code');
    return id;
  }

  async set(key: string, o: { scope: PolicyScope; scopeId?: string; value: unknown; note?: string }, actor: string) {
    const def = this.def(key);
    if (!def.scopes.includes(o.scope)) throw badRequest('INVALID_SCOPE', `${key} cannot be overridden at ${o.scope}`);
    let value: unknown;
    try { value = def.validate(o.value); } catch (e) { throw badRequest('INVALID_POLICY_VALUE', (e as Error).message); }
    const scopeId = this.ref(o.scope, o.scopeId);
    const before = this.rows.find((r) => r.key === key && r.scope === o.scope && r.scopeId === scopeId)?.value ?? null;
    await this.prisma.policySetting.upsert({ where: { key_scope_scopeId: { key, scope: o.scope, scopeId } }, create: { key, scope: o.scope, scopeId, value: value as object, note: o.note, updatedBy: actor }, update: { value: value as object, note: o.note, updatedBy: actor } });
    await this.prisma.auditLog.create({ data: { actor, action: 'policy.set', resource: 'PolicySetting', resourceId: `${key}:${o.scope}:${scopeId}`, metadata: { before, after: value as object, note: o.note ?? null } } });
    await this.refresh();
    return { key, scope: o.scope, scopeId, value };
  }

  async clear(key: string, o: { scope: PolicyScope; scopeId?: string }, actor: string) {
    this.def(key);
    const scopeId = this.ref(o.scope, o.scopeId);
    const r = await this.prisma.policySetting.deleteMany({ where: { key, scope: o.scope, scopeId } });
    if (r.count) await this.prisma.auditLog.create({ data: { actor, action: 'policy.clear', resource: 'PolicySetting', resourceId: `${key}:${o.scope}:${scopeId}`, metadata: {} } });
    await this.refresh();
    return { cleared: r.count };
  }
}
