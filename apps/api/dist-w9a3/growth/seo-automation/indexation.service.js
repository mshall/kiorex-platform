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
exports.SeoIndexationService = exports.groupOf = exports.SC_GROUP = void 0;
const market_core_public_1 = require("../../market/market-core-public");
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const common_2 = require("@nestjs/common");
const seo_automation_public_1 = require("./seo-automation-public");
const seo_automation_service_1 = require("./seo-automation.service");
exports.SC_GROUP = { doctor: 'doctor', nurse: 'doctor', clinic: 'clinic', pharmacy: 'partner', lab: 'partner', home: 'other' };
const groupOf = (kind) => exports.SC_GROUP[kind] ?? 'listing';
exports.groupOf = groupOf;
const dayOf = (d) => new Date(`${d.toISOString().slice(0, 10)}T00:00:00Z`);
let SeoIndexationService = class SeoIndexationService {
    prisma;
    site;
    seo;
    constructor(prisma, site, seo) {
        this.prisma = prisma;
        this.site = site;
        this.seo = seo;
    }
    async snapshot(now = new Date(), market = market_core_public_1.DEFAULT_MARKET) {
        const entries = await this.site.entries(market);
        const day = dayOf(now);
        const submitted = new Map();
        for (const e of entries)
            submitted.set((0, exports.groupOf)(e.type), (submitted.get((0, exports.groupOf)(e.type)) ?? 0) + 2);
        const rows = await this.seo.latestReports(market);
        const excluded = new Map();
        for (const r of rows)
            if (r.failedChecks.includes(seo_automation_service_1.NOINDEX_MARK)) {
                const g = (0, exports.groupOf)(r.templateKind);
                const x = excluded.get(g) ?? { n: 0, reasons: {} };
                x.n++;
                for (const c of r.failedChecks.filter((f) => !f.startsWith(seo_automation_service_1.DECISION_PREFIX)))
                    x.reasons[c] = (x.reasons[c] ?? 0) + 1;
                excluded.set(g, x);
            }
        const sc = await this.prisma.growthExternalMetricDaily.findMany({ where: { market, kind: 'searchconsole', metric: 'indexed_pages', day: { gte: new Date(now.getTime() - 7 * 86_400_000) } }, orderBy: { day: 'desc' } });
        const scBy = new Map();
        for (const r of sc) {
            const g = r.dimensionKey.replace(/^template:/, '');
            if (!scBy.has(g))
                scBy.set(g, Math.round(Number(r.value)));
        }
        const out = [];
        for (const [g, n] of [...submitted].sort(([a], [b]) => (a < b ? -1 : 1))) {
            const known = scBy.has(g);
            const ex = excluded.get(g);
            const row = { templateKind: g, submitted: n, indexed: known ? Math.min(n, scBy.get(g)) : 0, excluded: Math.min(n, ex?.n ?? 0), reasonBuckets: { ...(ex?.reasons ?? {}), indexedKnown: known } };
            await this.prisma.seoIndexationSnapshot.upsert({ where: { market_day_templateKind: { market, day, templateKind: g } }, create: { market, day, ...row }, update: row });
            out.push(row);
        }
        return out;
    }
    async overview(market = market_core_public_1.DEFAULT_MARKET) {
        const latest = await this.prisma.$queryRaw `
      SELECT DISTINCT ON ("templateKind") "templateKind", "submitted", "indexed", "excluded", "reasonBuckets", "day" FROM "SeoIndexationSnapshot" WHERE "market" = ${market} ORDER BY "templateKind", "day" DESC`;
        return { rows: latest.map((r) => { const known = r.reasonBuckets.indexedKnown === true; const { indexedKnown: _k, ...reasons } = r.reasonBuckets; return { templateKind: r.templateKind, day: r.day.toISOString().slice(0, 10), submitted: r.submitted, indexed: known ? r.indexed : null, excluded: r.excluded, reasons, indexedKnown: known }; }), note: 'Indexed counts need Search Console index-coverage data; until it is connected they are shown as not measured.' };
    }
};
exports.SeoIndexationService = SeoIndexationService;
exports.SeoIndexationService = SeoIndexationService = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, common_2.Inject)(seo_automation_public_1.SEO_SITE)),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, Object, seo_automation_service_1.SeoAutomationService])
], SeoIndexationService);
//# sourceMappingURL=indexation.service.js.map