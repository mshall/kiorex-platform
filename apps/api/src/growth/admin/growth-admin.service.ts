import { Inject, Injectable } from '@nestjs/common';
import { GROWTH_CONFIG_SCHEMAS, type GrowthConfigKind } from '@kiorex/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { providerEnv, providerProblems, PROVIDER_KINDS, type ProviderKind } from '../../common/providers/env';
import { FlagsService } from '../../control-plane/control-plane-public';
import { ApiError } from '../../common/errors';
import { growthError } from '../growth-errors';
import { growthLimits } from '../growth-limiter';
import { GrowthConfigService } from '../config/growth-config.service';
import { FRAUD_RULES } from '../fraud/touch-rules';
import { siteEnvironment } from './growth-env';
import { GROWTH_OVERVIEW_SOURCE, type GrowthOverviewSource } from './growth-overview.source';

const clampDays = (d: unknown, def = 30) => { const n = Number(d); return Number.isInteger(n) ? Math.min(90, Math.max(1, n)) : def; };
const clampTake = (t: unknown, def = 100, max = 200) => { const n = Number(t); return Number.isInteger(n) ? Math.min(max, Math.max(1, n)) : def; };
export const EDITABLE: GrowthConfigKind[] = Object.keys(GROWTH_CONFIG_SCHEMAS) as GrowthConfigKind[];
const MARKET = /^[A-Z]{2}$/;
export const marketOf = (m?: string) => (m && MARKET.test(m) ? m : 'EG');

/** Growth flag keys shown next to the integrations and market pages (read-only; switches stay in the flag control plane). */
const MARKETING_FLAGS = ['growth.marketing_messaging', 'growth.analytics_visitor', 'growth.campaigns', 'growth.patient_referral', 'growth.rewards'] as const;

/** Phase 2+ integrations: documented here so the console shows them honestly as planned, with no fake status. */
export const PLANNED_INTEGRATIONS = [
  { key: 'search_console', phase: 1, label: 'Google Search Console', direction: 'pull', note: 'Manual export in Phase 1; API pull in Phase 2' },
  { key: 'google_ads', phase: 3, label: 'Google Ads', direction: 'push conversions, pull spend', note: 'AnonymizedConversion only' },
  { key: 'meta_ads', phase: 3, label: 'Meta Ads', direction: 'pull spend', note: 'AnonymizedConversion only' },
  { key: 'tiktok_ads', phase: 3, label: 'TikTok Ads', direction: 'pull spend', note: 'AnonymizedConversion only' },
  { key: 'play_console', phase: 2, label: 'Google Play Console', direction: 'pull installs and ratings', note: 'Aggregates' },
  { key: 'app_store_connect', phase: 2, label: 'App Store Connect', direction: 'pull installs and ratings', note: 'Aggregates' },
] as const;

@Injectable()
export class GrowthAdminService {
  constructor(
    private readonly prisma: PrismaService, private readonly config: GrowthConfigService, private readonly flags: FlagsService,
    @Inject(GROWTH_OVERVIEW_SOURCE) private readonly overviewSource: GrowthOverviewSource,
  ) {}

  private audit(actor: string, action: string, resource: string, resourceId: string, metadata: Record<string, unknown>) {
    return this.prisma.auditLog.create({ data: { actor, action, resource, resourceId, metadata: metadata as never } });
  }

  // ───────────────────────── overview ─────────────────────────
  async overview(q: { market?: string; days?: unknown }) {
    const market = marketOf(q.market); const days = clampDays(q.days);
    const since = new Date(Date.now() - days * 86_400_000);
    const [data, health, fraudOpen, widgets, indexable, pages, slugs] = await Promise.all([
      this.overviewSource.overview({ market, days }),
      this.configHealth(market),
      this.prisma.growthFraudSignal.count({ where: { market, reviewStatus: 'OPEN' } }),
      this.prisma.widgetRegistration.count({ where: { market, status: 'ACTIVE' } }),
      this.prisma.growthLandingPage.count({ where: { market, indexable: true } }),
      this.prisma.growthLandingPage.count({ where: { market } }),
      this.prisma.growthSlug.count({ where: { market } }),
    ]);
    return { ...data, since: data.since ?? since.toISOString(), config: health, fraudOpen, activeWidgets: widgets, landingPages: { total: pages, indexable }, slugs };
  }

  /** One row per editable kind: what serves the market now, and what is waiting. */
  async configHealth(market: string) {
    const out = [];
    for (const kind of EDITABLE) {
      const r = await this.config.resolve(kind, { market });
      const [pending, scheduled] = await Promise.all([
        this.prisma.growthConfigVersion.count({ where: { kind, status: 'PENDING_APPROVAL' } }),
        this.prisma.growthConfigVersion.count({ where: { kind, status: 'APPROVED', effectiveFrom: { gt: new Date() } } }),
      ]);
      out.push({ kind, source: r.source, version: r.version, scope: r.scope, scopeId: r.scopeId, effectiveFrom: r.effectiveFrom?.toISOString() ?? null, pending, scheduled });
    }
    return out;
  }

  // ───────────────────────── channels ─────────────────────────
  async channels(q: { days?: unknown; market?: string }) {
    const market = marketOf(q.market); const days = clampDays(q.days);
    const since = new Date(Date.now() - days * 86_400_000);
    const [sources, touches] = await Promise.all([
      this.prisma.growthAcquisitionSource.findMany({ where: { market }, orderBy: [{ sourceKind: 'asc' }, { createdAt: 'desc' }], take: 500 }),
      this.prisma.growthTouchpoint.groupBy({ by: ['sourceId'], where: { market, occurredAt: { gte: since } }, _count: { _all: true }, _max: { occurredAt: true } }),
    ]);
    const byId = new Map(touches.map((t) => [t.sourceId, t]));
    const rows = sources.map((s) => ({ id: s.id, sourceKind: s.sourceKind, sourceRef: s.sourceRef, label: s.label, ownerOrgRef: s.ownerOrgRef, active: s.active, touches: byId.get(s.id)?._count._all ?? 0, lastTouchAt: byId.get(s.id)?._max.occurredAt?.toISOString() ?? null }));
    const kinds = new Map<string, { sourceKind: string; sources: number; active: number; touches: number }>();
    for (const r of rows) { const k = kinds.get(r.sourceKind) ?? { sourceKind: r.sourceKind, sources: 0, active: 0, touches: 0 }; k.sources++; if (r.active) k.active++; k.touches += r.touches; kinds.set(r.sourceKind, k); }
    return { days, market, kinds: [...kinds.values()], sources: rows };
  }
  async updateChannel(actor: string, id: string, patch: { active?: boolean; label?: string }) {
    const before = await this.prisma.growthAcquisitionSource.findUnique({ where: { id } });
    if (!before) throw growthError('GROWTH_INVALID_REQUEST', 'Unknown acquisition source');
    const next = await this.prisma.growthAcquisitionSource.update({ where: { id }, data: { ...(patch.active !== undefined ? { active: patch.active } : {}), ...(patch.label !== undefined ? { label: patch.label.slice(0, 120) || null } : {}) } });
    await this.audit(actor, 'growth.channel.update', 'GrowthAcquisitionSource', id, { sourceKind: before.sourceKind, sourceRef: before.sourceRef, active: [before.active, next.active], label: [before.label, next.label] });
    return { id: next.id, sourceKind: next.sourceKind, sourceRef: next.sourceRef, label: next.label, active: next.active };
  }

  // ───────────────────────── provider acquisition ─────────────────────────
  async providerAcquisition(q: { days?: unknown; market?: string }) {
    const market = marketOf(q.market); const days = clampDays(q.days);
    const since = new Date(Date.now() - days * 86_400_000);
    const [touches, byKind, owned] = await Promise.all([
      this.prisma.growthTouchpoint.groupBy({ by: ['providerOrgRef'], where: { market, occurredAt: { gte: since }, providerOrgRef: { not: null } }, _count: { _all: true }, orderBy: { _count: { providerOrgRef: 'desc' } }, take: 25 }),
      this.prisma.growthAcquisitionSource.groupBy({ by: ['sourceKind'], where: { market, ownerOrgRef: { not: null } }, _count: { _all: true } }),
      this.prisma.growthAcquisitionSource.count({ where: { market, ownerOrgRef: { not: null }, active: true } }),
    ]);
    return { days, market, ownedSources: owned, sourcesByKind: byKind.map((k) => ({ sourceKind: k.sourceKind, count: k._count._all })), topOrganisations: touches.map((t) => ({ orgRef: t.providerOrgRef as string, touches: t._count._all })) };
  }

  // ───────────────────────── SEO ─────────────────────────
  async seoStatus(q: { market?: string }) {
    const market = marketOf(q.market);
    const cfg = await this.config.resolve('SEO', { market });
    const p = cfg.payload as Record<string, unknown>;
    const [byType, lastRendered, slugCount, historyCount, thinReasons] = await Promise.all([
      this.prisma.growthLandingPage.groupBy({ by: ['pageType', 'indexable'], where: { market }, _count: { _all: true } }),
      this.prisma.growthLandingPage.aggregate({ where: { market }, _max: { lastRenderedAt: true } }),
      this.prisma.growthSlug.count({ where: { market } }),
      this.prisma.growthSlugHistory.count({ where: { market } }),
      this.prisma.growthLandingPage.findMany({ where: { market, indexable: false }, select: { guardResult: true }, take: 500 }),
    ]);
    const env = siteEnvironment();
    const indexable = byType.filter((r) => r.indexable).reduce((n, r) => n + r._count._all, 0);
    const thin = byType.filter((r) => !r.indexable).reduce((n, r) => n + r._count._all, 0);
    const reasonCounts = new Map<string, number>();
    for (const t of thinReasons) { const rs = (t.guardResult as { reasons?: string[] } | null)?.reasons ?? []; for (const r of rs) reasonCounts.set(r, (reasonCounts.get(r) ?? 0) + 1); }
    const shard = Number(p.sitemapShardSize) || 10000;
    return {
      market, config: { version: cfg.version, source: cfg.source, payload: p },
      thresholds: { minLiveProviders: p.minLiveProviders, minUniqueBlocks: p.minUniqueBlocks, maxSiblingSimilarityPercent: p.maxSiblingSimilarityPercent },
      robots: { environment: env, mode: env === 'production' ? 'ALLOW_PUBLIC' : 'DISALLOW_ALL', note: 'Only an explicit production environment is indexable (public site rule); every other environment disallows everything.' },
      sitemap: { indexablePages: indexable, shards: Math.max(1, Math.ceil(indexable / shard)), shardSize: shard, lastRenderedAt: lastRendered._max.lastRenderedAt?.toISOString() ?? null },
      pages: { total: indexable + thin, indexable, thin, byType: byType.map((r) => ({ pageType: r.pageType, indexable: r.indexable, count: r._count._all })), thinReasons: [...reasonCounts.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count) },
      slugs: { current: slugCount, history: historyCount },
      live: await this.selfFetchSite(),
    };
  }
  /** Best effort: ask this server for its own robots.txt and sitemap index, which is what a crawler would get. Never throws. */
  private async selfFetchSite() {
    const base = `http://127.0.0.1:${process.env.PORT ?? 4000}`;
    const get = async (path: string) => { try { const r = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(1500) }); return { status: r.status, text: (await r.text()).slice(0, 20_000) }; } catch { return null; } };
    const [robots, sitemap] = await Promise.all([get('/robots.txt'), get('/sitemap.xml')]);
    return { reachable: !!(robots || sitemap), robots: robots ? { status: robots.status, lines: robots.text.split('\n').slice(0, 12) } : null, sitemap: sitemap ? { status: sitemap.status, shards: (sitemap.text.match(/<loc>/g) ?? []).length } : null };
  }
  async slugs(q: { market?: string; q?: string; entityType?: string; take?: unknown }) {
    const market = marketOf(q.market);
    const rows = await this.prisma.growthSlug.findMany({ where: { market, ...(q.entityType ? { entityType: q.entityType } : {}), ...(q.q ? { slug: { contains: q.q.toLowerCase().slice(0, 60) } } : {}) }, orderBy: { updatedAt: 'desc' }, take: clampTake(q.take, 50) });
    const hist = await this.prisma.growthSlugHistory.findMany({ where: { market, OR: rows.map((r) => ({ entityType: r.entityType, entityId: r.entityId })).concat(rows.length ? [] : [{ entityType: '__none__', entityId: '__none__' }]) }, orderBy: { supersededAt: 'desc' } });
    const h = new Map<string, typeof hist>();
    for (const x of hist) { const k = `${x.entityType}:${x.entityId}`; h.set(k, [...(h.get(k) ?? []), x]); }
    return rows.map((r) => ({ id: r.id, entityType: r.entityType, entityId: r.entityId, slug: r.slug, updatedAt: r.updatedAt.toISOString(), history: (h.get(`${r.entityType}:${r.entityId}`) ?? []).map((x) => ({ slug: x.slug, replacedBy: x.replacedBy, supersededAt: x.supersededAt.toISOString() })) }));
  }
  async redirects(q: { market?: string; take?: unknown }) {
    const rows = await this.prisma.growthSlugHistory.findMany({ where: { market: marketOf(q.market) }, orderBy: { supersededAt: 'desc' }, take: clampTake(q.take, 100) });
    return rows.map((x) => ({ id: x.id, entityType: x.entityType, entityId: x.entityId, from: x.slug, to: x.replacedBy, status: x.replacedBy ? 301 : 410, supersededAt: x.supersededAt.toISOString() }));
  }
  async landingPages(q: { market?: string; indexable?: string; pageType?: string; take?: unknown }) {
    const market = marketOf(q.market);
    const where = { market, ...(q.indexable === 'true' ? { indexable: true } : q.indexable === 'false' ? { indexable: false } : {}), ...(q.pageType ? { pageType: q.pageType } : {}) };
    const [rows, total] = await Promise.all([this.prisma.growthLandingPage.findMany({ where, orderBy: { updatedAt: 'desc' }, take: clampTake(q.take, 100) }), this.prisma.growthLandingPage.count({ where })]);
    return { total, items: rows.map((r) => ({ id: r.id, pageType: r.pageType, locale: r.locale, params: r.params, indexable: r.indexable, reasons: ((r.guardResult as { reasons?: string[] } | null)?.reasons ?? []), lastRenderedAt: r.lastRenderedAt?.toISOString() ?? null })) };
  }

  // ───────────────────────── widgets ─────────────────────────
  async widgets(q: { market?: string }) {
    const market = marketOf(q.market);
    const [rows, policy, audit] = await Promise.all([
      this.prisma.widgetRegistration.findMany({ where: { market }, orderBy: { updatedAt: 'desc' }, take: 200 }),
      this.config.resolve('WIDGET_POLICY', { market }),
      this.prisma.auditLog.findMany({ where: { OR: [{ resource: 'WidgetRegistration' }, { action: { startsWith: 'growth.widget' } }] }, orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);
    return {
      market, policy: { version: policy.version, source: policy.source, payload: policy.payload },
      registrations: rows.map((r) => ({ id: r.id, orgRef: r.orgRef, orgSlug: r.orgSlug, origins: r.origins, status: r.status, syncedAt: r.syncedAt.toISOString() })),
      audit: audit.map((a) => ({ id: a.id, actor: a.actor, action: a.action, resourceId: a.resourceId, metadata: a.metadata, createdAt: a.createdAt.toISOString() })),
    };
  }
  async setWidgetStatus(actor: string, orgRef: string, status: 'ACTIVE' | 'DISABLED') {
    const before = await this.prisma.widgetRegistration.findUnique({ where: { orgRef } });
    if (!before) throw growthError('GROWTH_INVALID_REQUEST', 'Unknown widget registration');
    const next = await this.prisma.widgetRegistration.update({ where: { orgRef }, data: { status } });
    await this.audit(actor, 'growth.widget.status', 'WidgetRegistration', orgRef, { from: before.status, to: next.status, origins: next.origins.length });
    return { orgRef, status: next.status };
  }

  // ───────────────────────── templates ─────────────────────────
  /** The engagement and market modules depend on growth (through patient), so they are loaded lazily here: a static import would close an import cycle. */
  async templates() {
    const { TEMPLATES } = await import('../../engagement/engagement-public');
    return Object.entries(TEMPLATES).map(([kind, t]) => {
      const purpose = t.marketing ? 'MARKETING' : t.reminder ? 'REMINDER' : 'TRANSACTIONAL';
      return {
        kind, templateId: t.templateId, purpose, consentClass: purpose === 'MARKETING' ? 'MARKETING_CONSENT_PER_CHANNEL' : purpose === 'REMINDER' ? 'REMINDERS_CONSENT' : 'NONE_REQUIRED',
        quietHoursBypass: !!t.bypassQuiet, placeholders: [...new Set([...t.en.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))], hasEn: !!t.en, hasAr: !!t.ar,
        metaApproval: t.templateId.startsWith('TODO_NEEDS_HUMAN') ? 'NEEDS_HUMAN' : 'ID_SET', en: t.en, ar: t.ar,
      };
    });
  }

  // ───────────────────────── integrations ─────────────────────────
  /** Mode, readiness and secret REFERENCES (the NAME of the environment variable and whether it is set). Never a value, never a prefix, never a length. */
  async integrations(q: { market?: string }) {
    const market = marketOf(q.market);
    const mg = await this.config.resolve('MARKET_GROWTH', { market }).catch(() => null);
    const sel = ((mg?.payload as Record<string, unknown> | undefined)?.integrations ?? {}) as Record<string, boolean>;
    const providers = PROVIDER_KINDS.map((kind: ProviderKind) => {
      const e = providerEnv(kind);
      const secretRefs = [`${kind}_API_KEY`, `${kind}_WEBHOOK_SECRET`].map((name) => ({ name, set: !!process.env[name] }));
      return { kind, mode: e.mode, provider: e.provider, apiUrlSet: !!e.apiUrl, senderIdSet: !!e.senderId, secretRefs, problems: providerProblems(kind), ready: e.mode === 'mock' || providerProblems(kind).length === 0, selected: sel[kind.toLowerCase()] ?? null };
    });
    const flags = [];
    for (const key of MARKETING_FLAGS) { const r = await this.flags.evaluate(key, { market }); flags.push({ key, effective: r.effective, reason: r.reason }); }
    return { market, selection: sel, whatsappPhoneNumberIdRef: (mg?.payload as Record<string, unknown> | undefined)?.whatsappPhoneNumberIdRef ?? null, selectionVersion: mg?.version ?? null, selectionSource: mg?.source ?? null, providers, planned: PLANNED_INTEGRATIONS, flags, rule: 'Configuration stores secret reference names only. Mock adapters are the default until the real-provider go-live pass (NEEDS_HUMAN).' };
  }

  // ───────────────────────── fraud ─────────────────────────
  async fraudSignals(q: { market?: string; status?: string; ruleId?: string; take?: unknown }) {
    const market = marketOf(q.market);
    if (q.status && !['OPEN', 'CONFIRMED', 'DISMISSED'].includes(q.status)) throw growthError('GROWTH_INVALID_REQUEST', 'Unknown status');
    const where = { market, ...(q.status ? { reviewStatus: q.status } : {}), ...(q.ruleId ? { ruleId: q.ruleId } : {}) };
    const [rows, counts] = await Promise.all([this.prisma.growthFraudSignal.findMany({ where, orderBy: { createdAt: 'desc' }, take: clampTake(q.take, 100) }), this.prisma.growthFraudSignal.groupBy({ by: ['reviewStatus'], where: { market }, _count: { _all: true } })]);
    return {
      counts: Object.fromEntries(['OPEN', 'CONFIRMED', 'DISMISSED'].map((s) => [s, counts.find((c) => c.reviewStatus === s)?._count._all ?? 0])),
      items: rows.map((r) => ({ id: r.id, ruleId: r.ruleId, score: r.score, subject: r.subjectHash.slice(0, 10), evidenceRef: r.evidenceRef, createdAt: r.createdAt.toISOString(), reviewStatus: r.reviewStatus, reviewedBy: r.reviewedBy, reviewedAt: r.reviewedAt?.toISOString() ?? null, reviewNote: r.reviewNote })),
    };
  }
  async fraudThresholds(q: { market?: string }) {
    const pol = await this.config.resolve('ATTRIBUTION_POLICY', { market: marketOf(q.market) });
    const p = pol.payload as Record<string, unknown>;
    return {
      editable: false, note: 'Thresholds are code constants and attribution policy values today; a configurable fraud-threshold kind is planned for Phase 3 (fraud scoring and review).',
      rules: [
        { ruleId: FRAUD_RULES.CLICK_WITHOUT_RENDER, score: 20, threshold: `provider-owned touch with dwell < ${String(p.minDwellMsForProviderTouch)} ms`, source: 'ATTRIBUTION_POLICY.minDwellMsForProviderTouch', editableVia: 'ATTRIBUTION_POLICY' },
        { ruleId: FRAUD_RULES.BURST_PER_IP_HASH, score: 40, threshold: `more than ${growthLimits().burstPerMin} touches per minute from one rotating hash`, source: 'GROWTH_FRAUD_BURST_PER_MIN (environment)', editableVia: null },
        { ruleId: FRAUD_RULES.PROVIDER_LED_SHARE_JUMP, score: '50-100', threshold: 'provider-led share in the last 24 h is 35 points above the organisation 30-day baseline (min 10 recent and 30 baseline decisions)', source: 'code constants', editableVia: null },
      ],
      rule: 'A signal is evidence for review. It never changes an attribution decision by itself.',
    };
  }
  async reviewFraud(actor: string, id: string, status: 'CONFIRMED' | 'DISMISSED', note?: string) {
    const before = await this.prisma.growthFraudSignal.findUnique({ where: { id } });
    if (!before) throw growthError('GROWTH_INVALID_REQUEST', 'Unknown fraud signal');
    if (before.reviewStatus !== 'OPEN') throw new ApiError(409, 'GROWTH_CONFIG_TRANSITION_FORBIDDEN', 'This signal was already reviewed', { reviewStatus: before.reviewStatus });
    const r = await this.prisma.growthFraudSignal.updateMany({ where: { id, reviewStatus: 'OPEN' }, data: { reviewStatus: status, reviewedBy: actor, reviewedAt: new Date(), reviewNote: note?.slice(0, 300) ?? null } });
    if (!r.count) throw new ApiError(409, 'GROWTH_CONFIG_TRANSITION_FORBIDDEN', 'This signal was already reviewed');
    await this.audit(actor, 'growth.fraud.review', 'GrowthFraudSignal', id, { ruleId: before.ruleId, status, hasNote: !!note });
    return { id, reviewStatus: status };
  }

  // ───────────────────────── audit ─────────────────────────
  async auditLog(q: { action?: string; actor?: string; resource?: string; from?: string; to?: string; before?: string; take?: unknown }) {
    const when: { gte?: Date; lt?: Date } = {};
    for (const [k, v, key] of [['from', q.from, 'gte'], ['to', q.to, 'lt'], ['before', q.before, 'lt']] as const) {
      if (!v) continue; const d = new Date(v);
      if (Number.isNaN(d.getTime())) throw growthError('GROWTH_INVALID_REQUEST', `${k} must be an ISO date-time`);
      when[key] = key === 'lt' && when.lt ? new Date(Math.min(when.lt.getTime(), d.getTime())) : d;
    }
    const take = clampTake(q.take, 50);
    const rows = await this.prisma.auditLog.findMany({
      where: { AND: [{ OR: [{ action: { startsWith: 'growth.' } }, { resource: { startsWith: 'Growth' } }, { resource: 'WidgetRegistration' }] }, ...(q.action ? [{ action: { startsWith: q.action.slice(0, 80) } }] : []), ...(q.actor ? [{ actor: q.actor.slice(0, 80) }] : []), ...(q.resource ? [{ resource: q.resource.slice(0, 80) }] : []), ...(Object.keys(when).length ? [{ createdAt: when }] : [])] },
      orderBy: { createdAt: 'desc' }, take: take + 1,
    });
    const page = rows.slice(0, take);
    return { items: page.map((a) => ({ id: a.id, actor: a.actor, action: a.action, resource: a.resource, resourceId: a.resourceId, metadata: a.metadata, createdAt: a.createdAt.toISOString() })), nextBefore: rows.length > take ? page[page.length - 1]!.createdAt.toISOString() : null };
  }

  // ───────────────────────── markets ─────────────────────────
  async marketConfigs() {
    const { marketFacts } = await import('../../market/market-public');
    const defs = await this.prisma.flagDefinition.findMany({ where: { key: { startsWith: 'market.', endsWith: '.live' } }, select: { key: true } });
    const listed: Array<{ code: string; live: boolean; state: string }> = [];
    for (const cc of defs.map((d) => d.key.split('.')[1]!.toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)).sort()) { const r = await this.flags.evaluate(`market.${cc.toLowerCase()}.live`, { market: cc }); listed.push({ code: cc, live: r.effective, state: r.effective ? 'LIVE' : r.reason }); }
    const out = [];
    for (const m of listed) {
      const [growth, consent, attribution, seo, widget, districts, cities] = await Promise.all([
        this.config.resolve('MARKET_GROWTH', { market: m.code }).catch(() => null), this.config.resolve('CONSENT_DEFAULTS', { market: m.code }), this.config.resolve('ATTRIBUTION_POLICY', { market: m.code }),
        this.config.resolve('SEO', { market: m.code }), this.config.resolve('WIDGET_POLICY', { market: m.code }),
        this.prisma.growthSlug.count({ where: { market: m.code, entityType: 'DISTRICT' } }), this.prisma.growthSlug.count({ where: { market: m.code, entityType: 'CITY' } }),
      ]);
      const flags = [];
      for (const key of MARKETING_FLAGS) { const r = await this.flags.evaluate(key, { market: m.code }); flags.push({ key, effective: r.effective, reason: r.reason }); }
      const facts = marketFacts(m.code);
      const g = (growth?.payload ?? {}) as Record<string, unknown>; const c = consent.payload as Record<string, unknown>; const a = attribution.payload as Record<string, unknown>;
      const brief = (r: { version: number; source: string; scope: string } | null) => (r ? { version: r.version, source: r.source, scope: r.scope } : null);
      out.push({
        code: m.code, live: m.live, state: m.state, name: facts.name, currency: g.currency ?? facts.currency, phoneCode: g.phoneCode ?? facts.phoneCode, locales: g.locales ?? (seo.payload as Record<string, unknown>).locales,
        timeZone: c.quietHoursTimezone, quietHours: { start: c.quietHoursStart, end: c.quietHoursEnd }, consent: { regimeId: c.regimeId, maxMarketingPerDay: c.maxMarketingPerDay, maxMarketingPerWeek: c.maxMarketingPerWeek, withdrawalPropagationSeconds: c.withdrawalPropagationSeconds },
        retention: { touchEvidenceRetentionMonths: a.touchEvidenceRetentionMonths, unlinkedTouchRetentionMonths: a.unlinkedTouchRetentionMonths, visitorKeyMaxDays: a.visitorKeyMaxDays },
        marketing: { marketingLicenceConfirmed: g.marketingLicenceConfirmed ?? false, qrEnabled: g.qrEnabled ?? null, flags },
        geography: { geographyListRef: g.geographyListRef ?? null, cities, districts, note: 'District list is the market-pack list (NEEDS_HUMAN NH-040); this console only stores the reference.' },
        integrations: g.integrations ?? {}, versions: { MARKET_GROWTH: brief(growth), CONSENT_DEFAULTS: brief(consent), ATTRIBUTION_POLICY: brief(attribution), SEO: brief(seo), WIDGET_POLICY: brief(widget) },
      });
    }
    return out;
  }

  // ───────────────────────── analytics and finance ─────────────────────────
  async analytics(q: { market?: string; days?: unknown }) {
    const market = marketOf(q.market); const days = clampDays(q.days, 14);
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await this.prisma.$queryRaw<{ day: Date; name: string; n: number }[]>`SELECT date_trunc('day', "occurredAt")::date AS day, "name", count(*)::int AS n FROM "GrowthEvent" WHERE "market" = ${market} AND "occurredAt" >= ${since} GROUP BY 1, 2 ORDER BY 1 ASC, 2 ASC`;
    const decisions = await this.prisma.$queryRaw<{ day: Date; origin: string; n: number }[]>`SELECT date_trunc('day', "createdAt")::date AS day, "origin", count(*)::int AS n FROM "GrowthAttributionDecision" WHERE "market" = ${market} AND "createdAt" >= ${since} AND "supersedesId" IS NULL GROUP BY 1, 2 ORDER BY 1 ASC, 2 ASC`;
    return { market, days, source: 'internal', note: 'Raw growth tables. The analytics v1 rollup (package J) adds k-anonymity, dimensions and the metric definitions of KX-32 and will replace this view.', events: rows.map((r) => ({ day: r.day.toISOString().slice(0, 10), name: r.name, count: r.n })), decisions: decisions.map((r) => ({ day: r.day.toISOString().slice(0, 10), origin: r.origin, count: r.n })) };
  }
  async finance(q: { market?: string; days?: unknown }) {
    const market = marketOf(q.market); const days = clampDays(q.days);
    const since = new Date(Date.now() - days * 86_400_000);
    const origins = await this.prisma.growthAttributionDecision.groupBy({ by: ['origin'], where: { market, createdAt: { gte: since }, supersedesId: null }, _count: { _all: true } });
    const corrections = await this.prisma.growthAttributionDecision.count({ where: { market, createdAt: { gte: since }, supersedesId: { not: null } } });
    const count = (o: string) => origins.find((x) => x.origin === o)?._count._all ?? 0;
    let revenue: { charges: number; reversals: number; currency: string } | null = null;
    try {
      const rows = await this.prisma.$queryRaw<{ kind: string; n: number; sum: bigint | null; currency: string }[]>`SELECT "kind", count(*)::int AS n, sum("amountMinor") AS sum, max("currency") AS currency FROM "GrowthRevenueFact" WHERE "market" = ${market} AND "occurredAt" >= ${since} GROUP BY "kind"`;
      revenue = { charges: Number(rows.find((r) => r.kind === 'CHARGE')?.sum ?? 0), reversals: Number(rows.find((r) => r.kind === 'REVERSAL')?.sum ?? 0), currency: rows[0]?.currency ?? 'EGP' };
    } catch { revenue = null; /* package J's revenue facts are not in this database yet */ }
    return { market, days, decisions: { providerLed: count('PROVIDER_LED'), marketplace: count('MARKETPLACE'), unattributed: count('UNATTRIBUTED'), corrections }, revenueFacts: revenue, rule: 'Provider-led bookings never carry the platform fee and evidence can only remove a fee, never add one. Amounts live in the commission statements and the Fees page.' };
  }
}
