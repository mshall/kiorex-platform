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
exports.CohortsController = exports.COHORTS_FLAG = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const auth_1 = require("../../common/auth");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const market_core_public_1 = require("../../market/market-core-public");
const growth_access_1 = require("../admin/growth-access");
const growth_errors_1 = require("../growth-errors");
const cohort_service_1 = require("./cohort.service");
const cohort_rollup_job_1 = require("./cohort-rollup.job");
exports.COHORTS_FLAG = 'growth.cohorts_ltv';
const OBJ = { schema: { type: 'object', additionalProperties: true } };
class CohortRollupBody {
    months;
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(60),
    __metadata("design:type", Number)
], CohortRollupBody.prototype, "months", void 0);
const market = (m) => (m && /^[A-Z]{2}$/.test(m) ? m : market_core_public_1.DEFAULT_MARKET);
const basisOf = (b) => { if (!b)
    return undefined; if (!cohort_service_1.BASES.includes(b))
    throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'basis must be FIRST_COMPLETED or REGISTRATION'); return b; };
const dimOf = (d) => { if (!d)
    return undefined; if (!['ALL', 'SOURCE', 'CAMPAIGN', 'PLATFORM'].includes(d))
    throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'dimension must be ALL, SOURCE, CAMPAIGN or PLATFORM'); return d; };
const VALUE = /^[A-Za-z0-9_-]{1,64}$/;
const valueOf = (v) => { if (v === undefined || v === '')
    return undefined; if (!VALUE.test(v))
    throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'value has an invalid format'); return v; };
let CohortsController = class CohortsController {
    cohorts;
    job;
    constructor(cohorts, job) {
        this.cohorts = cohorts;
        this.job = job;
    }
    table(m, basis, dimension, value) { return this.cohorts.table({ market: market(m), basis: basisOf(basis), dimension: dimOf(dimension), value: valueOf(value) }); }
    retention(m, basis, dimension, value) { return this.cohorts.retention({ market: market(m), basis: basisOf(basis), dimension: dimOf(dimension), value: valueOf(value) }); }
    ltv(m, basis) { return this.cohorts.ltv({ market: market(m), basis: basisOf(basis) }); }
    payback(m, months) { return this.cohorts.payback({ market: market(m), months: months ? Number(months) : undefined }); }
    async values(m, dimension) { const d = dimOf(dimension) ?? 'SOURCE'; if (d === 'ALL')
        return { values: [] }; return { values: await this.cohorts.values(market(m), 'FIRST_COMPLETED', d) }; }
    reconcile(m) { return this.cohorts.reconcile(market(m)); }
    rollup(b, m) { return this.job.runOnce(market(m), b.months ?? 24); }
};
exports.CohortsController = CohortsController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-C cohort table (acquisition month by first completed booking or registration; retained, bookings, revenue, reward cost; "<10" masked)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('market')),
    __param(1, (0, common_1.Query)('basis')),
    __param(2, (0, common_1.Query)('dimension')),
    __param(3, (0, common_1.Query)('value')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String]),
    __metadata("design:returntype", void 0)
], CohortsController.prototype, "table", null);
__decorate([
    (0, common_1.Get)('retention'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-C retention curves and heatmap by months since acquisition' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('market')),
    __param(1, (0, common_1.Query)('basis')),
    __param(2, (0, common_1.Query)('dimension')),
    __param(3, (0, common_1.Query)('value')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String]),
    __metadata("design:returntype", void 0)
], CohortsController.prototype, "retention", null);
__decorate([
    (0, common_1.Get)('ltv'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-C LTV estimates with bootstrap intervals (labelled ESTIMATE, with n and horizon)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('market')),
    __param(1, (0, common_1.Query)('basis')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], CohortsController.prototype, "ltv", null);
__decorate([
    (0, common_1.Get)('payback'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-C blended CAC, payback month per cohort and LTV:CAC with interval' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('market')),
    __param(1, (0, common_1.Query)('months')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], CohortsController.prototype, "payback", null);
__decorate([
    (0, common_1.Get)('values'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-C the sources, campaigns or platforms that have a stored cohort' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('market')),
    __param(1, (0, common_1.Query)('dimension')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], CohortsController.prototype, "values", null);
__decorate([
    (0, common_1.Get)('reconcile'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-C independent recount of acquired patients and revenue against the stored cells' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('market')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CohortsController.prototype, "reconcile", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manage')),
    (0, common_1.Post)('rollup'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-C recompute cohorts and LTV for the last N months (idempotent)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Query)('market')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [CohortRollupBody, String]),
    __metadata("design:returntype", void 0)
], CohortsController.prototype, "rollup", null);
exports.CohortsController = CohortsController = __decorate([
    (0, swagger_1.ApiTags)('growth-cohorts'),
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('read')),
    (0, control_plane_public_1.RequiresFlag)(exports.COHORTS_FLAG),
    (0, common_1.Controller)('admin/growth/cohorts'),
    __metadata("design:paramtypes", [cohort_service_1.CohortService, cohort_rollup_job_1.CohortRollupJob])
], CohortsController);
//# sourceMappingURL=cohorts.controller.js.map