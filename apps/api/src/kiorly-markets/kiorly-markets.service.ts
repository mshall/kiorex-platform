import { Injectable, Logger } from '@nestjs/common';
import { ApiError, badRequest, unavailable } from '../common/errors';
import { KiorlyClient, KiorlyHttpError, KiorlyTransientError } from '../kiorly/kiorly-public';
import { MarketService } from '../market/market-public';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../common/auth';

/** What the Kiorex side knows about the same country (the launch gate `market.<cc>.live`), shown read-only next to the Clinic market. */
export interface KiorexMarketState { known: boolean; live: boolean; state: string; flag: string | null }

const ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Allowed fields per change: nothing else is forwarded (a client cannot smuggle an actor, a status or any Market column through this route). */
const DECISION = ['reason', 'approvalRef', 'approvalLink'] as const;
const FIELDS = {
  create: [...DECISION, 'code', 'nameEn', 'nameAr', 'defaultCurrency', 'defaultTimezone', 'defaultLocale', 'defaultPhoneRegion', 'weekendDays', 'enabledLanguages', 'dataRegion', 'hostCell'],
  transition: [...DECISION, 'days'],
  taxPack: [...DECISION, 'invoiceVatPercent', 'saasVatPercent', 'defaultVisitFee', 'trnRequired', 'trnFormat'],
  legal: [...DECISION, 'crossBorderTransfer', 'pilotException'],
  second: [...DECISION, 'requireSecondApprover'],
  decide: ['note'],
} as const;

/**
 * Kiorly admin edition: market launch for the Kiorly markets (ADR-060). The Clinic owns the Market table; this service is a thin, role-gated, audited proxy over
 * the Clinic's signed `MARKET_ADMIN` route. It stores NO market state of its own (one source of truth); the only thing it keeps is its own audit row per change.
 */
@Injectable()
export class KiorlyMarketsService {
  private readonly log = new Logger('kiorly-markets');
  constructor(private readonly kiorly: KiorlyClient, private readonly prisma: PrismaService, private readonly markets: MarketService) {}

  private id(raw: string): string { if (!ID.test(raw)) throw badRequest('INVALID_ID', 'Invalid identifier'); return raw; }

  private pick(body: unknown, keys: readonly string[]): Record<string, unknown> {
    const b = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
    return Object.fromEntries(keys.filter((k) => b[k] !== undefined).map((k) => [k, b[k]]));
  }

  /** Clinic answers pass through with their own code; an unreachable Clinic is a clear 503, never a hang or a 500. */
  private async call<T>(method: string, path: string, opts: { body?: unknown; query?: Record<string, string | number | undefined> } = {}): Promise<T> {
    try {
      return (await this.kiorly.request<T>({ method, path: `/markets${path}`, body: opts.body, query: opts.query })).data;
    } catch (e) {
      if (e instanceof KiorlyHttpError) {
        const b = (e.body ?? {}) as { code?: string; message?: unknown; [k: string]: unknown };
        const nested = typeof b.message === 'object' && b.message ? (b.message as { code?: string; message?: string }) : undefined;
        const { code: _c, message: _m, statusCode: _s, ...rest } = b as Record<string, unknown>;
        throw new ApiError(e.status, String(b.code ?? nested?.code ?? e.code ?? `CLINIC_${e.status}`), typeof b.message === 'string' ? b.message : String(nested?.message ?? 'The Clinic refused the request'), rest);
      }
      if (e instanceof KiorlyTransientError) throw unavailable('CLINIC_UNAVAILABLE', 'The Clinic system is not reachable right now; nothing was changed. Try again in a moment.', { retryable: true, kind: e.kind });
      throw e;
    }
  }

  private async kiorex(): Promise<Map<string, KiorexMarketState>> {
    const out = new Map<string, KiorexMarketState>();
    try {
      for (const m of await this.markets.list()) out.set(m.code, { known: true, live: m.live, state: m.state, flag: m.flag });
    } catch (e) { this.log.warn(`kiorex market state unavailable: ${(e as Error).name}`); }
    return out;
  }
  private withKiorex<T extends { code: string }>(m: T, state: Map<string, KiorexMarketState>): T & { kiorex: KiorexMarketState } {
    return { ...m, kiorex: state.get(m.code.toUpperCase()) ?? { known: false, live: false, state: 'NOT_CONFIGURED', flag: null } };
  }

  async list(u: AuthUser) {
    const [items, state] = await Promise.all([this.call<Array<{ code: string }>>('GET', ''), this.kiorex()]);
    return { items: items.map((m) => this.withKiorex(m, state)), canChange: this.canChange(u) };
  }
  canChange(u: AuthUser): boolean { return u.roles.includes('super_admin'); }
  defaults() { return this.call<unknown[]>('GET', '/country-defaults'); }
  async one(rawId: string) {
    const id = this.id(rawId);
    const [r, state] = await Promise.all([this.call<{ market: { code: string } }>('GET', `/${id}`), this.kiorex()]);
    return { ...r, market: this.withKiorex(r.market, state) };
  }
  audit(rawId: string, q: { limit?: string; before?: string }) {
    const n = Number(q.limit);
    return this.call('GET', `/${this.id(rawId)}/audit`, { query: { limit: Number.isFinite(n) && n > 0 ? Math.min(200, Math.floor(n)) : undefined, before: q.before && q.before.length <= 40 ? q.before : undefined } });
  }
  requests(rawId: string, status?: string) { return this.call('GET', `/${this.id(rawId)}/change-requests`, { query: { status } }); }

  // ───────────── changes (super admin only; the controller enforces the role) ─────────────

  private async write<T>(u: AuthUser, action: string, resourceId: string | undefined, body: unknown, call: (withActor: Record<string, unknown>) => Promise<T>): Promise<T> {
    const clean = this.pick(body, FIELDS[action.startsWith('create') ? 'create' : action.startsWith('tax') ? 'taxPack' : action.startsWith('legal') ? 'legal' : action.startsWith('second') ? 'second' : action.startsWith('request') ? 'decide' : 'transition']);
    const actor = { id: u.sub, ...(u.email ? { email: u.email.slice(0, 200) } : {}) };
    const meta = { reason: typeof clean.reason === 'string' ? clean.reason.slice(0, 200) : null, approvalRef: typeof clean.approvalRef === 'string' ? clean.approvalRef.slice(0, 128) : null };
    try {
      const r = await call({ ...clean, actor });
      await this.prisma.auditLog.create({ data: { actor: u.sub, action: `kiorly.market.${action}`, resource: 'KiorlyMarket', resourceId, metadata: { outcome: 'OK', ...meta } } }).catch(() => undefined);
      return r;
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'ERROR';
      await this.prisma.auditLog.create({ data: { actor: u.sub, action: `kiorly.market.${action}`, resource: 'KiorlyMarket', resourceId, metadata: { outcome: 'REFUSED', code, ...meta } } }).catch(() => undefined);
      throw e;
    }
  }

  create(u: AuthUser, body: unknown) { return this.write(u, 'create', undefined, body, (b) => this.call('POST', '', { body: b })); }
  transition(u: AuthUser, rawId: string, verb: 'launch' | 'pause' | 'disable' | 'enable', body: unknown) { const id = this.id(rawId); return this.write(u, verb, id, body, (b) => this.call('POST', `/${id}/${verb}`, { body: b })); }
  taxPack(u: AuthUser, rawId: string, body: unknown) { const id = this.id(rawId); return this.write(u, 'taxPack', id, body, (b) => this.call('PUT', `/${id}/tax-pack`, { body: b })); }
  legal(u: AuthUser, rawId: string, body: unknown) { const id = this.id(rawId); return this.write(u, 'legal', id, body, (b) => this.call('PUT', `/${id}/legal-config`, { body: b })); }
  secondApprover(u: AuthUser, rawId: string, body: unknown) { const id = this.id(rawId); return this.write(u, 'secondApprover', id, body, (b) => this.call('PATCH', `/${id}/second-approver`, { body: b })); }
  decide(u: AuthUser, rawId: string, rawReq: string, verb: 'approve' | 'reject', body: unknown) {
    const id = this.id(rawId), rid = this.id(rawReq);
    return this.write(u, `request.${verb}`, id, body, (b) => this.call('POST', `/${id}/change-requests/${rid}/${verb}`, { body: b }));
  }
}
