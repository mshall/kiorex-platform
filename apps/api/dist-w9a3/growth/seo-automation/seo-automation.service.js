"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SeoAutomationService = exports.omitMark = exports.NOINDEX_MARK = exports.DECISION_PREFIX = void 0;
const market_core_public_1 = require("../../market/market-core-public");
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const outbox_public_1 = require("../../outbox/outbox-public");
const prisma_service_1 = require("../../prisma/prisma.service");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const safety_public_1 = require("../../safety/safety-public");
const link_graph_1 = require("./link-graph");
const page_model_1 = require("./page-model");
const page_key_1 = require("./page-key");
const quality_gate_1 = require("./quality-gate");
const seo_automation_config_1 = require("./seo-automation-config");
const seo_automation_public_1 = require("./seo-automation-public");
const text_1 = require("./text");
const LOCALES = ['ar', 'en'];
exports.DECISION_PREFIX = '~';
exports.NOINDEX_MARK = `${exports.DECISION_PREFIX}noindex`;
const omitMark = (l) => `${exports.DECISION_PREFIX}omit:${l}`;
exports.omitMark = omitMark;
const bil = (en, ar) => ({ en, ar: ar ?? en });
const TTL_MS = 30_000;
let SeoAutomationService = class SeoAutomationService {
    prisma;
    site;
    flags;
    outbox;
    log = new common_1.Logger('seo-automation');
    cfgCache = new Map();
    qCache = new Map();
    lCache = new Map();
    labelCache = new Map();
    constructor(prisma, site, flags, outbox) {
        this.prisma = prisma;
        this.site = site;
        this.flags = flags;
        this.outbox = outbox;
    }
    invalidate() { this.cfgCache.clear(); this.qCache.clear(); this.lCache.clear(); this.labelCache.clear(); }
    async config(market = market_core_public_1.DEFAULT_MARKET) {
        const hit = this.cfgCache.get(market);
        if (hit && Date.now() - hit.at < (process.env.NODE_ENV === 'test' ? 0 : 15_000))
            return { ...hit.cfg, version: hit.version };
        let cfg = (0, seo_automation_config_1.SEO_AUTOMATION_DEFAULTS)();
        let version = null;
        const now = new Date();
        try {
            const rows = await this.prisma.growthConfigVersion.findMany({ where: { kind: 'SEO_AUTOMATION', status: 'ACTIVE', OR: [{ scope: 'GLOBAL', scopeId: '' }, { scope: 'MARKET', scopeId: market }] }, orderBy: { version: 'asc' } });
            const live = rows.filter((r) => (!r.effectiveFrom || r.effectiveFrom <= now) && (!r.effectiveTo || r.effectiveTo > now));
            for (const scope of ['GLOBAL', 'MARKET']) {
                const last = live.filter((r) => r.scope === scope).pop();
                if (last) {
                    cfg = (0, seo_automation_config_1.mergeSeoAutomation)(cfg, last.payload);
                    version = last.version;
                }
            }
        }
        catch { }
        this.cfgCache.set(market, { at: Date.now(), cfg, version });
        return { ...cfg, version };
    }
    async quality(market) {
        const hit = this.qCache.get(market);
        if (hit && Date.now() - hit.at < (process.env.NODE_ENV === 'test' ? 0 : TTL_MS))
            return hit;
        const cfg = await this.config(market);
        const noindex = new Set();
        const omit = new Map();
        if (cfg.autoNoindex && (await this.flags.isEnabled(seo_automation_public_1.SEO_AUTOMATION_FLAG, { market }).catch(() => true))) {
            const rows = await this.latestReports(market);
            for (const r of rows) {
                const id = (0, page_model_1.pageId)(r.pageKey, r.locale);
                if (r.failedChecks.includes(exports.NOINDEX_MARK))
                    noindex.add(id);
                const om = r.failedChecks.filter((c) => c.startsWith(`${exports.DECISION_PREFIX}omit:`)).map((c) => c.slice(exports.DECISION_PREFIX.length + 5));
                if (om.length)
                    omit.set(id, om);
            }
        }
        const byLocale = { ar: new Set(), en: new Set() };
        for (const id of noindex)
            byLocale[id.endsWith('|ar') ? 'ar' : 'en'].add(id.slice(0, -3));
        const v = { at: Date.now(), auto: cfg.autoNoindex, noindex, byLocale, omit };
        this.qCache.set(market, v);
        return v;
    }
    async blocked(market, pageKey, locale) { return (await this.quality(market)).noindex.has((0, page_model_1.pageId)(pageKey, locale)); }
    async omittedAlternates(market, pageKey, locale) { return (await this.quality(market)).omit.get((0, page_model_1.pageId)(pageKey, locale)) ?? []; }
    async blockedSet(market, locale) { return (await this.quality(market)).byLocale[locale]; }
    async latestReports(market) {
        return this.prisma.$queryRaw `
      SELECT DISTINCT ON ("pageKey", "locale") "pageKey", "templateKind", "locale", "score", "failedChecks", "checkedAt" FROM "SeoQualityReport" WHERE "market" = ${market} ORDER BY "pageKey", "locale", "checkedAt" DESC`;
    }
    async linkMap(market) {
        const hit = this.lCache.get(market);
        if (hit && Date.now() - hit.at < (process.env.NODE_ENV === 'test' ? 0 : TTL_MS))
            return hit.edges;
        const rows = await this.prisma.seoInternalLink.findMany({ where: { market }, orderBy: [{ fromKey: 'asc' }, { rank: 'asc' }, { toKey: 'asc' }] });
        const m = new Map();
        for (const r of rows)
            m.set(r.fromKey, [...(m.get(r.fromKey) ?? []), { toKey: r.toKey, anchorKind: r.anchorKind, rank: r.rank }]);
        this.lCache.set(market, { at: Date.now(), edges: m });
        return m;
    }
    async labels(market) {
        const hit = this.labelCache.get(market);
        if (hit && Date.now() - hit.at < 60_000)
            return hit.labels;
        const s = await this.site.snapshot(market);
        const labels = new Map();
        const sp = (code) => ((0, safety_public_1.isSpecialtyCode)(code) ? safety_public_1.SPECIALTY_LABELS[code] : bil(code));
        labels.set('home:', bil('Kiorex', 'كيوركس'));
        for (const f of s.facets) {
            const place = f.district ?? f.city;
            const spec = f.specialtyCode ? sp(f.specialtyCode) : null;
            const key = (0, page_key_1.pageKeyOf)(f.type, f.params);
            labels.set(key, spec && place ? bil(`${spec.en} in ${place.en}`, `${spec.ar} في ${place.ar}`) : spec ? bil(spec.en, spec.ar) : place ? bil(place.en, place.ar) : bil(key));
        }
        const dslugs = await this.site.slugs(market, 'DOCTOR', s.providers.map((p) => p.id));
        const cslugs = await this.site.slugs(market, 'CLINIC', [...new Set(s.providers.map((p) => p.clinicId))]);
        for (const p of s.providers) {
            const slug = dslugs.get(p.id);
            if (slug)
                labels.set(`${p.careType === 'HOME_NURSING' ? 'nurse' : 'doctor'}:${slug}`, bil(p.nameEn ?? p.nameAr ?? slug, p.nameAr ?? p.nameEn ?? slug));
            const c = cslugs.get(p.clinicId);
            if (c && !labels.has(`clinic:${c}`))
                labels.set(`clinic:${c}`, bil(p.clinicNameEn ?? p.clinicNameAr ?? c, p.clinicNameAr ?? p.clinicNameEn ?? c));
        }
        this.labelCache.set(market, { at: Date.now(), labels });
        return labels;
    }
    async computedLinks(market, pageKey, locale) {
        const edges = (await this.linkMap(market)).get(pageKey);
        if (!edges?.length)
            return [];
        const labels = await this.labels(market);
        const blocked = await this.blockedSet(market, locale);
        const groups = new Map();
        for (const e of edges) {
            const label = labels.get(e.toKey);
            if (!label || blocked.has(e.toKey))
                continue;
            const g = groups.get(e.anchorKind) ?? { kind: e.anchorKind, links: [] };
            g.links.push({ label, path: (0, page_key_1.pathOfKey)(locale, market, e.toKey), count: 0 });
            groups.set(e.anchorKind, g);
        }
        return [...groups.values()];
    }
    async crawl(market) {
        const cc = market.toLowerCase();
        const host = this.site.host();
        const snap = await this.site.snapshot(market);
        const out = [];
        const entryKeys = new Map();
        for (const e of await this.site.entries(market)) {
            const r = this.site.route(`/ar/${cc}${e.rest ? `/${e.rest}` : ''}`);
            if (r)
                entryKeys.set((0, page_key_1.pageKeyOf)(r.type, r.params), { type: r.type, rest: e.rest, params: r.params });
        }
        const facetOf = new Map(snap.facets.map((f) => [(0, page_key_1.pageKeyOf)(f.type, f.params), f]));
        for (const [key, e] of [...entryKeys].sort(([a], [b]) => (a < b ? -1 : 1))) {
            for (const locale of LOCALES) {
                const cap = await this.site.capture(market, locale, e.rest);
                const expected = `${host}/${locale}/${cc}${e.rest ? `/${e.rest}` : ''}`;
                if (!cap || cap.status !== 200) {
                    out.push({ pageKey: key, templateKind: e.type, locale, expectedCanonical: expected, title: '', description: '', h1: [], text: '', jsonLd: [], canonical: '', alternates: [], robots: '', links: [], reviewMarkupRendered: false, visibleReviews: 0 });
                    continue;
                }
                const facet = facetOf.get(key);
                out.push({
                    pageKey: key, templateKind: e.type, locale, expectedCanonical: expected, title: cap.title, description: cap.description, h1: cap.h1, text: (0, text_1.visibleText)(cap.bodyHtml), jsonLd: cap.jsonLd, canonical: cap.canonical,
                    alternates: cap.alternates, robots: cap.robots, links: cap.links, providerIds: facet?.providers.map((p) => p.id), liveProviders: facet?.providers.length,
                    availableProviders: facet && ['same-day', 'telemedicine'].includes(e.type) ? facet.providers.length : undefined, reviewMarkupRendered: JSON.stringify(cap.jsonLd).includes('AggregateRating'), visibleReviews: cap.reviews,
                });
            }
        }
        const nodes = [{ key: 'home:', type: 'home', linkable: true }];
        const providers = snap.providers;
        const dslugs = await this.site.slugs(market, 'DOCTOR', providers.map((p) => p.id));
        const cslugs = await this.site.slugs(market, 'CLINIC', [...new Set(providers.map((p) => p.clinicId))]);
        const dKey = (p) => { const s = dslugs.get(p.id); return s ? `${p.careType === 'HOME_NURSING' ? 'nurse' : 'doctor'}:${s}` : null; };
        const q = (p) => ({ quality: Math.round(p.ratingAvg * Math.log(1 + p.ratingCount) * 1000) / 1000, available: !!p.nextSlotAt && p.nextSlotAt > new Date() });
        const listingKeys = new Set([...entryKeys.keys()]);
        for (const f of snap.facets) {
            const key = (0, page_key_1.pageKeyOf)(f.type, f.params);
            if (!listingKeys.has(key))
                continue;
            nodes.push({ key, type: f.type, linkable: true, providerCount: f.providers.length, doctors: f.providers.flatMap((p) => { const k = dKey(p); return k ? [{ key: k, ...q(p) }] : []; }) });
        }
        const byClinic = new Map();
        for (const p of providers)
            byClinic.set(p.clinicId, [...(byClinic.get(p.clinicId) ?? []), p]);
        for (const [clinicId, ps] of byClinic) {
            const c = cslugs.get(clinicId);
            if (c && listingKeys.has(`clinic:${c}`))
                nodes.push({ key: `clinic:${c}`, type: 'clinic', linkable: true, clinicDoctors: ps.flatMap((p) => { const k = dKey(p); return k ? [{ key: k, ...q(p) }] : []; }) });
        }
        for (const p of providers) {
            const k = dKey(p);
            if (!k || !listingKeys.has(k))
                continue;
            const sp = p.specialtySlug;
            const city = p.citySlug;
            const area = p.areaSlug;
            nodes.push({ key: k, type: k.split(':')[0], linkable: true, clinicKey: cslugs.get(p.clinicId) ? `clinic:${cslugs.get(p.clinicId)}` : null, hubKeys: [sp && city && area ? `district:${sp}/${city}/${area}` : '', sp && city ? `city:${sp}/${city}` : '', sp ? `hub:${sp}` : ''].filter(Boolean) });
        }
        for (const [key, e] of entryKeys)
            if (['pharmacy', 'lab'].includes(e.type))
                nodes.push({ key, type: e.type, linkable: true });
        return { pages: out, nodes: [...new Map(nodes.map((n) => [n.key, n])).values()], entries: entryKeys.size };
    }
    async run(o = {}) {
        const market = o.market ?? market_core_public_1.DEFAULT_MARKET;
        const persist = o.persist !== false;
        const cfg = await this.config(market);
        const base = { market, measured: false, pages: 0, reports: 0, failedPages: 0, wouldNoindex: 0, edges: 0, orphans: 0, orphansFixed: 0, dropped: {}, autoNoindex: cfg.autoNoindex };
        if (!this.site.available())
            return { ...base, reason: 'SSR_BUNDLE_MISSING' };
        const seo = (await this.site.snapshot(market)).seo;
        const { pages, nodes, entries } = await this.crawl(market);
        const gateOf = (orphans) => (0, quality_gate_1.runGate)({ pages, cfg, host: this.site.host(), reviewMarkupEnabled: seo.reviewMarkupEnabled, reviewMarkupMinCount: seo.reviewMarkupMinCount, minAvailableProviders: seo.minAvailableProviders, orphans });
        const first = gateOf().reports;
        const failing = new Set(first.filter((r) => r.wouldNoindex).map((r) => r.pageKey));
        const linkable = nodes.map((n) => ({ ...n, linkable: !failing.has(n.key) }));
        const cc = market.toLowerCase();
        const inbound = new Map();
        for (const p of pages.filter((x) => x.locale === 'ar' && !failing.has(x.pageKey))) {
            for (const href of p.links) {
                const path = href.startsWith('/') ? href : new URL(href).pathname;
                const r = this.site.route(path.split('?')[0].replace(/^\/(ar|en)\//, '/ar/'));
                if (r) {
                    const k = (0, page_key_1.pageKeyOf)(r.type, r.params);
                    if (k !== p.pageKey)
                        inbound.set(k, (inbound.get(k) ?? 0) + 1);
                }
            }
        }
        const orphans = (0, link_graph_1.findOrphans)(linkable, inbound);
        const final = gateOf(new Set(orphans)).reports;
        const g = (0, link_graph_1.buildLinkGraph)(linkable, { maxPerPage: cfg.links.maxPerPage, maxPerAnchorKind: cfg.links.maxPerAnchorKind, topDoctors: cfg.links.topDoctors, clinicDoctors: cfg.links.clinicDoctors, related: cfg.links.relatedSpecialties });
        const labels = await this.labels(market);
        const anchor = (k) => labels.get(k)?.en ?? k;
        const varied = (0, link_graph_1.enforceAnchorVariety)(g.edges, anchor, cfg.links.minAnchorVariety);
        const fix = (0, link_graph_1.fixOrphans)(orphans.filter((k) => !g.edges.some((e) => e.toKey === k)), linkable, varied.kept, { maxPerPage: cfg.links.maxPerPage });
        const edges = [...varied.kept, ...fix];
        const res = { ...base, measured: true, pages: entries, reports: final.length, failedPages: new Set(final.filter((r) => r.failedChecks.length).map((r) => r.pageKey)).size, wouldNoindex: final.filter((r) => r.wouldNoindex).length, edges: edges.length, orphans: orphans.length, orphansFixed: fix.length, dropped: { ...g.dropped, variety: varied.dropped.length } };
        res.findings = final.flatMap((r) => r.failedChecks.map((c) => ({ pageKey: r.pageKey, locale: r.locale, check: c, detail: r.details[c] ?? '', blocking: r.blockingFailed.includes(c) }))).slice(0, 60);
        if (!persist)
            return res;
        await this.persist(market, final, edges, o.actor ?? 'system:seo-automation');
        void cc;
        return res;
    }
    async persist(market, reports, edges, actor) {
        const before = new Map((await this.latestReports(market)).map((r) => [(0, page_model_1.pageId)(r.pageKey, r.locale), r.failedChecks.join(',')]));
        for (const r of reports) {
            const failed = [...r.failedChecks, ...(r.wouldNoindex ? [exports.NOINDEX_MARK] : []), ...r.omitAlternates.map(exports.omitMark)];
            const data = { templateKind: r.templateKind, score: r.score, failedChecks: failed, checkedAt: new Date() };
            await this.prisma.seoQualityReport.upsert({ where: { market_pageKey_locale_contentHash: { market, pageKey: r.pageKey, locale: r.locale, contentHash: r.contentHash } }, create: { market, pageKey: r.pageKey, locale: r.locale, contentHash: r.contentHash, ...data }, update: data });
            if (r.blockingFailed.length && before.get((0, page_model_1.pageId)(r.pageKey, r.locale)) !== failed.join(',')) {
                await this.outbox.enqueue(this.prisma, { type: 'SeoQualityGateFailed', aggregateType: 'SeoPage', aggregateId: `${r.pageKey}|${r.locale}`, target: 'INTERNAL', payload: { market, pageKey: r.pageKey, locale: r.locale, templateKind: r.templateKind, score: r.score, failedChecks: r.blockingFailed, wouldNoindex: r.wouldNoindex, at: new Date().toISOString() }, dedupeKey: (0, node_crypto_1.createHash)('sha256').update(`${market}|${r.pageKey}|${r.locale}|${r.contentHash}|${r.blockingFailed.join(',')}`).digest('hex').slice(0, 40) }).catch(() => undefined);
            }
        }
        await this.prisma.$executeRaw `DELETE FROM "SeoQualityReport" WHERE "market" = ${market} AND "checkedAt" < ${new Date(Date.now() - 30 * 86_400_000)}`;
        const existing = await this.prisma.seoInternalLink.findMany({ where: { market }, select: { id: true, fromKey: true, toKey: true, anchorKind: true, rule: true, rank: true } });
        const ek = (e) => `${e.fromKey}>${e.toKey}>${e.anchorKind}`;
        const want = new Map(edges.map((e) => [ek({ fromKey: e.fromKey, toKey: e.toKey, anchorKind: e.anchorKind }), e]));
        const have = new Map(existing.map((e) => [ek(e), e]));
        const gone = existing.filter((e) => !want.has(ek(e))).map((e) => e.id);
        const add = [...want].filter(([k]) => !have.has(k)).map(([, e]) => ({ market, fromKey: e.fromKey, toKey: e.toKey, anchorKind: e.anchorKind, rule: e.rule, rank: e.rank }));
        const changed = existing.filter((e) => { const w = want.get(ek(e)); return w && (w.rank !== e.rank || w.rule !== e.rule); });
        if (gone.length)
            await this.prisma.seoInternalLink.deleteMany({ where: { id: { in: gone } } });
        if (add.length)
            await this.prisma.seoInternalLink.createMany({ data: add, skipDuplicates: true });
        for (const c of changed) {
            const w = want.get(ek(c));
            await this.prisma.seoInternalLink.update({ where: { id: c.id }, data: { rank: w.rank, rule: w.rule, computedAt: new Date() } });
        }
        await this.prisma.auditLog.create({ data: { actor, action: 'growth.seo_automation.run', resource: 'SeoQualityReport', resourceId: market, metadata: { reports: reports.length, edges: edges.length, added: add.length, removed: gone.length } } });
        this.invalidate();
        this.site.refresh();
    }
    async overview(market = market_core_public_1.DEFAULT_MARKET) {
        const cfg = await this.config(market);
        const rows = await this.latestReports(market);
        const reports = rows.map((r) => ({ pageKey: r.pageKey, templateKind: r.templateKind, locale: r.locale, score: r.score, failedChecks: r.failedChecks.filter((c) => !c.startsWith(exports.DECISION_PREFIX)), blockingFailed: [], details: {}, contentHash: '', wouldNoindex: r.failedChecks.includes(exports.NOINDEX_MARK), omitAlternates: [] }));
        const links = await this.prisma.seoInternalLink.groupBy({ by: ['rule'], where: { market }, _count: { _all: true } });
        const worst = [...rows].sort((a, b) => a.score - b.score || (a.pageKey < b.pageKey ? -1 : 1)).slice(0, 20).map((r) => ({ pageKey: r.pageKey, locale: r.locale, templateKind: r.templateKind, score: r.score, failedChecks: r.failedChecks.filter((c) => !c.startsWith(exports.DECISION_PREFIX)), noindex: r.failedChecks.includes(exports.NOINDEX_MARK), checkedAt: r.checkedAt }));
        const orphanPages = rows.filter((r) => r.failedChecks.includes('orphan') && r.locale === 'ar').map((r) => r.pageKey).sort();
        return { autoNoindex: cfg.autoNoindex, configVersion: cfg.version, measured: rows.length > 0, byTemplate: (0, quality_gate_1.summarise)(reports), worst, pagesChecked: new Set(rows.map((r) => r.pageKey)).size, wouldNoindex: reports.filter((r) => r.wouldNoindex).length, links: { total: links.reduce((s, x) => s + x._count._all, 0), byRule: links.map((x) => ({ rule: x.rule, count: x._count._all })) }, orphans: orphanPages, bundleAvailable: this.site.available() };
    }
};
exports.SeoAutomationService = SeoAutomationService;
exports.SeoAutomationService = SeoAutomationService = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, common_1.Inject)(seo_automation_public_1.SEO_SITE)),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, Object, control_plane_public_1.FlagsService, outbox_public_1.OutboxService])
], SeoAutomationService);
//# sourceMappingURL=seo-automation.service.js.map