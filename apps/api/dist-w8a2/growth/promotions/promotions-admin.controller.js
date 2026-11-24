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
exports.PromotionsAdminController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const auth_1 = require("../../common/auth");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const growth_access_1 = require("../admin/growth-access");
const growth_flags_1 = require("../growth-flags");
const promotion_ledger_view_service_1 = require("./promotion-ledger-view.service");
const promotion_review_service_1 = require("./promotion-review.service");
const OBJ = { schema: { type: 'object', additionalProperties: true } };
class PromotionDecideBody {
    version;
    kind;
    decision;
    note;
}
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(1_000_000),
    __metadata("design:type", Number)
], PromotionDecideBody.prototype, "version", void 0);
__decorate([
    (0, class_validator_1.IsIn)(['CONTENT', 'SCOPE', 'HIGH_VALUE']),
    __metadata("design:type", String)
], PromotionDecideBody.prototype, "kind", void 0);
__decorate([
    (0, class_validator_1.IsIn)(['APPROVED', 'REJECTED', 'NEEDS_CHANGES']),
    __metadata("design:type", String)
], PromotionDecideBody.prototype, "decision", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(300),
    __metadata("design:type", String)
], PromotionDecideBody.prototype, "note", void 0);
let PromotionsAdminController = class PromotionsAdminController {
    review;
    ledger;
    constructor(review, ledger) {
        this.review = review;
        this.ledger = ledger;
    }
    queue(status, take) { return this.review.queue({ status: status === 'ACTIVE' || status === 'ALL' ? status : 'IN_REVIEW', take: take ? Number(take) : undefined }); }
    detail(id, version) { return this.review.detail(id, version ? Number(version) : undefined); }
    ledgerOf(id, page) { return this.ledger.forPromotion(id, page ? Number(page) : 1); }
    decide(u, id, b) { return this.review.decide({ sub: u.sub, roles: u.roles }, id, b); }
};
exports.PromotionsAdminController = PromotionsAdminController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-S review queue (status IN_REVIEW by default; ACTIVE or ALL)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('status')),
    __param(1, (0, common_1.Query)('take')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], PromotionsAdminController.prototype, "queue", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-S one promotion: public text, scope, rules, automated guard result, high-value reasons, review state' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Query)('version')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], PromotionsAdminController.prototype, "detail", null);
__decorate([
    (0, common_1.Get)(':id/ledger'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-S the distinct provider-sponsored discount line per booking' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Query)('page')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], PromotionsAdminController.prototype, "ledgerOf", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('reviewPromotions')),
    (0, control_plane_public_1.RequiresFlag)(growth_flags_1.GROWTH_FLAG.SPONSORED_PROMOTIONS),
    (0, common_1.Post)(':id/decisions'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-S decide a review (not the author; a second approver for HIGH_VALUE)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, PromotionDecideBody]),
    __metadata("design:returntype", void 0)
], PromotionsAdminController.prototype, "decide", null);
exports.PromotionsAdminController = PromotionsAdminController = __decorate([
    (0, swagger_1.ApiTags)('growth-sponsored-promotions'),
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('read')),
    (0, common_1.Controller)('admin/growth/sponsored-promotions'),
    __metadata("design:paramtypes", [promotion_review_service_1.PromotionReviewService, promotion_ledger_view_service_1.PromotionLedgerViewService])
], PromotionsAdminController);
//# sourceMappingURL=promotions-admin.controller.js.map