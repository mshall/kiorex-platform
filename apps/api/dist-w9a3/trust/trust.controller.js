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
exports.TrustController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const auth_1 = require("../common/auth");
const trust_service_1 = require("./trust.service");
const trust_dto_1 = require("./trust.dto");
class BookingReviewBody {
    rating;
    text;
}
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(5),
    __metadata("design:type", Number)
], BookingReviewBody.prototype, "rating", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(2000),
    __metadata("design:type", String)
], BookingReviewBody.prototype, "text", void 0);
class ReviewEdit {
    rating;
    text;
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(5),
    __metadata("design:type", Number)
], ReviewEdit.prototype, "rating", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(2000),
    __metadata("design:type", String)
], ReviewEdit.prototype, "text", void 0);
class ComplaintBody {
    category;
    body;
    bookingId;
}
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ComplaintBody.prototype, "category", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(2000),
    __metadata("design:type", String)
], ComplaintBody.prototype, "body", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ComplaintBody.prototype, "bookingId", void 0);
let TrustController = class TrustController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    submit(u, id, b) { return this.svc.submit(u.sub, id, b); }
    edit(u, id, b) { return this.svc.edit(u.sub, id, b); }
    mine(u) { return this.svc.mine(u.sub); }
    forProvider(id) { return this.svc.forProvider(id); }
    complain(u, b) { return this.svc.complain(u.sub, b); }
};
exports.TrustController = TrustController;
__decorate([
    (0, swagger_1.ApiCreatedResponse)({ type: trust_dto_1.ReviewDto }),
    (0, common_1.Post)('bookings/:id/review'),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-RV-01 review a completed Kiorex visit (flag kiorex.reviews)' }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, BookingReviewBody]),
    __metadata("design:returntype", void 0)
], TrustController.prototype, "submit", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: trust_dto_1.ReviewDto }),
    (0, common_1.Put)('reviews/:id'),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-RV-01 edit within 7 days' }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, ReviewEdit]),
    __metadata("design:returntype", void 0)
], TrustController.prototype, "edit", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: trust_dto_1.ReviewDto, isArray: true }),
    (0, common_1.Get)('me/reviews'),
    __param(0, (0, auth_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], TrustController.prototype, "mine", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: trust_dto_1.ProviderReviewsDto }),
    (0, auth_1.Public)(),
    (0, common_1.Get)('providers/:id/reviews'),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-PR-03 latest 20 visible reviews with clinic replies' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], TrustController.prototype, "forProvider", null);
__decorate([
    (0, swagger_1.ApiCreatedResponse)({ type: trust_dto_1.ComplaintCreatedDto }),
    (0, common_1.Post)('complaints'),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, ComplaintBody]),
    __metadata("design:returntype", void 0)
], TrustController.prototype, "complain", null);
exports.TrustController = TrustController = __decorate([
    (0, swagger_1.ApiTags)('trust'),
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [trust_service_1.TrustService])
], TrustController);
//# sourceMappingURL=trust.controller.js.map