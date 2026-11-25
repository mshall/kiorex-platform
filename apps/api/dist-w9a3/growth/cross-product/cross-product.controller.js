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
exports.CrossProductAdminController = exports.CrossProductController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const auth_1 = require("../../common/auth");
const growth_access_1 = require("../admin/growth-access");
const continuity_funnel_service_1 = require("./continuity-funnel.service");
const continuity_service_1 = require("./continuity.service");
const OBJ = { schema: { type: 'object', additionalProperties: true } };
class ContinuityConsentBody {
    granted;
    source;
}
__decorate([
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], ContinuityConsentBody.prototype, "granted", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['web', 'app']),
    __metadata("design:type", String)
], ContinuityConsentBody.prototype, "source", void 0);
let CrossProductController = class CrossProductController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    cards(u) { return this.svc.cards(u.sub); }
    consent(u) { return this.svc.consentState(u.sub); }
    setConsent(u, b) { return this.svc.setConsent(u.sub, b.granted, b.source ?? 'app'); }
    dismiss(u, id) { return this.svc.dismiss(u.sub, id.slice(0, 40)); }
};
exports.CrossProductController = CrossProductController;
__decorate([
    (0, common_1.Get)('cards'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P4-A my continuity cards (pharmacy, lab, home visit), only when their gates are open; prompts only, nothing is sent' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], CrossProductController.prototype, "cards", null);
__decorate([
    (0, common_1.Get)('consent'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P4-A my consent to link a clinic visit with a later pharmacy, lab or home-visit order for measurement' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], CrossProductController.prototype, "consent", null);
__decorate([
    (0, common_1.Put)('consent'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P4-A grant or withdraw that consent (effective for the next order; withdrawal also dismisses pending prompts)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, ContinuityConsentBody]),
    __metadata("design:returntype", void 0)
], CrossProductController.prototype, "setConsent", null);
__decorate([
    (0, common_1.Post)('cards/:id/dismiss'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P4-A hide one of my cards' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], CrossProductController.prototype, "dismiss", null);
exports.CrossProductController = CrossProductController = __decorate([
    (0, swagger_1.ApiTags)('growth-cross-product'),
    (0, common_1.Controller)('growth/v1/continuity'),
    __metadata("design:paramtypes", [continuity_service_1.CrossProductService])
], CrossProductController);
let CrossProductAdminController = class CrossProductAdminController {
    funnel;
    constructor(funnel) {
        this.funnel = funnel;
    }
    get(days) { return this.funnel.funnel(days ? Number(days) || 30 : 30); }
};
exports.CrossProductAdminController = CrossProductAdminController;
__decorate([
    (0, common_1.Get)('funnel'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P4-A clinic to pharmacy, lab and home-visit funnel (aggregate k >= 10; by source of the first booking and time to continue; no specialty)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('days')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CrossProductAdminController.prototype, "get", null);
exports.CrossProductAdminController = CrossProductAdminController = __decorate([
    (0, swagger_1.ApiTags)('growth-admin'),
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('read')),
    (0, common_1.Controller)('ops/growth/cross-product'),
    __metadata("design:paramtypes", [continuity_funnel_service_1.CrossProductFunnelService])
], CrossProductAdminController);
//# sourceMappingURL=cross-product.controller.js.map