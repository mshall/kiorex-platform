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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SeoVitalsService = void 0;
const market_core_public_1 = require("../../market/market-core-public");
const common_1 = require("@nestjs/common");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const outbox_public_1 = require("../../outbox/outbox-public");
const prisma_service_1 = require("../../prisma/prisma.service");
const seo_automation_service_1 = require("./seo-automation.service");
const vitals_1 = require("./vitals");
const DAY = 86_400_000;
const dayOf = (d) => new Date(`${d.toISOString().slice(0, 10)}T00:00:00Z`);
let SeoVitalsService = class SeoVitalsService {
    prisma;
    seo;
    outbox;
    constructor(prisma, seo, outbox) {
        this.prisma = prisma;
        this.seo = seo;
        this.outbox = outbox;
    }
    summaryPath() { return process.env.SEO_LIGHTHOUSE_SUMMARY ?? (0, node_path_1.resolve)((0, node_path_1.join)(__dirname, '..', '..', '..', '..', 'web', '.lighthouseci', 'summary.json')); }
    async store(points, day, market = market_core_public_1.DEFAULT_MARKET) {
        for (const p of points) {
            const data = { p75: p.p75, sampleSize: p.sampleSize };
            await this.prisma.seoVitalSnapshot.upsert({ where: { market_templateKind_metric_source_day: { market, templateKind: p.templateKind, metric: p.metric, source: p.source, day } }, create: { market, templateKind: p.templateKind, metric: p.metric, source: p.source, day, ...data }, update: data });
        }
        return points.length;
    }
    async ingestLab(summary, now = new Date(), market = market_core_public_1.DEFAULT_MARKET) {
        let json = summary;
        if (json === undefined) {
            const f = this.summaryPath();
            if (!(0, node_fs_1.existsSync)(f))
                return { measured: false, points: 0, reason: 'LIGHTHOUSE_OUTPUT_MISSING' };
            try {
                json = JSON.parse((0, node_fs_1.readFileSync)(f, 'utf8'));
            }
            catch {
                return { measured: false, points: 0, reason: 'LIGHTHOUSE_OUTPUT_UNREADABLE' };
            }
        }
        const points = (0, vitals_1.parseLighthouseSummary)(json);
        if (!points.length)
            return { measured: false, points: 0, reason: 'NO_MOBILE_ROWS' };
        return { measured: true, points: await this.store(points, dayOf(now), market) };
    }
    async ingestField(now = new Date(), market = market_core_public_1.DEFAULT_MARKET) {
        const rows = await this.prisma.growthExternalMetricDaily.findMany({ where: { market, kind: 'crux', day: { gte: new Date(now.getTime() - 7 * DAY) }, dimensionKey: { startsWith: 'template:' } }, select: { dimensionKey: true, metric: true, value: true } });
        if (!rows.length)
            return { measured: false, points: 0, reason: 'CRUX_NOT_CONNECTED' };
        const by = new Map();
        for (const r of rows) {
            const k = `${r.dimensionKey}|${r.metric}`;
            const c = by.get(k) ?? { dimensionKey: r.dimensionKey, metric: r.metric, values: [] };
            c.values.push(Number(r.value));
            by.set(k, c);
        }
        const points = (0, vitals_1.parseCruxRows)([...by.values()].map((c) => ({ dimensionKey: c.dimensionKey, metric: c.metric, value: Math.round(c.values.reduce((a, b) => a + b, 0) / c.values.length) })), rows.length);
        return { measured: true, points: await this.store(points, dayOf(now), market) };
    }
    async check(now = new Date(), market = market_core_public_1.DEFAULT_MARKET) {
        const cfg = await this.seo.config(market);
        const rows = await this.prisma.$queryRaw `
      SELECT DISTINCT ON ("templateKind", "metric", "source") "templateKind", "metric", "source", "p75", "sampleSize", "day" FROM "SeoVitalSnapshot" WHERE "market" = ${market} ORDER BY "templateKind", "metric", "source", "day" DESC`;
        const points = rows.map((r) => ({ templateKind: r.templateKind, metric: r.metric, p75: Number(r.p75), source: r.source, sampleSize: r.sampleSize }));
        const found = (0, vitals_1.breaches)(points, cfg.vitals);
        for (const b of found)
            await this.outbox.enqueue(this.prisma, { type: 'SeoVitalBudgetBreached', aggregateType: 'SeoVital', aggregateId: `${b.templateKind}|${b.metric}|${b.source}`, target: 'INTERNAL', payload: { market, ...b, day: now.toISOString().slice(0, 10), targets: cfg.alertTargets }, dedupeKey: `seo-vital|${market}|${b.templateKind}|${b.metric}|${b.source}|${now.toISOString().slice(0, 10)}` }).catch(() => undefined);
        return { breaches: found, measuredLab: points.some((p) => p.source === 'LAB'), measuredField: points.some((p) => p.source === 'FIELD') };
    }
    async overview(now = new Date(), market = market_core_public_1.DEFAULT_MARKET) {
        const cfg = await this.seo.config(market);
        const since = new Date(now.getTime() - 30 * DAY);
        const rows = await this.prisma.seoVitalSnapshot.findMany({ where: { market, day: { gte: since } }, orderBy: [{ templateKind: 'asc' }, { metric: 'asc' }, { day: 'asc' }] });
        const trend = rows.map((r) => ({ templateKind: r.templateKind, metric: r.metric, source: r.source, day: r.day.toISOString().slice(0, 10), p75: Number(r.p75), sampleSize: r.sampleSize }));
        const latest = new Map();
        for (const t of trend)
            latest.set(`${t.templateKind}|${t.metric}|${t.source}`, t);
        const chk = await this.check(now, market);
        return {
            budgets: cfg.vitals, trend, latest: [...latest.values()], breaches: chk.breaches,
            lab: chk.measuredLab ? { measured: true } : { measured: false, note: 'Not measured: the Lighthouse audit has not produced output. A human installs Chrome and the lighthouse package (G-11) and runs the audit script; nothing is estimated.' },
            field: chk.measuredField ? { measured: true, source: 'crux (mock until the real key is set)' } : { measured: false, note: 'Not measured: the CrUX adapter has not pulled rows.' },
            readiness: { productionIndexing: [{ key: 'vitals_measured', ok: chk.measuredLab || chk.measuredField }, { key: 'vitals_within_budget', ok: chk.breaches.length === 0 && (chk.measuredLab || chk.measuredField) }] },
        };
    }
};
exports.SeoVitalsService = SeoVitalsService;
exports.SeoVitalsService = SeoVitalsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, seo_automation_service_1.SeoAutomationService, outbox_public_1.OutboxService])
], SeoVitalsService);
//# sourceMappingURL=vitals.service.js.map