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
exports.ModelReportService = void 0;
const market_core_public_1 = require("../../market/market-core-public");
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const kanon_1 = require("../analytics/kanon");
const market_day_1 = require("../campaigns/market-day");
const errors_1 = require("../../common/errors");
const growth_errors_1 = require("../growth-errors");
const aggregate_1 = require("./aggregate");
const data_driven_1 = require("./data-driven");
const lift_1 = require("./lift");
const model_config_1 = require("./model-config");
const model_data_service_1 = require("./model-data.service");
const models_1 = require("./models");
const path_builder_1 = require("./path-builder");
const windows_1 = require("./windows");
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;
let ModelReportService = class ModelReportService {
    prisma;
    data;
    log = new common_1.Logger('attribution-models');
    constructor(prisma, data) {
        this.prisma = prisma;
        this.data = data;
    }
    async rollup(i = {}) {
        const market = i.market ?? market_core_public_1.DEFAULT_MARKET;
        const zone = (0, market_day_1.marketTimezone)(market);
        const cfg = i.config ?? model_config_1.DEFAULT_MODELS_CONFIG;
        const now = i.now ?? new Date();
        const to = i.to && ISO.test(i.to) ? i.to : (0, market_day_1.localDay)(now, zone);
        const from = i.from && ISO.test(i.from) ? i.from : (0, market_day_1.addDays)(to, -(Math.min(Math.max(i.days ?? 3, 1), 120) - 1));
        if (from > to)
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'from must not be after to');
        const convs = await this.data.conversions(market, from, to);
        const subs = [...new Set(convs.map((c) => c.sub).filter((s) => !!s))];
        const since = new Date((0, market_day_1.startOfLocalDay)(from, zone).getTime() - ((0, windows_1.maxWindowDays)(cfg.windows) + 2) * DAY);
        const until = new Date((0, market_day_1.startOfLocalDay)((0, market_day_1.addDays)(to, 1), zone).getTime());
        const touches = await this.data.touchesOf(market, subs, since, until);
        const { converting } = (0, path_builder_1.buildPaths)(touches, convs, zone, cfg.windows);
        const rows = [];
        for (const m of models_1.PATH_MODELS)
            rows.push(...(0, aggregate_1.aggregateModel)(m, converting, zone, cfg.options, cfg.windows));
        const dd = await this.dataDrivenFor(market, now, cfg);
        if (dd.result?.ok)
            rows.push(...(0, aggregate_1.aggregateModel)('DATA_DRIVEN', converting, zone, cfg.options, cfg.windows, dd.result));
        const groups = new Map();
        for (const p of converting) {
            if (!p.touches.length)
                continue;
            const kinds = p.touches.map((t) => t.kind);
            const day = (0, market_day_1.localDay)(p.at, zone);
            const key = `${day}|${(0, path_builder_1.pathHashOf)(kinds)}`;
            const g = groups.get(key);
            if (g)
                g.n++;
            else
                groups.set(key, { day, kinds, n: 1 });
        }
        const snaps = [...groups.entries()].filter(([, g]) => g.n >= kanon_1.K_MIN);
        const range = { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) };
        await this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw `SELECT pg_advisory_xact_lock(hashtext(${`attribution-models-rollup:${market}`}))`;
            await tx.growthAttributionModelResult.deleteMany({ where: { market, day: range, model: { in: dd.result?.ok ? [...models_1.ATTRIBUTION_MODELS] : [...models_1.PATH_MODELS] } } });
            if (rows.length)
                await tx.growthAttributionModelResult.createMany({ data: rows.map((r) => ({ market, day: new Date(`${r.day}T00:00:00Z`), model: r.model, sourceKind: r.sourceKind, sourceRef: r.sourceRef, campaignId: r.campaignId, conversionsFrac: (r.conversionsPpm / models_1.ONE_MILLION).toFixed(6), revenueMinor: BigInt(r.revenueMinor), paths: r.paths, windowDays: r.windowDays })) });
            await tx.growthPathSnapshot.deleteMany({ where: { market, day: range, windowDays: (0, windows_1.maxWindowDays)(cfg.windows) } });
            if (snaps.length)
                await tx.growthPathSnapshot.createMany({ data: snaps.map(([key, g]) => ({ market, day: new Date(`${g.day}T00:00:00Z`), pathHash: key.split('|')[1], pathKinds: g.kinds, length: g.kinds.length, conversions: g.n, k: kanon_1.K_MIN, windowDays: (0, windows_1.maxWindowDays)(cfg.windows) })) });
        }, { timeout: 60_000 });
        const by = {};
        for (const r of rows)
            by[r.model] = (by[r.model] ?? 0) + 1;
        return { market, from, to, conversions: converting.length, rows: by, pathSnapshots: snaps.length, dataDriven: dd.status };
    }
    async dataDrivenFor(market, now, cfg) {
        const zone = (0, market_day_1.marketTimezone)(market);
        const to = (0, market_day_1.localDay)(now, zone);
        const from = (0, market_day_1.addDays)(to, -89);
        const convs = await this.data.conversions(market, from, to);
        const needed = cfg.dataDriven.minConversions;
        if (convs.length < needed)
            return { status: { status: 'INSUFFICIENT_VOLUME', conversions90d: convs.length, needed } };
        const since = new Date((0, market_day_1.startOfLocalDay)(from, zone).getTime() - ((0, windows_1.maxWindowDays)(cfg.windows) + 2) * DAY);
        const until = new Date((0, market_day_1.startOfLocalDay)((0, market_day_1.addDays)(to, 1), zone).getTime());
        const all = [];
        await this.data.allTouches(market, since, until, (p) => { for (const t of p)
            all.push(t); });
        const { converting, nonConverting } = (0, path_builder_1.buildPaths)(all, convs, zone, cfg.windows);
        const result = (0, data_driven_1.dataDriven)(converting, nonConverting, cfg.dataDriven);
        return result.ok ? { result, status: { status: 'OK', conversions90d: convs.length, needed, foldedNodes: result.folded } } : { status: { status: 'INSUFFICIENT_VOLUME', conversions90d: convs.length, needed } };
    }
    async compare(q) {
        const market = q.market ?? market_core_public_1.DEFAULT_MARKET;
        const zone = (0, market_day_1.marketTimezone)(market);
        const to = q.to && ISO.test(q.to) ? q.to : (0, market_day_1.localDay)(q.now ?? new Date(), zone);
        const from = q.from && ISO.test(q.from) ? q.from : (0, market_day_1.addDays)(to, -29);
        if (from > to)
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'from must not be after to');
        if (Date.parse(to) - Date.parse(from) > 366 * DAY)
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'a report covers at most 366 days');
        const where = { market, day: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } };
        const grouped = await this.prisma.growthAttributionModelResult.groupBy({ by: ['model', 'sourceKind'], where, _sum: { conversionsFrac: true, revenueMinor: true, paths: true } });
        const models = models_1.ATTRIBUTION_MODELS.map((model) => {
            const cells = grouped.filter((g) => g.model === model).map((g) => ({ key: g.sourceKind, count: g._sum.paths ?? 0, values: { conversions: Number(g._sum.conversionsFrac ?? 0), revenueMinor: Number(g._sum.revenueMinor ?? 0) } }));
            const total = { conversions: round6(cells.reduce((s, c) => s + c.values.conversions, 0)), revenueMinor: cells.reduce((s, c) => s + c.values.revenueMinor, 0) };
            const masked = (0, kanon_1.applyKAnonymity)(cells);
            return { model, available: cells.length > 0, isDefault: model === models_1.DEFAULT_MODEL, total, rows: masked.map((m) => ({ sourceKind: m.key, paths: m.count, masked: m.masked, conversions: m.masked ? kanon_1.MASK : m.values.conversions, revenueMinor: m.masked ? kanon_1.MASK : m.values.revenueMinor })).sort((a, b) => (typeof b.conversions === 'number' ? b.conversions : -1) - (typeof a.conversions === 'number' ? a.conversions : -1)) };
        });
        const avail = models.filter((m) => m.available && m.model !== 'DATA_DRIVEN');
        const t0 = avail[0]?.total;
        const reconciled = !!t0 && avail.every((m) => Math.abs(m.total.conversions - t0.conversions) < 1e-4 && m.total.revenueMinor === t0.revenueMinor);
        const dd = await this.dataDrivenStatus(market, q.now ?? new Date());
        return { market, from, to, defaultModel: models_1.DEFAULT_MODEL, models, reconciled, dataDriven: dd, note: 'Reporting only: models never change a commission decision (ATTRIBUTION_POLICY stays the money rule). Cells under 10 paths are masked.' };
    }
    async dataDrivenStatus(market, now, cfg = model_config_1.DEFAULT_MODELS_CONFIG) {
        const zone = (0, market_day_1.marketTimezone)(market);
        const to = (0, market_day_1.localDay)(now, zone);
        const from = (0, market_day_1.addDays)(to, -89);
        const n = await this.prisma.growthEvent.count({ where: { market, name: 'BookingAttended', props: { path: ['bucket'], equals: 'new' }, occurredAt: { gte: (0, market_day_1.startOfLocalDay)(from, zone), lt: (0, market_day_1.startOfLocalDay)((0, market_day_1.addDays)(to, 1), zone) } } });
        return n >= cfg.dataDriven.minConversions ? { status: 'OK', conversions90d: n, needed: cfg.dataDriven.minConversions } : { status: 'INSUFFICIENT_VOLUME', message: 'insufficient volume', conversions90d: n, needed: cfg.dataDriven.minConversions };
    }
    async paths(q) {
        const market = q.market ?? market_core_public_1.DEFAULT_MARKET;
        const zone = (0, market_day_1.marketTimezone)(market);
        const to = q.to && ISO.test(q.to) ? q.to : (0, market_day_1.localDay)(q.now ?? new Date(), zone);
        const from = q.from && ISO.test(q.from) ? q.from : (0, market_day_1.addDays)(to, -29);
        const g = await this.prisma.growthPathSnapshot.groupBy({ by: ['pathHash', 'length'], where: { market, day: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } }, _sum: { conversions: true } });
        const kinds = new Map();
        for (const r of await this.prisma.growthPathSnapshot.findMany({ where: { market, pathHash: { in: g.map((x) => x.pathHash) } }, select: { pathHash: true, pathKinds: true }, distinct: ['pathHash'] }))
            kinds.set(r.pathHash, r.pathKinds);
        const rows = g.map((x) => ({ pathHash: x.pathHash, length: x.length, kinds: kinds.get(x.pathHash) ?? [], conversions: x._sum.conversions ?? 0 })).filter((r) => r.conversions >= kanon_1.K_MIN).sort((a, b) => b.conversions - a.conversions || (a.pathHash < b.pathHash ? -1 : 1)).slice(0, Math.min(q.take ?? 50, 200));
        const lengths = new Map();
        for (const r of rows)
            lengths.set(r.length, (lengths.get(r.length) ?? 0) + r.conversions);
        return { market, from, to, k: kanon_1.K_MIN, paths: rows, lengthDistribution: [...lengths].sort((a, b) => a[0] - b[0]).map(([length, conversions]) => ({ length, conversions })) };
    }
    async lift(q) {
        const market = q.market ?? market_core_public_1.DEFAULT_MARKET;
        const exp = await this.prisma.growthExperiment.findUnique({ where: { market_key: { market, key: q.experimentKey } } });
        if (!exp)
            throw (0, errors_1.notFound)('EXPERIMENT_NOT_FOUND', 'experiment not found');
        const variants = (exp.variants ?? []).map((v) => v.key);
        if (!variants.includes('holdout'))
            return { experimentKey: exp.key, available: false, reason: 'NO_HOLDOUT_VARIANT', message: 'The experiment has no variant keyed "holdout"; incrementality needs a holdout.' };
        const daily = await this.prisma.growthExperimentDaily.groupBy({ by: ['variant'], where: { experimentId: exp.id }, _sum: { exposures: true, conversions: true } });
        const arm = (keys) => daily.filter((d) => keys(d.variant)).reduce((a, d) => ({ exposures: a.exposures + (d._sum.exposures ?? 0), conversions: a.conversions + (d._sum.conversions ?? 0) }), { exposures: 0, conversions: 0 });
        const r = (0, lift_1.liftOf)(arm((v) => v === 'holdout'), arm((v) => v !== 'holdout'), q.alpha ?? 0.05);
        return 'suppressed' in r ? { experimentKey: exp.key, available: false, reason: r.reason, message: r.reason === 'K_FLOOR' ? 'Fewer than 10 units in an arm: not reported.' : 'No exposures yet.' } : { experimentKey: exp.key, available: true, status: exp.status, lift: r };
    }
};
exports.ModelReportService = ModelReportService;
exports.ModelReportService = ModelReportService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, model_data_service_1.ModelDataService])
], ModelReportService);
const round6 = (n) => Math.round(n * 1e6) / 1e6;
//# sourceMappingURL=model-report.service.js.map