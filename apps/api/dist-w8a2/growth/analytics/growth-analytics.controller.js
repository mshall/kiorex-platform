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
exports.GrowthAnalyticsProviderController = exports.GrowthAnalyticsOpsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const auth_1 = require("../../common/auth");
const errors_1 = require("../../common/errors");
const privacy_hash_1 = require("../../common/privacy-hash");
const prisma_service_1 = require("../../prisma/prisma.service");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const growth_flags_1 = require("../growth-flags");
const growth_limiter_1 = require("../growth-limiter");
const export_service_1 = require("./export.service");
const metrics_service_1 = require("./metrics.service");
const partner_auth_1 = require("./partner-auth");
const rollup_job_1 = require("./rollup.job");
const spend_service_1 = require("./spend.service");
const OBJ = { schema: { type: 'object', additionalProperties: true } };
const BREAKDOWNS = metrics_service_1.FILTER_KEYS.filter((k) => k !== 'country');
const REPORTS = ['overview', 'funnel', 'channels', 'breakdown', 'cohorts'];
const dimOf = (d) => { if (!BREAKDOWNS.includes(d))
    throw (0, errors_1.badRequest)('INVALID_DIMENSION', `dimension must be one of ${BREAKDOWNS.join(', ')}`); return d; };
const reportOf = (r) => { const n = r.replace(/\.csv$/, ''); if (!REPORTS.includes(n))
    throw (0, errors_1.badRequest)('INVALID_REPORT', `report must be one of ${REPORTS.join(', ')}`); return n; };
class SpendBody {
    day;
    amountMinor;
    campaign;
    channel;
    sourceKind;
    note;
    campaignId;
}
__decorate([
    (0, class_validator_1.Matches)(/^\d{4}-\d{2}-\d{2}$/),
    __metadata("design:type", String)
], SpendBody.prototype, "day", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(1_000_000_000),
    __metadata("design:type", Number)
], SpendBody.prototype, "amountMinor", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(64),
    __metadata("design:type", String)
], SpendBody.prototype, "campaign", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(64),
    __metadata("design:type", String)
], SpendBody.prototype, "channel", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(32),
    __metadata("design:type", String)
], SpendBody.prototype, "sourceKind", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(300),
    __metadata("design:type", String)
], SpendBody.prototype, "note", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(64),
    __metadata("design:type", String)
], SpendBody.prototype, "campaignId", void 0);
class RollupBody {
    days;
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(400),
    __metadata("design:type", Number)
], RollupBody.prototype, "days", void 0);
let GrowthAnalyticsOpsController = class GrowthAnalyticsOpsController {
    metrics;
    exporter;
    spend;
    job;
    ops = { kind: 'OPS' };
    constructor(metrics, exporter, spend, job) {
        this.metrics = metrics;
        this.exporter = exporter;
        this.spend = spend;
        this.job = job;
    }
    overview(q) { return this.metrics.overview((0, metrics_service_1.parseFilters)(q), this.ops); }
    funnel(q) { return this.metrics.funnel((0, metrics_service_1.parseFilters)(q), this.ops); }
    channels(q) { return this.metrics.channels((0, metrics_service_1.parseFilters)(q), this.ops, q.by === 'campaign' ? ['sourceKind', 'campaign'] : ['sourceKind']); }
    breakdown(d, q) { return this.metrics.breakdown((0, metrics_service_1.parseFilters)(q), this.ops, dimOf(d)); }
    cohorts(q) { const f = (0, metrics_service_1.parseFilters)(q); return this.metrics.cohorts({ market: f.market, origin: f.origin, months: q.months ? Number(q.months) : undefined }, this.ops); }
    unit() { return this.metrics.unitEconomics(); }
    csv(r, q) { return this.exporter.csv(reportOf(r), (0, metrics_service_1.parseFilters)(q), this.ops, { dimension: typeof q.dimension === 'string' ? dimOf(q.dimension) : undefined }); }
    listSpend(status, from, to, campaignId) { return this.spend.list({ status, from, to, campaignId }); }
    createSpend(u, b) { return this.spend.create(u.sub, b); }
    approve(u, id) { return this.spend.decide(u.sub, id, 'APPROVE'); }
    reject(u, id) { return this.spend.decide(u.sub, id, 'REJECT'); }
    rollup(b) { return this.job.runOnce(b.days ?? 3); }
};
exports.GrowthAnalyticsOpsController = GrowthAnalyticsOpsController;
__decorate([
    (0, common_1.Get)('overview'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-J executive overview (k >= 10; GBV is never revenue)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], GrowthAnalyticsOpsController.prototype, "overview", null);
__decorate([
    (0, common_1.Get)('funnel'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-J canonical funnel with step and cumulative conversion (k >= 10)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], GrowthAnalyticsOpsController.prototype, "funnel", null);
__decorate([
    (0, common_1.Get)('channels'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-J channel table: bookings, ANP, spend, CAC, ROAS, LTV to CAC (k >= 10)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], GrowthAnalyticsOpsController.prototype, "channels", null);
__decorate([
    (0, common_1.Get)('breakdown/:dimension'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-J breakdown by city, district, specialty, provider, doctor, branch, campaign, channel, platform, careType, sourceKind or origin (k >= 10)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Param)('dimension')),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], GrowthAnalyticsOpsController.prototype, "breakdown", null);
__decorate([
    (0, common_1.Get)('cohorts'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-J acquisition cohort retention at 30, 90 and 180 days (closed windows only; k >= 10)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], GrowthAnalyticsOpsController.prototype, "cohorts", null);
__decorate([
    (0, common_1.Get)('unit-economics'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-J LTV inputs and definitions' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], GrowthAnalyticsOpsController.prototype, "unit", null);
__decorate([
    (0, common_1.Get)('export/:report'),
    (0, common_1.Header)('content-type', 'text/csv; charset=utf-8'),
    (0, common_1.Header)('content-disposition', 'attachment; filename="growth-report.csv"'),
    (0, swagger_1.ApiOkResponse)({ description: 'CSV text (cells under k = 10 are <10)', schema: { type: 'string' } }),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-J CSV export with the same k >= 10 masking' }),
    __param(0, (0, common_1.Param)('report')),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], GrowthAnalyticsOpsController.prototype, "csv", null);
__decorate([
    (0, common_1.Get)('spend'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-J spend entries (manual; maker-checker)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('status')),
    __param(1, (0, common_1.Query)('from')),
    __param(2, (0, common_1.Query)('to')),
    __param(3, (0, common_1.Query)('campaignId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String]),
    __metadata("design:returntype", void 0)
], GrowthAnalyticsOpsController.prototype, "listSpend", null);
__decorate([
    (0, common_1.Post)('spend'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-J enter a spend line (PENDING until a different ops user approves it)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, SpendBody]),
    __metadata("design:returntype", void 0)
], GrowthAnalyticsOpsController.prototype, "createSpend", null);
__decorate([
    (0, common_1.Post)('spend/:id/approve'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-J approve a spend line (not the author)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], GrowthAnalyticsOpsController.prototype, "approve", null);
__decorate([
    (0, common_1.Post)('spend/:id/reject'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-J reject a spend line (not the author)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], GrowthAnalyticsOpsController.prototype, "reject", null);
__decorate([
    (0, auth_1.SuperAdminOnly)(),
    (0, common_1.Post)('rollup'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-J recompute the daily rollups for the last N days (idempotent)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [RollupBody]),
    __metadata("design:returntype", void 0)
], GrowthAnalyticsOpsController.prototype, "rollup", null);
exports.GrowthAnalyticsOpsController = GrowthAnalyticsOpsController = __decorate([
    (0, swagger_1.ApiTags)('growth'),
    (0, auth_1.OpsOnly)(),
    (0, common_1.Controller)('ops/growth-analytics'),
    __metadata("design:paramtypes", [metrics_service_1.GrowthMetricsService, export_service_1.GrowthExportService, spend_service_1.GrowthSpendService, rollup_job_1.GrowthRollupJob])
], GrowthAnalyticsOpsController);
let GrowthAnalyticsProviderController = class GrowthAnalyticsProviderController {
    metrics;
    exporter;
    prisma;
    limiter;
    constructor(metrics, exporter, prisma, limiter) {
        this.metrics = metrics;
        this.exporter = exporter;
        this.prisma = prisma;
        this.limiter = limiter;
    }
    async who(req) {
        await this.limiter.take('provider-analytics', (0, privacy_hash_1.ipHashOf)(req.ip), (0, growth_limiter_1.growthLimits)().evidencePerMin);
        return { kind: 'PROVIDER', orgId: await (0, partner_auth_1.authenticatePartnerOrg)(req, this.prisma, 'provider-analytics') };
    }
    async overview(req, q) { return this.metrics.overview((0, metrics_service_1.parseFilters)(q), await this.who(req)); }
    async funnel(req, q) { return this.metrics.funnel((0, metrics_service_1.parseFilters)(q), await this.who(req)); }
    async channels(req, q) { return this.metrics.channels((0, metrics_service_1.parseFilters)(q), await this.who(req)); }
    async cohorts(req, q) { const f = (0, metrics_service_1.parseFilters)(q); return this.metrics.cohorts({ market: f.market, origin: f.origin }, await this.who(req)); }
    async csv(req, r, q) { return this.exporter.csv(reportOf(r), (0, metrics_service_1.parseFilters)(q), await this.who(req), { dimension: typeof q.dimension === 'string' ? dimOf(q.dimension) : undefined }); }
};
exports.GrowthAnalyticsProviderController = GrowthAnalyticsProviderController;
__decorate([
    (0, auth_1.Public)(),
    (0, control_plane_public_1.RequiresFlag)(growth_flags_1.GROWTH_FLAG.ATTRIBUTION),
    (0, common_1.Get)('overview'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-J provider overview (own organisation, signed partner, k >= 10)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [void 0, Object]),
    __metadata("design:returntype", Promise)
], GrowthAnalyticsProviderController.prototype, "overview", null);
__decorate([
    (0, auth_1.Public)(),
    (0, control_plane_public_1.RequiresFlag)(growth_flags_1.GROWTH_FLAG.ATTRIBUTION),
    (0, common_1.Get)('funnel'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-J provider booking funnel (own organisation)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [void 0, Object]),
    __metadata("design:returntype", Promise)
], GrowthAnalyticsProviderController.prototype, "funnel", null);
__decorate([
    (0, auth_1.Public)(),
    (0, control_plane_public_1.RequiresFlag)(growth_flags_1.GROWTH_FLAG.ATTRIBUTION),
    (0, common_1.Get)('channels'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-J provider channel table (own organisation)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [void 0, Object]),
    __metadata("design:returntype", Promise)
], GrowthAnalyticsProviderController.prototype, "channels", null);
__decorate([
    (0, auth_1.Public)(),
    (0, control_plane_public_1.RequiresFlag)(growth_flags_1.GROWTH_FLAG.ATTRIBUTION),
    (0, common_1.Get)('cohorts'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-J provider cohort retention (own organisation)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [void 0, Object]),
    __metadata("design:returntype", Promise)
], GrowthAnalyticsProviderController.prototype, "cohorts", null);
__decorate([
    (0, auth_1.Public)(),
    (0, control_plane_public_1.RequiresFlag)(growth_flags_1.GROWTH_FLAG.ATTRIBUTION),
    (0, common_1.Get)('export/:report'),
    (0, common_1.Header)('content-type', 'text/csv; charset=utf-8'),
    (0, swagger_1.ApiOkResponse)({ description: 'CSV text (cells under k = 10 are <10)', schema: { type: 'string' } }),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-J provider CSV export (same masking)' }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('report')),
    __param(2, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [void 0, String, Object]),
    __metadata("design:returntype", Promise)
], GrowthAnalyticsProviderController.prototype, "csv", null);
exports.GrowthAnalyticsProviderController = GrowthAnalyticsProviderController = __decorate([
    (0, swagger_1.ApiTags)('growth'),
    (0, common_1.Controller)('growth/v1/provider-analytics'),
    __metadata("design:paramtypes", [metrics_service_1.GrowthMetricsService, export_service_1.GrowthExportService, prisma_service_1.PrismaService, growth_limiter_1.GrowthLimiter])
], GrowthAnalyticsProviderController);
//# sourceMappingURL=growth-analytics.controller.js.map