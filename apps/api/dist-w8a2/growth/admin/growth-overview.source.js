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
exports.AnalyticsOverviewSource = exports.InternalOverviewSource = exports.GROWTH_OVERVIEW_SOURCE = void 0;
const common_1 = require("@nestjs/common");
const contracts_1 = require("@kiorex/contracts");
const prisma_service_1 = require("../../prisma/prisma.service");
const metrics_service_1 = require("../analytics/metrics.service");
exports.GROWTH_OVERVIEW_SOURCE = Symbol('GROWTH_OVERVIEW_SOURCE');
let InternalOverviewSource = class InternalOverviewSource {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async overview({ market, days }) {
        const since = new Date(Date.now() - days * 86_400_000);
        const [events, origins, reasons, touches] = await Promise.all([
            this.prisma.growthEvent.groupBy({ by: ['name'], where: { market, occurredAt: { gte: since } }, _count: { _all: true } }),
            this.prisma.growthAttributionDecision.groupBy({ by: ['origin'], where: { market, createdAt: { gte: since }, supersedesId: null }, _count: { _all: true } }),
            this.prisma.growthAttributionDecision.groupBy({ by: ['reasonCode'], where: { market, createdAt: { gte: since }, supersedesId: null }, _count: { _all: true } }),
            this.prisma.growthTouchpoint.groupBy({ by: ['kind'], where: { market, occurredAt: { gte: since } }, _count: { _all: true } }),
        ]);
        const led = origins.find((o) => o.origin === 'PROVIDER_LED')?._count._all ?? 0;
        const mp = origins.find((o) => o.origin === 'MARKETPLACE')?._count._all ?? 0;
        const byName = new Map(events.map((e) => [e.name, e._count._all]));
        return {
            source: 'internal', days, market, since: since.toISOString(),
            funnel: contracts_1.GROWTH_EVENT_NAMES.map((name) => ({ name, count: byName.get(name) ?? 0 })),
            origins: origins.map((o) => ({ origin: o.origin, count: o._count._all })).sort((a, b) => b.count - a.count),
            reasons: reasons.map((r) => ({ reason: r.reasonCode, count: r._count._all })).sort((a, b) => b.count - a.count),
            touchesBySource: touches.map((t) => ({ sourceKind: t.kind, count: t._count._all })).sort((a, b) => b.count - a.count),
            providerLedShare: led + mp > 0 ? led / (led + mp) : null,
        };
    }
};
exports.InternalOverviewSource = InternalOverviewSource;
exports.InternalOverviewSource = InternalOverviewSource = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], InternalOverviewSource);
const ORIGINS = ['PROVIDER_LED', 'MARKETPLACE', 'UNATTRIBUTED'];
let AnalyticsOverviewSource = class AnalyticsOverviewSource {
    metrics;
    internal;
    prisma;
    constructor(metrics, internal, prisma) {
        this.metrics = metrics;
        this.internal = internal;
        this.prisma = prisma;
    }
    async overview(q) {
        const fresh = await this.metrics.freshness();
        if (!fresh.rolledUpAt)
            return this.internal.overview(q);
        const to = new Date();
        const from = new Date(to.getTime() - q.days * 86_400_000);
        const f = { ...(0, metrics_service_1.parseFilters)({ from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }), market: q.market };
        const a = { kind: 'OPS' };
        const [fun, ov, raw] = await Promise.all([this.metrics.funnel(f, a), this.metrics.overview(f, a), this.internal.overview(q)]);
        const stageCount = new Map(fun.stages.map((st) => [st.stage, st]));
        const mix = ov.originMix;
        const mixOf = { PROVIDER_LED: mix.providerLed, MARKETPLACE: mix.marketplace, UNATTRIBUTED: mix.unattributed };
        const cell = (v) => (typeof v === 'number' ? { count: v, masked: false } : { count: 0, masked: true });
        const mask = (n) => (n > 0 && n < 10 ? { count: 0, masked: true } : { count: n, masked: false });
        return {
            source: 'analytics-v1', days: q.days, market: q.market, since: raw.since,
            funnel: contracts_1.GROWTH_EVENT_NAMES.map((name) => { const st = stageCount.get(name); return st ? { name, ...cell(st.count) } : { name, count: 0 }; }),
            origins: ORIGINS.map((origin) => ({ origin, ...cell(mixOf[origin]) })).filter((o) => o.count > 0 || o.masked).sort((x, y) => y.count - x.count),
            reasons: raw.reasons.map((r) => ({ reason: r.reason, ...mask(r.count) })).map((r) => ({ reason: r.reason, count: r.count, ...(r.masked ? { masked: true } : {}) })),
            touchesBySource: raw.touchesBySource.map((t) => ({ sourceKind: t.sourceKind, ...mask(t.count) })),
            providerLedShare: typeof ov.providerLedShare === 'number' ? ov.providerLedShare / 100 : null,
        };
    }
};
exports.AnalyticsOverviewSource = AnalyticsOverviewSource;
exports.AnalyticsOverviewSource = AnalyticsOverviewSource = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [metrics_service_1.GrowthMetricsService, InternalOverviewSource, prisma_service_1.PrismaService])
], AnalyticsOverviewSource);
//# sourceMappingURL=growth-overview.source.js.map