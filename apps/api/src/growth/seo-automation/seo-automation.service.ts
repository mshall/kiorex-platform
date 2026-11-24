import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { OutboxService } from '../../outbox/outbox-public';
import { PrismaService } from '../../prisma/prisma.service';
import { FlagsService } from '../../control-plane/control-plane-public';
import { isSpecialtyCode, SPECIALTY_LABELS } from '../../safety/safety-public';
import { enforceAnchorVariety, buildLinkGraph, findOrphans, fixOrphans, type LinkEdge } from './link-graph';
import type { GraphNode } from './link-rules';
import { pageId, type PageContent, type PageLocale } from './page-model';
import { pageKeyOf, pathOfKey } from './page-key';
import { runGate, summarise, type PageReport } from './quality-gate';
import { mergeSeoAutomation, SEO_AUTOMATION_DEFAULTS, type SeoAutomationConfig } from './seo-automation-config';
import { SEO_AUTOMATION_FLAG, SEO_SITE, type ComputedLinkGroup, type SeoQualityPort, type SeoSitePort } from './seo-automation-public';
import { visibleText } from './text';
import type { TemplateKey } from '../seo/seo-public';

const LOCALES: PageLocale[] = ['ar', 'en'];
export const DECISION_PREFIX = '~';
export const NOINDEX_MARK = `${DECISION_PREFIX}noindex`;
export const omitMark = (l: PageLocale): string => `${DECISION_PREFIX}omit:${l}`;
const bil = (en: string, ar?: string) => ({ en, ar: ar ?? en });
const TTL_MS = 30_000;

export interface RunResult { market: string; measured: boolean; pages: number; reports: number; failedPages: number; wouldNoindex: number; edges: number; orphans: number; orphansFixed: number; dropped: Record<string, number>; autoNoindex: boolean; reason?: string; /** the first findings with their detail, so a reviewer sees why without opening each page */ findings?: { pageKey: string; locale: string; check: string; detail: string; blocking: boolean }[] }

/**
 * SEO automation (GRW-P3-F): crawls the pages the sitemap lists (same load, same SSR bundle), runs the content-quality gate, builds the internal link graph, and stores both. The result is
 * READ by the request handler through the `SEO_QUALITY` port: it renders computed links, and ONLY when `SEO_AUTOMATION.autoNoindex` is on does it turn a failed page into noindex and drop
 * it from the sitemap. Without the SSR bundle nothing can be measured: the run says so (`measured: false`) and stores nothing, so a missing bundle never looks like a pass.
 */
@Injectable()
export class SeoAutomationService implements SeoQualityPort {
  private readonly log = new Logger('seo-automation');
  private cfgCache = new Map<string, { at: number; cfg: SeoAutomationConfig; version: number | null }>();
  private qCache = new Map<string, { at: number; auto: boolean; noindex: Set<string>; byLocale: Record<PageLocale, Set<string>>; omit: Map<string, PageLocale[]> }>();
  private lCache = new Map<string, { at: number; edges: Map<string, { toKey: string; anchorKind: string; rank: number }[]> }>();
  private labelCache = new Map<string, { at: number; labels: Map<string, { en: string; ar: string }> }>();

  constructor(private readonly prisma: PrismaService, @Inject(SEO_SITE) private readonly site: SeoSitePort, private readonly flags: FlagsService, private readonly outbox: OutboxService) {}

  invalidate(): void { this.cfgCache.clear(); this.qCache.clear(); this.lCache.clear(); this.labelCache.clear(); }

  async config(market = 'EG'): Promise<SeoAutomationConfig & { version: number | null }> {
    const hit = this.cfgCache.get(market);
    if (hit && Date.now() - hit.at < (process.env.NODE_ENV === 'test' ? 0 : 15_000)) return { ...hit.cfg, version: hit.version };
    let cfg = SEO_AUTOMATION_DEFAULTS(); let version: number | null = null; const now = new Date();
    try {
      const rows = await this.prisma.growthConfigVersion.findMany({ where: { kind: 'SEO_AUTOMATION', status: 'ACTIVE', OR: [{ scope: 'GLOBAL', scopeId: '' }, { scope: 'MARKET', scopeId: market }] }, orderBy: { version: 'asc' } });
      const live = rows.filter((r) => (!r.effectiveFrom || r.effectiveFrom <= now) && (!r.effectiveTo || r.effectiveTo > now));
      for (const scope of ['GLOBAL', 'MARKET'] as const) { const last = live.filter((r) => r.scope === scope).pop(); if (last) { cfg = mergeSeoAutomation(cfg, last.payload); version = last.version; } }
    } catch { /* defaults */ }
    this.cfgCache.set(market, { at: Date.now(), cfg, version });
    return { ...cfg, version };
  }

  // ───────────────────────── the port the request handler uses ─────────────────────────

  private async quality(market: string) {
    const hit = this.qCache.get(market);
    if (hit && Date.now() - hit.at < (process.env.NODE_ENV === 'test' ? 0 : TTL_MS)) return hit;
    const cfg = await this.config(market);
    const noindex = new Set<string>(); const omit = new Map<string, PageLocale[]>();
    if (cfg.autoNoindex && (await this.flags.isEnabled(SEO_AUTOMATION_FLAG, { market }).catch(() => true))) {
      const rows = await this.latestReports(market);
      for (const r of rows) {
        const id = pageId(r.pageKey, r.locale as PageLocale);
        if (r.failedChecks.includes(NOINDEX_MARK)) noindex.add(id);
        const om = r.failedChecks.filter((c) => c.startsWith(`${DECISION_PREFIX}omit:`)).map((c) => c.slice(DECISION_PREFIX.length + 5) as PageLocale);
        if (om.length) omit.set(id, om);
      }
    }
    const byLocale: Record<PageLocale, Set<string>> = { ar: new Set(), en: new Set() };
    for (const id of noindex) byLocale[id.endsWith('|ar') ? 'ar' : 'en'].add(id.slice(0, -3));
    const v = { at: Date.now(), auto: cfg.autoNoindex, noindex, byLocale, omit }; this.qCache.set(market, v); return v;
  }
  async blocked(market: string, pageKey: string, locale: PageLocale): Promise<boolean> { return (await this.quality(market)).noindex.has(pageId(pageKey, locale)); }
  async omittedAlternates(market: string, pageKey: string, locale: PageLocale): Promise<PageLocale[]> { return (await this.quality(market)).omit.get(pageId(pageKey, locale)) ?? []; }
  async blockedSet(market: string, locale: PageLocale): Promise<ReadonlySet<string>> { return (await this.quality(market)).byLocale[locale]; }

  /** The newest report of every page and locale (a content change writes a new row; an unchanged page is updated in place). */
  async latestReports(market: string) {
    return this.prisma.$queryRaw<{ pageKey: string; templateKind: string; locale: string; score: number; failedChecks: string[]; checkedAt: Date }[]>`
      SELECT DISTINCT ON ("pageKey", "locale") "pageKey", "templateKind", "locale", "score", "failedChecks", "checkedAt" FROM "SeoQualityReport" WHERE "market" = ${market} ORDER BY "pageKey", "locale", "checkedAt" DESC`;
  }

  private async linkMap(market: string) {
    const hit = this.lCache.get(market);
    if (hit && Date.now() - hit.at < (process.env.NODE_ENV === 'test' ? 0 : TTL_MS)) return hit.edges;
    const rows = await this.prisma.seoInternalLink.findMany({ where: { market }, orderBy: [{ fromKey: 'asc' }, { rank: 'asc' }, { toKey: 'asc' }] });
    const m = new Map<string, { toKey: string; anchorKind: string; rank: number }[]>();
    for (const r of rows) m.set(r.fromKey, [...(m.get(r.fromKey) ?? []), { toKey: r.toKey, anchorKind: r.anchorKind, rank: r.rank }]);
    this.lCache.set(market, { at: Date.now(), edges: m }); return m;
  }

  /** Anchor labels (both languages) of every page key of the market, from the same snapshot the pages are built from. */
  async labels(market: string): Promise<Map<string, { en: string; ar: string }>> {
    const hit = this.labelCache.get(market);
    if (hit && Date.now() - hit.at < 60_000) return hit.labels;
    const s = await this.site.snapshot(market); const labels = new Map<string, { en: string; ar: string }>();
    const sp = (code: string) => (isSpecialtyCode(code) ? SPECIALTY_LABELS[code] : bil(code));
    labels.set('home:', bil('Kiorex', 'كيوركس'));
    for (const f of s.facets) {
      const place = f.district ?? f.city; const spec = f.specialtyCode ? sp(f.specialtyCode) : null;
      const key = pageKeyOf(f.type, f.params);
      labels.set(key, spec && place ? bil(`${spec.en} in ${place.en}`, `${spec.ar} في ${place.ar}`) : spec ? bil(spec.en, spec.ar) : place ? bil(place.en, place.ar) : bil(key));
    }
    const dslugs = await this.site.slugs(market, 'DOCTOR', s.providers.map((p) => p.id)); const cslugs = await this.site.slugs(market, 'CLINIC', [...new Set(s.providers.map((p) => p.clinicId))]);
    for (const p of s.providers) { const slug = dslugs.get(p.id); if (slug) labels.set(`${p.careType === 'HOME_NURSING' ? 'nurse' : 'doctor'}:${slug}`, bil(p.nameEn ?? p.nameAr ?? slug, p.nameAr ?? p.nameEn ?? slug)); const c = cslugs.get(p.clinicId); if (c && !labels.has(`clinic:${c}`)) labels.set(`clinic:${c}`, bil(p.clinicNameEn ?? p.clinicNameAr ?? c, p.clinicNameAr ?? p.clinicNameEn ?? c)); }
    this.labelCache.set(market, { at: Date.now(), labels }); return labels;
  }

  async computedLinks(market: string, pageKey: string, locale: PageLocale): Promise<ComputedLinkGroup[]> {
    const edges = (await this.linkMap(market)).get(pageKey); if (!edges?.length) return [];
    const labels = await this.labels(market); const blocked = await this.blockedSet(market, locale);
    const groups = new Map<string, ComputedLinkGroup>();
    for (const e of edges) {
      const label = labels.get(e.toKey); if (!label || blocked.has(e.toKey)) continue;
      const g = groups.get(e.anchorKind) ?? { kind: e.anchorKind, links: [] };
      g.links.push({ label, path: pathOfKey(locale, market, e.toKey), count: 0 }); groups.set(e.anchorKind, g);
    }
    return [...groups.values()];
  }

  // ───────────────────────── the run ─────────────────────────

  private async crawl(market: string): Promise<{ pages: PageContent[]; nodes: GraphNode[]; entries: number }> {
    const cc = market.toLowerCase(); const host = this.site.host();
    const snap = await this.site.snapshot(market);
    const out: PageContent[] = []; const entryKeys = new Map<string, { type: string; rest: string; params: Record<string, string> }>();
    for (const e of await this.site.entries(market)) {
      const r = this.site.route(`/ar/${cc}${e.rest ? `/${e.rest}` : ''}`);
      if (r) entryKeys.set(pageKeyOf(r.type, r.params), { type: r.type, rest: e.rest, params: r.params });
    }
    const facetOf = new Map(snap.facets.map((f) => [pageKeyOf(f.type, f.params), f]));
    for (const [key, e] of [...entryKeys].sort(([a], [b]) => (a < b ? -1 : 1))) {
      for (const locale of LOCALES) {
        const cap = await this.site.capture(market, locale, e.rest);
        const expected = `${host}/${locale}/${cc}${e.rest ? `/${e.rest}` : ''}`;
        if (!cap || cap.status !== 200) { out.push({ pageKey: key, templateKind: e.type as TemplateKey, locale, expectedCanonical: expected, title: '', description: '', h1: [], text: '', jsonLd: [], canonical: '', alternates: [], robots: '', links: [], reviewMarkupRendered: false, visibleReviews: 0 }); continue; }
        const facet = facetOf.get(key);
        out.push({
          pageKey: key, templateKind: e.type as TemplateKey, locale, expectedCanonical: expected, title: cap.title, description: cap.description, h1: cap.h1, text: visibleText(cap.bodyHtml), jsonLd: cap.jsonLd, canonical: cap.canonical,
          alternates: cap.alternates, robots: cap.robots, links: cap.links, providerIds: facet?.providers.map((p) => p.id), liveProviders: facet?.providers.length,
          availableProviders: facet && ['same-day', 'telemedicine'].includes(e.type) ? facet.providers.length : undefined, reviewMarkupRendered: JSON.stringify(cap.jsonLd).includes('AggregateRating'), visibleReviews: cap.reviews,
        });
      }
    }
    // graph nodes from the same snapshot
    const nodes: GraphNode[] = [{ key: 'home:', type: 'home', linkable: true }];
    const providers = snap.providers;
    const dslugs = await this.site.slugs(market, 'DOCTOR', providers.map((p) => p.id)); const cslugs = await this.site.slugs(market, 'CLINIC', [...new Set(providers.map((p) => p.clinicId))]);
    const dKey = (p: (typeof providers)[number]): string | null => { const s = dslugs.get(p.id); return s ? `${p.careType === 'HOME_NURSING' ? 'nurse' : 'doctor'}:${s}` : null; };
    const q = (p: (typeof providers)[number]) => ({ quality: Math.round(p.ratingAvg * Math.log(1 + p.ratingCount) * 1000) / 1000, available: !!p.nextSlotAt && p.nextSlotAt > new Date() });
    const listingKeys = new Set([...entryKeys.keys()]);
    for (const f of snap.facets) {
      const key = pageKeyOf(f.type, f.params); if (!listingKeys.has(key)) continue;
      nodes.push({ key, type: f.type, linkable: true, providerCount: f.providers.length, doctors: f.providers.flatMap((p) => { const k = dKey(p); return k ? [{ key: k, ...q(p) }] : []; }) });
    }
    const byClinic = new Map<string, typeof providers>(); for (const p of providers) byClinic.set(p.clinicId, [...(byClinic.get(p.clinicId) ?? []), p]);
    for (const [clinicId, ps] of byClinic) { const c = cslugs.get(clinicId); if (c && listingKeys.has(`clinic:${c}`)) nodes.push({ key: `clinic:${c}`, type: 'clinic', linkable: true, clinicDoctors: ps.flatMap((p) => { const k = dKey(p); return k ? [{ key: k, ...q(p) }] : []; }) }); }
    for (const p of providers) {
      const k = dKey(p); if (!k || !listingKeys.has(k)) continue;
      const sp = p.specialtySlug; const city = p.citySlug; const area = p.areaSlug;
      nodes.push({ key: k, type: k.split(':')[0]!, linkable: true, clinicKey: cslugs.get(p.clinicId) ? `clinic:${cslugs.get(p.clinicId)}` : null, hubKeys: [sp && city && area ? `district:${sp}/${city}/${area}` : '', sp && city ? `city:${sp}/${city}` : '', sp ? `hub:${sp}` : ''].filter(Boolean) });
    }
    for (const [key, e] of entryKeys) if (['pharmacy', 'lab'].includes(e.type)) nodes.push({ key, type: e.type, linkable: true });
    return { pages: out, nodes: [...new Map(nodes.map((n) => [n.key, n])).values()], entries: entryKeys.size };
  }

  async run(o: { market?: string; persist?: boolean; actor?: string } = {}): Promise<RunResult> {
    const market = o.market ?? 'EG'; const persist = o.persist !== false;
    const cfg = await this.config(market);
    const base: RunResult = { market, measured: false, pages: 0, reports: 0, failedPages: 0, wouldNoindex: 0, edges: 0, orphans: 0, orphansFixed: 0, dropped: {}, autoNoindex: cfg.autoNoindex };
    if (!this.site.available()) return { ...base, reason: 'SSR_BUNDLE_MISSING' };
    const seo = (await this.site.snapshot(market)).seo;
    const { pages, nodes, entries } = await this.crawl(market);
    const gateOf = (orphans?: ReadonlySet<string>) => runGate({ pages, cfg, host: this.site.host(), reviewMarkupEnabled: seo.reviewMarkupEnabled, reviewMarkupMinCount: seo.reviewMarkupMinCount, minAvailableProviders: seo.minAvailableProviders, orphans });
    // pass 1: which pages fail; links only come from pages that pass; pass 2 adds the orphan check against the real inbound links of the passing pages
    const first = gateOf().reports; const failing = new Set(first.filter((r) => r.wouldNoindex).map((r) => r.pageKey));
    const linkable = nodes.map((n) => ({ ...n, linkable: !failing.has(n.key) }));
    const cc = market.toLowerCase(); const inbound = new Map<string, number>();
    for (const p of pages.filter((x) => x.locale === 'ar' && !failing.has(x.pageKey))) {
      for (const href of p.links) { const path = href.startsWith('/') ? href : new URL(href).pathname; const r = this.site.route(path.split('?')[0]!.replace(/^\/(ar|en)\//, '/ar/')); if (r) { const k = pageKeyOf(r.type, r.params); if (k !== p.pageKey) inbound.set(k, (inbound.get(k) ?? 0) + 1); } }
    }
    const orphans = findOrphans(linkable, inbound);
    const final = gateOf(new Set(orphans)).reports;
    const g = buildLinkGraph(linkable, { maxPerPage: cfg.links.maxPerPage, maxPerAnchorKind: cfg.links.maxPerAnchorKind, topDoctors: cfg.links.topDoctors, clinicDoctors: cfg.links.clinicDoctors, related: cfg.links.relatedSpecialties });
    const labels = await this.labels(market);
    const anchor = (k: string) => labels.get(k)?.en ?? k;
    const varied = enforceAnchorVariety(g.edges, anchor, cfg.links.minAnchorVariety);
    // a repaired orphan may be linked only from a parent that is itself linking; the repair edges join the stored set
    const fix = fixOrphans(orphans.filter((k) => !g.edges.some((e) => e.toKey === k)), linkable, varied.kept, { maxPerPage: cfg.links.maxPerPage });
    const edges: LinkEdge[] = [...varied.kept, ...fix];
    const res: RunResult = { ...base, measured: true, pages: entries, reports: final.length, failedPages: new Set(final.filter((r) => r.failedChecks.length).map((r) => r.pageKey)).size, wouldNoindex: final.filter((r) => r.wouldNoindex).length, edges: edges.length, orphans: orphans.length, orphansFixed: fix.length, dropped: { ...g.dropped, variety: varied.dropped.length } };
    res.findings = final.flatMap((r) => r.failedChecks.map((c) => ({ pageKey: r.pageKey, locale: r.locale, check: c, detail: r.details[c] ?? '', blocking: r.blockingFailed.includes(c) }))).slice(0, 60);
    if (!persist) return res;
    await this.persist(market, final, edges, o.actor ?? 'system:seo-automation');
    void cc;
    return res;
  }

  private async persist(market: string, reports: PageReport[], edges: LinkEdge[], actor: string) {
    const before = new Map((await this.latestReports(market)).map((r) => [pageId(r.pageKey, r.locale as PageLocale), r.failedChecks.join(',')]));
    for (const r of reports) {
      const failed = [...r.failedChecks, ...(r.wouldNoindex ? [NOINDEX_MARK] : []), ...r.omitAlternates.map(omitMark)];
      const data = { templateKind: r.templateKind, score: r.score, failedChecks: failed, checkedAt: new Date() };
      await this.prisma.seoQualityReport.upsert({ where: { market_pageKey_locale_contentHash: { market, pageKey: r.pageKey, locale: r.locale, contentHash: r.contentHash } }, create: { market, pageKey: r.pageKey, locale: r.locale, contentHash: r.contentHash, ...data }, update: data });
      if (r.blockingFailed.length && before.get(pageId(r.pageKey, r.locale)) !== failed.join(',')) {
        await this.outbox.enqueue(this.prisma, { type: 'SeoQualityGateFailed', aggregateType: 'SeoPage', aggregateId: `${r.pageKey}|${r.locale}`, target: 'INTERNAL', payload: { market, pageKey: r.pageKey, locale: r.locale, templateKind: r.templateKind, score: r.score, failedChecks: r.blockingFailed, wouldNoindex: r.wouldNoindex, at: new Date().toISOString() }, dedupeKey: createHash('sha256').update(`${market}|${r.pageKey}|${r.locale}|${r.contentHash}|${r.blockingFailed.join(',')}`).digest('hex').slice(0, 40) }).catch(() => undefined);
      }
    }
    // old reports of a page whose content changed stay as history for 30 days, then go
    await this.prisma.$executeRaw`DELETE FROM "SeoQualityReport" WHERE "market" = ${market} AND "checkedAt" < ${new Date(Date.now() - 30 * 86_400_000)}`;
    // the link graph is replaced as a set: new edges added, edges that are gone removed; an unchanged graph writes nothing
    const existing = await this.prisma.seoInternalLink.findMany({ where: { market }, select: { id: true, fromKey: true, toKey: true, anchorKind: true, rule: true, rank: true } });
    const ek = (e: { fromKey: string; toKey: string; anchorKind: string }) => `${e.fromKey}>${e.toKey}>${e.anchorKind}`;
    const want = new Map(edges.map((e) => [ek({ fromKey: e.fromKey, toKey: e.toKey, anchorKind: e.anchorKind }), e])); const have = new Map(existing.map((e) => [ek(e), e]));
    const gone = existing.filter((e) => !want.has(ek(e))).map((e) => e.id);
    const add = [...want].filter(([k]) => !have.has(k)).map(([, e]) => ({ market, fromKey: e.fromKey, toKey: e.toKey, anchorKind: e.anchorKind, rule: e.rule, rank: e.rank }));
    const changed = existing.filter((e) => { const w = want.get(ek(e)); return w && (w.rank !== e.rank || w.rule !== e.rule); });
    if (gone.length) await this.prisma.seoInternalLink.deleteMany({ where: { id: { in: gone } } });
    if (add.length) await this.prisma.seoInternalLink.createMany({ data: add, skipDuplicates: true });
    for (const c of changed) { const w = want.get(ek(c))!; await this.prisma.seoInternalLink.update({ where: { id: c.id }, data: { rank: w.rank, rule: w.rule, computedAt: new Date() } }); }
    await this.prisma.auditLog.create({ data: { actor, action: 'growth.seo_automation.run', resource: 'SeoQualityReport', resourceId: market, metadata: { reports: reports.length, edges: edges.length, added: add.length, removed: gone.length } } });
    this.invalidate(); this.site.refresh();
  }

  /** Summary for the ops Quality and Links tabs. */
  async overview(market = 'EG') {
    const cfg = await this.config(market); const rows = await this.latestReports(market);
    const reports = rows.map((r) => ({ pageKey: r.pageKey, templateKind: r.templateKind, locale: r.locale as PageLocale, score: r.score, failedChecks: r.failedChecks.filter((c) => !c.startsWith(DECISION_PREFIX)), blockingFailed: [] as never[], details: {}, contentHash: '', wouldNoindex: r.failedChecks.includes(NOINDEX_MARK), omitAlternates: [] as PageLocale[] }));
    const links = await this.prisma.seoInternalLink.groupBy({ by: ['rule'], where: { market }, _count: { _all: true } });
    const worst = [...rows].sort((a, b) => a.score - b.score || (a.pageKey < b.pageKey ? -1 : 1)).slice(0, 20).map((r) => ({ pageKey: r.pageKey, locale: r.locale, templateKind: r.templateKind, score: r.score, failedChecks: r.failedChecks.filter((c) => !c.startsWith(DECISION_PREFIX)), noindex: r.failedChecks.includes(NOINDEX_MARK), checkedAt: r.checkedAt }));
    const orphanPages = rows.filter((r) => r.failedChecks.includes('orphan') && r.locale === 'ar').map((r) => r.pageKey).sort();
    return { autoNoindex: cfg.autoNoindex, configVersion: cfg.version, measured: rows.length > 0, byTemplate: summarise(reports as PageReport[]), worst, pagesChecked: new Set(rows.map((r) => r.pageKey)).size, wouldNoindex: reports.filter((r) => r.wouldNoindex).length, links: { total: links.reduce((s, x) => s + x._count._all, 0), byRule: links.map((x) => ({ rule: x.rule, count: x._count._all })) }, orphans: orphanPages, bundleAvailable: this.site.available() };
  }
}
