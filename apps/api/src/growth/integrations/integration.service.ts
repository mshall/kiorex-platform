import { Injectable, Logger } from '@nestjs/common';
import { ApiError, badRequest, conflict, forbidden, notFound } from '../../common/errors';
import { newId } from '../../common/ids';
import { FlagsService } from '../../control-plane/control-plane-public';
import { OutboxService } from '../../outbox/outbox-public';
import { realAdapterFor, NeedsHumanError, UpstreamError, SECRET_REF } from '../../platform/platform-public';
import { PrismaService } from '../../prisma/prisma.service';
import { GrowthSpendService } from '../analytics/spend.service';
import { GrowthConfigService } from '../config/growth-config.service';
import { growthError } from '../growth-errors';
import { GROWTH_DEFAULT_MARKET } from '../growth-flags';
import { afterRun, allowRun, backoffMs, type BreakerState, type Circuit } from './circuit';
import { mockFor } from './mock/mock.adapter';
import { GROWTH_INTEGRATION_KINDS, INTEGRATION_META, PAID_KINDS, PULLS, type GrowthAdapter, type GrowthIntegrationKind, type MetricRow, type PullRange } from './port';

export interface IntegrationSetting { mode: 'mock' | 'real'; secretRef: string | null; accountLabel: string; pullSchedule: string; rateBudgetPerHour: number; retentionDays: number }
export type RunTrigger = 'SCHEDULE' | 'MANUAL';
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MARKET = /^[A-Z]{2}$/;
const day = (d: Date) => d.toISOString().slice(0, 10);
export const isKind = (k: string): k is GrowthIntegrationKind => (GROWTH_INTEGRATION_KINDS as readonly string[]).includes(k);
/** `secretRef` names a secret in Secrets Manager; ECS injects it as the environment variable of the same name upper-cased with `/` and `-` as `_` (the platform secret adapter convention). */
export const secretEnvName = (ref: string) => ref.toUpperCase().replace(/[^A-Z0-9]/g, '_');

export interface RunResult { runId: string | null; kind: GrowthIntegrationKind; mode: 'mock' | 'real'; status: 'OK' | 'PARTIAL' | 'FAILED' | 'SKIPPED'; rows: number; reason?: string; spendLines?: number }

/**
 * GRW-P2-F orchestration of the read-only marketing integrations: config from the INTEGRATION kind, the per-kind flag, circuit breaker, hourly rate budget, retry with jittered backoff,
 * idempotent persistence (a run replaces the rows of its own window and keys), run history and the `IntegrationRunFailed` event. It stores aggregates only; it never stores a credential,
 * a header or a response body (the run `error` column holds a short code).
 */
@Injectable()
export class IntegrationService {
  private readonly log = new Logger('growth-integrations');
  /** Test seam: replaces the adapter factory (error injection) and the sleep used between retries. */
  adapterOverride: ((kind: GrowthIntegrationKind, mode: 'mock' | 'real') => GrowthAdapter | null) | null = null;
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));
  constructor(private readonly prisma: PrismaService, private readonly config: GrowthConfigService, private readonly flags: FlagsService, private readonly outbox: OutboxService, private readonly spend: GrowthSpendService) {}

  async setting(kind: GrowthIntegrationKind, market: string): Promise<IntegrationSetting> {
    const cfg = await this.config.resolve('INTEGRATION', { market });
    const s = ((cfg.payload as { integrations?: Record<string, Partial<IntegrationSetting>> }).integrations ?? {})[kind] ?? {};
    return { mode: s.mode === 'real' ? 'real' : 'mock', secretRef: typeof s.secretRef === 'string' && SECRET_REF.test(s.secretRef) ? s.secretRef : null, accountLabel: String(s.accountLabel ?? ''), pullSchedule: String(s.pullSchedule ?? 'daily'), rateBudgetPerHour: Number(s.rateBudgetPerHour ?? 60), retentionDays: Number(s.retentionDays ?? 395) };
  }

  adapter(kind: GrowthIntegrationKind, s: IntegrationSetting): GrowthAdapter {
    const o = this.adapterOverride?.(kind, s.mode); if (o) return o;
    if (s.mode === 'mock') return mockFor(kind);
    return realAdapterFor(kind, { secretRef: s.secretRef, account: s.accountLabel, resolveSecret: async (ref) => process.env[secretEnvName(ref)] || null });
  }

  private async breaker(kind: GrowthIntegrationKind, market: string): Promise<BreakerState> {
    const h = await this.prisma.growthIntegrationHealth.findUnique({ where: { kind_market: { kind, market } } });
    return { circuit: (h?.circuit as Circuit) ?? 'CLOSED', consecutiveFailures: h?.consecutiveFailures ?? 0, lastErrorAt: h?.lastErrorAt ?? null };
  }

  /** Campaign keys (utm_campaign) the paid adapters report on: every campaign that has run or is running in the market. */
  async campaignKeys(market: string): Promise<string[]> {
    const rows = await this.prisma.growthCampaign.findMany({ where: { market, status: { in: ['ACTIVE', 'PAUSED', 'SCHEDULED', 'COMPLETED'] } }, select: { utmCampaign: true }, orderBy: { updatedAt: 'desc' }, take: 100 });
    return [...new Set(rows.map((r) => r.utmCampaign).filter(Boolean))];
  }

  validateRange(from?: string, to?: string, now = new Date()): PullRange {
    const t = to ?? day(now); const f = from ?? day(new Date(now.getTime() - 2 * 86_400_000));
    if (!ISO.test(f) || !ISO.test(t) || Number.isNaN(Date.parse(f)) || Number.isNaN(Date.parse(t))) throw growthError('GROWTH_INVALID_REQUEST', 'from and to must be YYYY-MM-DD');
    if (f > t) throw growthError('GROWTH_INVALID_REQUEST', 'from must not be after to');
    if (Date.parse(t) - Date.parse(f) > 92 * 86_400_000) throw growthError('GROWTH_INVALID_REQUEST', 'a pull covers at most 93 days');
    if (t > day(new Date(now.getTime() + 86_400_000))) throw growthError('GROWTH_INVALID_REQUEST', 'the window cannot end in the future');
    return { from: f, to: t };
  }

  /** One run of one integration. Idempotent: the same window and keys leave the same rows. */
  async run(kind: GrowthIntegrationKind, o: { market?: string; from?: string; to?: string; trigger: RunTrigger; actor: string; now?: Date }): Promise<RunResult> {
    const market = o.market && MARKET.test(o.market) ? o.market : GROWTH_DEFAULT_MARKET; const now = o.now ?? new Date();
    const s = await this.setting(kind, market);
    const flag = await this.flags.evaluate(`growth.integrations.${kind}`, { market });
    if (!flag.effective) return { runId: null, kind, mode: s.mode, status: 'SKIPPED', rows: 0, reason: 'FLAG_OFF' };
    const range = this.validateRange(o.from, o.to, now);
    const br = await this.breaker(kind, market); const gate = allowRun(br, now);
    if (!gate.allowed) return { runId: null, kind, mode: s.mode, status: 'SKIPPED', rows: 0, reason: 'CIRCUIT_OPEN' };
    const used = await this.prisma.growthIntegrationRun.count({ where: { kind, market, startedAt: { gte: new Date(now.getTime() - 3_600_000) } } });
    if (used >= s.rateBudgetPerHour) throw new ApiError(429, 'INTEGRATION_RATE_BUDGET', 'The hourly request budget of this integration is used up', { kind, budget: s.rateBudgetPerHour });

    const run = await this.prisma.growthIntegrationRun.create({ data: { id: newId('gir'), market, kind, mode: s.mode, windowFrom: new Date(`${range.from}T00:00:00Z`), windowTo: new Date(`${range.to}T00:00:00Z`), status: 'FAILED', startedAt: now } });
    const keys = PAID_KINDS.includes(kind) ? await this.campaignKeys(market) : [];
    const pr: PullRange = { ...range, dimensionKeys: keys, currency: 'EGP' };
    const adapter = this.adapter(kind, s);
    let rows: MetricRow[] = []; let failures = 0; let lastCode = ''; let lastWasNeedsHuman = false;
    for (const what of PULLS[kind]) {
      const fn = what === 'spend' ? adapter.pullSpend : what === 'performance' ? adapter.pullPerformance : adapter.pullCoreVitals;
      if (!fn) continue;
      try { rows = rows.concat(await this.withRetry(() => fn.call(adapter, pr))); }
      catch (e) { failures++; lastWasNeedsHuman = e instanceof NeedsHumanError; lastCode = e instanceof NeedsHumanError ? 'NEEDS_HUMAN' : e instanceof UpstreamError ? e.errorCode : 'UPSTREAM_ERROR'; this.log.warn(`${kind} ${what} failed: ${lastCode}`); }
    }
    const planned = PULLS[kind].length;
    let saved = 0; let spendLines = 0;
    try { saved = await this.store(kind, market, range, rows, s); if (s.mode === 'real' && PAID_KINDS.includes(kind)) spendLines = await this.spendLines(kind, market, rows, keys); }
    catch (e) { failures = Math.max(failures, 1); lastCode = 'STORE_ERROR'; this.log.warn(`${kind} store failed: ${(e as Error).message.slice(0, 80)}`); }
    const status: 'OK' | 'PARTIAL' | 'FAILED' = failures === 0 ? 'OK' : failures < planned && rows.length ? 'PARTIAL' : 'FAILED';
    await this.prisma.growthIntegrationRun.update({ where: { id: run.id }, data: { status, rows: saved, error: failures ? lastCode : null, finishedAt: new Date() } });
    const after = afterRun(br, status !== 'FAILED', now);
    await this.prisma.growthIntegrationHealth.upsert({ where: { kind_market: { kind, market } }, create: { kind, market, circuit: after.circuit, consecutiveFailures: after.consecutiveFailures, lastOkAt: status !== 'FAILED' ? now : null, lastErrorAt: status === 'FAILED' ? now : null }, update: { circuit: after.circuit, consecutiveFailures: after.consecutiveFailures, ...(status !== 'FAILED' ? { lastOkAt: now } : { lastErrorAt: now }) } });
    if (status === 'FAILED') await this.outbox.enqueue(this.prisma, { type: 'IntegrationRunFailed', aggregateType: 'GrowthIntegrationRun', aggregateId: run.id, payload: { kind, market, mode: s.mode, errorCode: lastCode || 'UPSTREAM_ERROR', consecutiveFailures: after.consecutiveFailures, at: now.toISOString(), aggregateType: 'GrowthIntegrationRun', aggregateId: run.id }, dedupeKey: `IntegrationRunFailed:${run.id}` });
    await this.prisma.auditLog.create({ data: { actor: o.actor, action: 'growth.integration.run', resource: 'GrowthIntegrationRun', resourceId: run.id, metadata: { kind, market, mode: s.mode, trigger: o.trigger, status, rows: saved, window: range, needsHuman: lastWasNeedsHuman } as never } });
    return { runId: run.id, kind, mode: s.mode, status, rows: saved, ...(failures ? { reason: lastCode } : {}), spendLines };
  }

  private async withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
    for (let i = 0; ; i++) {
      try { return await fn(); }
      catch (e) {
        const retryable = e instanceof UpstreamError && e.errorCode !== 'UPSTREAM_PARSE' && !(e.status && e.status >= 400 && e.status < 500 && e.status !== 429);
        if (!retryable || i >= attempts - 1) throw e;
        await this.sleep(backoffMs(i));
      }
    }
  }

  /** Replace the rows of the window for the keys and metrics this run produced (idempotent), inside one transaction. */
  private async store(kind: GrowthIntegrationKind, market: string, r: PullRange, rows: MetricRow[], s: IntegrationSetting): Promise<number> {
    const clean = rows.filter((x) => x.day >= r.from && x.day <= r.to && Number.isFinite(x.value));
    if (!clean.length) return 0;
    const dims = [...new Set(clean.map((x) => x.dimensionKey))]; const metrics = [...new Set(clean.map((x) => x.metric))];
    await this.prisma.$transaction(async (tx) => {
      await tx.growthExternalMetricDaily.deleteMany({ where: { market, kind, day: { gte: new Date(`${r.from}T00:00:00Z`), lte: new Date(`${r.to}T00:00:00Z`) }, dimensionKey: { in: dims }, metric: { in: metrics } } });
      for (let i = 0; i < clean.length; i += 500) await tx.growthExternalMetricDaily.createMany({ data: clean.slice(i, i + 500).map((x) => ({ market, kind, day: new Date(`${x.day}T00:00:00Z`), dimensionKey: x.dimensionKey.slice(0, 120), metric: x.metric, value: x.value, currency: x.currency ?? null })), skipDuplicates: true });
    }, { timeout: 30_000 });
    return clean.length;
  }

  /** Real paid-media spend becomes PENDING campaign spend lines (maker-checker still applies); adapter lines are de-duplicated by (campaignId, day, source, adapterRef). Mock mode never reaches here. */
  private async spendLines(kind: GrowthIntegrationKind, market: string, rows: MetricRow[], keys: string[]): Promise<number> {
    const camps = await this.prisma.growthCampaign.findMany({ where: { market, utmCampaign: { in: keys } }, select: { id: true, utmCampaign: true } });
    const byKey = new Map(camps.map((c) => [c.utmCampaign, c.id]));
    let n = 0;
    for (const r of rows.filter((x) => x.metric === 'spend_minor' && x.value > 0)) {
      const campaignId = byKey.get(r.dimensionKey); if (!campaignId) continue;
      try { await this.spend.create(`system:integration:${kind}`, { day: r.day, amountMinor: Math.round(r.value), campaignId, source: 'ADAPTER', adapterRef: `${kind}:${r.day}:${r.dimensionKey}`.slice(0, 120), channel: kind, market } as never); n++; }
      catch (e) { this.log.warn(`${kind} spend line skipped: ${(e as { code?: string }).code ?? 'error'}`); }
    }
    return n;
  }

  /** Aggregates older than the retention of the kind are deleted (25 months, 13 for Core Web Vitals and push health). */
  async purgeExpired(now = new Date()): Promise<number> {
    let n = 0;
    for (const kind of GROWTH_INTEGRATION_KINDS) {
      const months = INTEGRATION_META[kind].retentionMonths; const cut = new Date(now); cut.setUTCMonth(cut.getUTCMonth() - months);
      n += (await this.prisma.growthExternalMetricDaily.deleteMany({ where: { kind, day: { lt: cut } } })).count;
    }
    await this.prisma.growthIntegrationRun.deleteMany({ where: { startedAt: { lt: new Date(now.getTime() - 400 * 86_400_000) } } });
    return n;
  }

  // ───────────────────────── admin views ─────────────────────────
  async status(market: string) {
    const out = [];
    for (const kind of GROWTH_INTEGRATION_KINDS) {
      const s = await this.setting(kind, market); const meta = INTEGRATION_META[kind];
      const [h, last, flag] = await Promise.all([this.prisma.growthIntegrationHealth.findUnique({ where: { kind_market: { kind, market } } }), this.prisma.growthIntegrationRun.findFirst({ where: { kind, market }, orderBy: { startedAt: 'desc' } }), this.flags.evaluate(`growth.integrations.${kind}`, { market })]);
      const adapter = this.adapter(kind, s); const health = await adapter.health().catch(() => ({ ok: false, mode: s.mode, detail: 'unavailable' }));
      out.push({
        kind, label: meta.label, mode: s.mode, flagEffective: flag.effective, flagReason: flag.reason, secretRefSet: !!s.secretRef && !!process.env[secretEnvName(s.secretRef)], secretRefConfigured: !!s.secretRef, accountLabelSet: !!s.accountLabel,
        pullSchedule: s.pullSchedule, rateBudgetPerHour: s.rateBudgetPerHour, retentionMonths: meta.retentionMonths, location: meta.location, fallback: meta.fallback, defaultOff: meta.defaultOff,
        circuit: h?.circuit ?? 'CLOSED', consecutiveFailures: h?.consecutiveFailures ?? 0, lastOkAt: h?.lastOkAt?.toISOString() ?? null, lastErrorAt: h?.lastErrorAt?.toISOString() ?? null,
        lastRun: last ? { id: last.id, status: last.status, mode: last.mode, rows: last.rows, error: last.error, startedAt: last.startedAt.toISOString() } : null,
        health: { ok: health.ok, detail: health.detail }, connected: !!last && last.status !== 'FAILED' && flag.effective, synthetic: last?.mode === 'mock',
      });
    }
    return { market, integrations: out, rules: { secrets: 'Configuration holds secretRef names only; the API never returns a secret.', data: 'Aggregates only. No person-level field leaves the platform.', conversions: 'Conversion upload is off and not implemented in this phase.' } };
  }
  async runs(market: string, kind?: string, take = 50) {
    if (kind && !isKind(kind)) throw growthError('GROWTH_INVALID_REQUEST', 'Unknown integration kind');
    const rows = await this.prisma.growthIntegrationRun.findMany({ where: { market, ...(kind ? { kind } : {}) }, orderBy: { startedAt: 'desc' }, take: Math.min(200, Math.max(1, take)) });
    return rows.map((r) => ({ id: r.id, kind: r.kind, mode: r.mode, status: r.status, rows: r.rows, error: r.error, windowFrom: r.windowFrom ? day(r.windowFrom) : null, windowTo: r.windowTo ? day(r.windowTo) : null, startedAt: r.startedAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null }));
  }

  /** Real-mode manual pulls need two people: one asks, a different super admin confirms. */
  async requestRealRun(actor: string, kind: GrowthIntegrationKind, market: string, from?: string, to?: string) {
    const s = await this.setting(kind, market);
    if (s.mode !== 'real') throw badRequest('INTEGRATION_NOT_REAL', 'Only a real-mode integration needs a confirmation; a mock pull can run directly');
    const range = this.validateRange(from, to);
    const row = await this.prisma.auditLog.create({ data: { actor, action: 'growth.integration.run_request', resource: 'GrowthIntegration', resourceId: kind, metadata: { kind, market, ...range } as never } });
    return { requestId: row.id, kind, market, ...range };
  }
  async confirmRealRun(actor: string, kind: GrowthIntegrationKind, requestId: string) {
    const req = await this.prisma.auditLog.findUnique({ where: { id: requestId } });
    if (!req || req.action !== 'growth.integration.run_request' || req.resourceId !== kind) throw notFound('NOT_FOUND', 'Unknown run request');
    if (req.actor === actor) throw forbidden('MAKER_CHECKER', 'The person who asked for a real pull cannot confirm it');
    if (Date.now() - req.createdAt.getTime() > 3_600_000) throw conflict('REQUEST_EXPIRED', 'The request is older than one hour');
    const used = await this.prisma.auditLog.count({ where: { action: 'growth.integration.run_confirm', resourceId: requestId } });
    if (used) throw conflict('REQUEST_USED', 'This request was already confirmed');
    const m = req.metadata as { market: string; from: string; to: string };
    await this.prisma.auditLog.create({ data: { actor, action: 'growth.integration.run_confirm', resource: 'GrowthIntegration', resourceId: requestId, metadata: { kind } as never } });
    return this.run(kind, { market: m.market, from: m.from, to: m.to, trigger: 'MANUAL', actor });
  }
}
