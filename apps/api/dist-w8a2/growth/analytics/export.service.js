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
exports.GrowthExportService = exports.toCsv = void 0;
const common_1 = require("@nestjs/common");
const metrics_service_1 = require("./metrics.service");
const cell = (v) => {
    if (v === null || v === undefined)
        return '';
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s) && typeof v === 'string' && s !== '<10')
        s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (header, rows) => [header.join(','), ...rows.map((r) => header.map((h) => cell(r[h])).join(','))].join('\n') + '\n';
exports.toCsv = toCsv;
let GrowthExportService = class GrowthExportService {
    metrics;
    constructor(metrics) {
        this.metrics = metrics;
    }
    async csv(report, f, a, opts = {}) {
        if (report === 'funnel') {
            const r = await this.metrics.funnel(f, a);
            return (0, exports.toCsv)(['stage', 'kind', 'count', 'stepConversionPct', 'cumulativeConversionPct'], r.stages);
        }
        if (report === 'channels') {
            const r = await this.metrics.channels(f, a, ['sourceKind', 'campaign']);
            const own = a.kind === 'OPS';
            return (0, exports.toCsv)(['sourceKind', 'campaign', 'bookings', 'attendedNewPatients', ...(own ? ['spendMinor', 'revenueMinor', 'cacMinor', 'roas', 'ltvToCac', 'verdict'] : [])], r.rows);
        }
        if (report === 'breakdown') {
            const dim = (opts.dimension ?? 'city');
            const r = await this.metrics.breakdown(f, a, dim);
            return (0, exports.toCsv)([String(dim), 'bookings', 'attendedNewPatients', 'providerLedSharePct'], r.rows);
        }
        if (report === 'cohorts') {
            const r = await this.metrics.cohorts({ market: f.market, origin: f.origin }, a);
            return (0, exports.toCsv)(['cohort', 'size', 'retention30Pct', 'retention90Pct', 'retention180Pct'], r.rows);
        }
        const o = await this.metrics.overview(f, a);
        const keys = Object.keys(o).filter((k) => ['number', 'string'].includes(typeof o[k]) && !['audience'].includes(k));
        return (0, exports.toCsv)(['metric', 'value'], keys.map((k) => ({ metric: k, value: o[k] })));
    }
};
exports.GrowthExportService = GrowthExportService;
exports.GrowthExportService = GrowthExportService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [metrics_service_1.GrowthMetricsService])
], GrowthExportService);
//# sourceMappingURL=export.service.js.map