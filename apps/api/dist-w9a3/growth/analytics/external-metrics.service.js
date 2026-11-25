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
exports.ExternalMetricsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const port_1 = require("../integrations/port");
let ExternalMetricsService = class ExternalMetricsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async load(market, from, to) {
        const range = { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) };
        const [sums, lastRuns] = await Promise.all([
            this.prisma.growthExternalMetricDaily.groupBy({ by: ['kind', 'dimensionKey', 'metric'], where: { market, day: range }, _sum: { value: true } }),
            this.prisma.growthIntegrationRun.findMany({ where: { market, status: { in: ['OK', 'PARTIAL'] } }, orderBy: { startedAt: 'desc' }, distinct: ['kind'], select: { kind: true, mode: true, startedAt: true } }),
        ]);
        const out = {};
        for (const kind of port_1.GROWTH_INTEGRATION_KINDS) {
            const rows = sums.filter((s) => s.kind === kind);
            const last = lastRuns.find((r) => r.kind === kind);
            const byKey = {};
            const totals = {};
            for (const r of rows) {
                const v = Number(r._sum.value ?? 0);
                (byKey[r.dimensionKey] ??= {})[r.metric] = v;
                totals[r.metric] = (totals[r.metric] ?? 0) + v;
            }
            out[kind] = { kind, connected: rows.length > 0, synthetic: last?.mode === 'mock', lastRunAt: last?.startedAt.toISOString() ?? null, byKey, totals };
        }
        return out;
    }
};
exports.ExternalMetricsService = ExternalMetricsService;
exports.ExternalMetricsService = ExternalMetricsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ExternalMetricsService);
//# sourceMappingURL=external-metrics.service.js.map