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
exports.ProductDecisionAdminController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const auth_1 = require("../../common/auth");
const growth_access_1 = require("../admin/growth-access");
const product_decision_service_1 = require("./product-decision.service");
let ProductDecisionAdminController = class ProductDecisionAdminController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    summary(days) { return this.svc.summary(days ? Number(days) || 30 : 30); }
};
exports.ProductDecisionAdminController = ProductDecisionAdminController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P4-B2 pharmacy, lab and nurse decisions by origin (counts only, cells under 10 masked)' }),
    (0, swagger_1.ApiOkResponse)({ schema: { type: 'object', additionalProperties: true } }),
    __param(0, (0, common_1.Query)('days')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ProductDecisionAdminController.prototype, "summary", null);
exports.ProductDecisionAdminController = ProductDecisionAdminController = __decorate([
    (0, swagger_1.ApiTags)('growth-admin'),
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('read')),
    (0, common_1.Controller)('ops/growth/product-decisions'),
    __metadata("design:paramtypes", [product_decision_service_1.GrowthProductBookingService])
], ProductDecisionAdminController);
//# sourceMappingURL=product-decision-admin.controller.js.map