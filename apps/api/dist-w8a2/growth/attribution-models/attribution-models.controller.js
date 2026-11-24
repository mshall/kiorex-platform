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
exports.AttributionModelsController = void 0;
const market_core_public_1 = require("../../market/market-core-public");
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const auth_1 = require("../../common/auth");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const growth_access_1 = require("../admin/growth-access");
const growth_flags_1 = require("../growth-flags");
const model_report_service_1 = require("./model-report.service");
const model_rollup_job_1 = require("./model-rollup.job");
const OBJ = { schema: { type: 'object', additionalProperties: true } };
class ModelRollupBody {
    days;
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(120),
    __metadata("design:type", Number)
], ModelRollupBody.prototype, "days", void 0);
const market = (m) => (m && /^[A-Z]{2}$/.test(m) ? m : market_core_public_1.DEFAULT_MARKET);
let AttributionModelsController = class AttributionModelsController {
    reports;
    job;
    constructor(reports, job) {
        this.reports = reports;
        this.job = job;
    }
    compare(m, from, to) { return this.reports.compare({ market: market(m), from, to }); }
    paths(m, from, to, take) { return this.reports.paths({ market: market(m), from, to, take: take ? Number(take) : undefined }); }
    lift(key, m) { return this.reports.lift({ experimentKey: String(key ?? '').slice(0, 80), market: market(m) }); }
    rollup(b, m) { return this.job.runOnce(market(m), b.days ?? 3); }
};
exports.AttributionModelsController = AttributionModelsController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-B model comparison (all models reconcile to the same total; POSITION_BASED is the default report)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('market')),
    __param(1, (0, common_1.Query)('from')),
    __param(2, (0, common_1.Query)('to')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", void 0)
], AttributionModelsController.prototype, "compare", null);
__decorate([
    (0, common_1.Get)('paths'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-B common conversion paths (hashed ordered source kinds; only paths shared by 10 or more conversions)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('market')),
    __param(1, (0, common_1.Query)('from')),
    __param(2, (0, common_1.Query)('to')),
    __param(3, (0, common_1.Query)('take')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String]),
    __metadata("design:returntype", void 0)
], AttributionModelsController.prototype, "paths", null);
__decorate([
    (0, common_1.Get)('lift'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-B experiment-based lift (holdout against exposed) for a P3-A experiment' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('experimentKey')),
    __param(1, (0, common_1.Query)('market')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], AttributionModelsController.prototype, "lift", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manage')),
    (0, control_plane_public_1.RequiresFlag)(growth_flags_1.GROWTH_FLAG.ATTRIBUTION),
    (0, common_1.Post)('rollup'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-B recompute the last N market days (idempotent)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Query)('market')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [ModelRollupBody, String]),
    __metadata("design:returntype", void 0)
], AttributionModelsController.prototype, "rollup", null);
exports.AttributionModelsController = AttributionModelsController = __decorate([
    (0, swagger_1.ApiTags)('growth-attribution-models'),
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('read')),
    (0, common_1.Controller)('admin/growth/attribution-models'),
    __metadata("design:paramtypes", [model_report_service_1.ModelReportService, model_rollup_job_1.ModelRollupJob])
], AttributionModelsController);
//# sourceMappingURL=attribution-models.controller.js.map