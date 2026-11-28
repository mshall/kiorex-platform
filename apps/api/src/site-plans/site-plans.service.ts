import { Injectable, Logger } from '@nestjs/common';
import { cfg } from '../common/config';
import { ApiError, badRequest, conflict, unavailable } from '../common/errors';
import { outboundFetch } from '../common/outbound-http';
import type { AuthUser } from '../common/auth';
import { KiorlyClient, KiorlyHttpError, KiorlyTransientError } from '../kiorly/kiorly-public';
import { PrismaService } from '../prisma/prisma.service';
import { ProductPlansClient } from './product-plans.client';
import { contentToPublic, DEFAULT_CONTENT, productPublicPrices, mapClinicPlans, validateContent, type ContentConfig, type PublicModule, type PublicPlan, type PublicPlansResponse } from './site-plans.catalog';

const KEY = 'content';
const FRESH_MS = 60_000;
const STALE_MS = 24 * 3_600_000;
const FETCH_MS = 4_000;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const DEFAULT_MARKET = 'EG';

/** Fields forwarded to the Clinic per change. Nothing else is sent (an actor, a status or any other column cannot be smuggled through). */
const PLAN_FIELDS = ['nameEn', 'nameAr', 'isPublic', 'sortOrder'] as const;
const PRICE_FIELDS = ['marketId', 'currency', 'interval', 'unit', 'amount', 'includedClinicians', 'extraClinicianAmount', 'validFrom', 'newVersion', 'preview'] as const;

/**
 * Plans for the Kiorly site and for the Kiorly admin (ADR-060 pattern). The Clinic owns the plan catalogue; this service stores NO plan or price of its own. It
 * (1) reads the Clinic's public catalogue for the site, (2) is the audited, role-gated door to the Clinic's signed plan routes for the admin, and (3) keeps the one
 * thing nobody else holds: the site text of the Pharmacy and Lab editions (no prices), versioned and audited like the join-form settings.
 */
@Injectable()
export class SitePlansService {
  private readonly log = new Logger('site-plans');
  private clinicCache = new Map<string, { at: number; value: ReturnType<typeof mapClinicPlans> }>();
  private contentCache?: { at: number; config: ContentConfig };
  constructor(private readonly prisma: PrismaService, private readonly kiorly: KiorlyClient, private readonly products: ProductPlansClient) {}

  invalidate() { this.clinicCache.clear(); this.contentCache = undefined; this.products.invalidate(); }

  // ───────────── public ─────────────

  private marketCode(raw?: string): string {
    const c = (raw ?? '').trim().toUpperCase();
    if (!c) return DEFAULT_MARKET;
    if (!/^[A-Z]{2}$/.test(c)) throw badRequest('INVALID_MARKET', 'market must be a two-letter country code');
    return c;
  }

  private async clinicPublic(code: string): Promise<ReturnType<typeof mapClinicPlans> | null> {
    const hit = this.clinicCache.get(code);
    if (hit && Date.now() - hit.at < FRESH_MS) return hit.value;
    try {
      const origin = new URL(cfg().kiorlyBaseUrl).origin;
      const res = await outboundFetch(`${origin}/api/v1/public/plans?market=${encodeURIComponent(code)}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(FETCH_MS) });
      if (res.status === 404) { const v = { market: null, plans: [] }; this.clinicCache.set(code, { at: Date.now(), value: v }); return v; } // a market the Clinic does not know: no plans
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const value = mapClinicPlans(await res.json());
      this.clinicCache.set(code, { at: Date.now(), value });
      return value;
    } catch (e) {
      this.log.warn(`clinic public plans unavailable: ${(e as Error).message}`);
      return hit && Date.now() - hit.at < STALE_MS ? hit.value : null; // stale-if-error, up to a day; never an invented plan
    }
  }

  async content(): Promise<{ version: number; config: ContentConfig; updatedAt: Date | null; updatedBy: string | null; isDefault: boolean }> {
    const row = await this.prisma.sitePlanSetting.findUnique({ where: { key: KEY } });
    if (!row) return { version: 0, config: DEFAULT_CONTENT, updatedAt: null, updatedBy: null, isDefault: true };
    const v = validateContent(row.value);
    if (!v.ok) this.log.error(`stored plan content is invalid and ignored (defaults serve): ${v.errors[0]}`);
    return { version: row.version, config: v.ok ? v.config : DEFAULT_CONTENT, updatedAt: row.updatedAt, updatedBy: row.updatedBy, isDefault: !v.ok };
  }
  private async contentCached(): Promise<ContentConfig> {
    if (this.contentCache && Date.now() - this.contentCache.at < 15_000) return this.contentCache.config;
    const config = (await this.content()).config;
    this.contentCache = { at: Date.now(), config };
    return config;
  }

  async publicPlans(marketRaw?: string): Promise<PublicPlansResponse> {
    const code = this.marketCode(marketRaw);
    const [clinic, content, pharmacy, lab] = await Promise.all([this.clinicPublic(code), this.contentCached().catch(() => DEFAULT_CONTENT), this.products.cachedOverview('PHARMACY'), this.products.cachedOverview('LAB')]);
    const modules: PublicModule[] = [
      { id: 'clinic', status: clinic ? 'OK' : 'UNAVAILABLE', plans: clinic?.plans ?? [] },
      { id: 'pharmacy', status: 'OK', plans: contentToPublic('pharmacy', content, productPublicPrices(pharmacy, code)) },
      { id: 'lab', status: 'OK', plans: contentToPublic('lab', content, productPublicPrices(lab, code)) },
    ];
    return { contract: 'kiorly.public-plans.v1', generatedAt: new Date().toISOString(), market: clinic?.market ?? null, modules };
  }

  // ───────────── admin ─────────────

  canChange(u: AuthUser): boolean { return u.roles.includes('super_admin'); }

  /** The Clinic's signed plan routes (audited, role gated by the callers). Also used by the price proposals. */
  async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    try {
      return (await this.kiorly.request<T>({ method, path, body })).data;
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

  private id(raw: string): string { if (!ID.test(raw)) throw badRequest('INVALID_ID', 'Invalid identifier'); return raw; }
  private pick(body: unknown, keys: readonly string[]): Record<string, unknown> {
    const b = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
    return Object.fromEntries(keys.filter((k) => b[k] !== undefined).map((k) => [k, b[k]]));
  }

  async overview(u: AuthUser) {
    const [clinic, content] = await Promise.all([
      this.call<{ markets: unknown[]; plans: unknown[] }>('GET', '/plans').then((d) => ({ available: true as const, ...d })).catch((e) => ({ available: false as const, code: e instanceof ApiError ? e.code : 'ERROR', markets: [] as unknown[], plans: [] as unknown[] })),
      this.content(),
    ]);
    return { canChange: this.canChange(u), clinic, content: { ...content, defaults: DEFAULT_CONTENT } };
  }

  private async audit<T>(u: AuthUser, action: string, resourceId: string | undefined, meta: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
    try {
      const r = await run();
      await this.prisma.auditLog.create({ data: { actor: u.sub, action: `kiorly.plans.${action}`, resource: 'KiorlyPlans', resourceId, metadata: { outcome: 'OK', ...meta } as never } }).catch(() => undefined);
      this.invalidate();
      return r;
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'ERROR';
      await this.prisma.auditLog.create({ data: { actor: u.sub, action: `kiorly.plans.${action}`, resource: 'KiorlyPlans', resourceId, metadata: { outcome: 'REFUSED', code, ...meta } as never } }).catch(() => undefined);
      throw e;
    }
  }

  patchClinicPlan(u: AuthUser, rawId: string, body: unknown) {
    const id = this.id(rawId);
    const clean = this.pick(body, PLAN_FIELDS);
    if (!Object.keys(clean).length) throw badRequest('NOTHING_TO_CHANGE', 'Send at least one of nameEn, nameAr, isPublic, sortOrder');
    return this.audit(u, 'clinic_plan', id, { fields: Object.keys(clean) }, () => this.call('PATCH', `/plans/${id}`, { ...clean, actor: this.actor(u) }));
  }

  /** Direct publishing is gone (maker-checker): only the preview stays on this route; a price is proposed and a second super admin approves it. */
  publishClinicPrice(u: AuthUser, rawId: string, body: unknown) {
    const id = this.id(rawId);
    const clean = this.pick(body, PRICE_FIELDS);
    if (clean.preview !== true) throw conflict('PROPOSAL_REQUIRED', 'A price is proposed first and approved by a second super admin; it is not published directly', { next: 'POST /admin/kiorly-plans/proposals' });
    return this.audit(u, 'clinic_price_preview', id, { marketId: clean.marketId ?? null, interval: clean.interval ?? null, unit: clean.unit ?? null, amount: clean.amount ?? null, currency: clean.currency ?? null, validFrom: clean.validFrom ?? null }, () => this.call('POST', `/plans/${id}/prices`, { ...clean, actor: this.actor(u) }));
  }

  private actor(u: AuthUser) { return { id: u.sub, ...(u.email ? { email: u.email.slice(0, 200) } : {}) }; }

  async saveContent(u: AuthUser, b: { version?: unknown; config?: unknown }) {
    const v = validateContent(b?.config);
    if (!v.ok) throw badRequest('INVALID_PLAN_CONTENT', 'The plan text is not valid', { errors: v.errors });
    const expected = typeof b.version === 'number' && Number.isInteger(b.version) && b.version >= 0 ? b.version : -1;
    if (expected < 0) throw badRequest('VERSION_REQUIRED', 'Send the version you opened');
    return this.audit(u, 'content', KEY, { expectedVersion: expected }, async () => {
      const cur = await this.content();
      if (cur.version !== expected) throw conflict('PLAN_CONTENT_STALE', 'The plan text changed since you opened it: reload and try again', { version: cur.version });
      const next = cur.version + 1;
      const changed = (['pharmacy', 'lab'] as const).filter((m) => JSON.stringify(v.config[m]) !== JSON.stringify(cur.config[m]));
      if (cur.version === 0) await this.prisma.sitePlanSetting.create({ data: { key: KEY, value: v.config as never, version: next, updatedBy: u.sub } });
      else {
        const r = await this.prisma.sitePlanSetting.updateMany({ where: { key: KEY, version: cur.version }, data: { value: v.config as never, version: next, updatedBy: u.sub } });
        if (!r.count) throw conflict('PLAN_CONTENT_STALE', 'The plan text changed since you opened it: reload and try again');
      }
      this.log.log(`plan content v${next} saved (${changed.join(',') || 'no change'})`);
      return this.content();
    });
  }
}

export type { PublicPlan };
