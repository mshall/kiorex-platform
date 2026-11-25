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
exports.CorporatePublicController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const auth_1 = require("../../common/auth");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const growth_flags_1 = require("../growth-flags");
const corporate_benefit_service_1 = require("./corporate-benefit.service");
const corporate_member_service_1 = require("./corporate-member.service");
const OBJ = { schema: { type: 'object', additionalProperties: true } };
class CorporateJoinBody {
    code;
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(40),
    __metadata("design:type", String)
], CorporateJoinBody.prototype, "code", void 0);
class CorporateQuoteQuery {
    bookingId;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(80),
    __metadata("design:type", String)
], CorporateQuoteQuery.prototype, "bookingId", void 0);
let CorporatePublicController = class CorporatePublicController {
    members;
    benefit;
    constructor(members, benefit) {
        this.members = members;
        this.benefit = benefit;
    }
    me(u) { return this.members.me(u.sub); }
    join(u, b) { return this.members.join({ sub: u.sub, phone: u.phone, email: u.email, emailVerified: u.emailVerified }, b.code); }
    leave(u) { return this.members.leave(u.sub); }
    async quote(u, q) { return { quote: await this.benefit.quote(u.sub, q.bookingId) }; }
};
exports.CorporatePublicController = CorporatePublicController;
__decorate([
    (0, common_1.Get)('me'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P4-C my programme and my allowance usage' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], CorporatePublicController.prototype, "me", null);
__decorate([
    (0, common_1.Post)('join'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P4-C join with a company code, or with a verified work e-mail when no code is sent' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, CorporateJoinBody]),
    __metadata("design:returntype", void 0)
], CorporatePublicController.prototype, "join", null);
__decorate([
    (0, common_1.Post)('leave'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P4-C leave the programme' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], CorporatePublicController.prototype, "leave", null);
__decorate([
    (0, common_1.Get)('benefit/quote'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P4-C what the programme would cover of the deposit of one of MY bookings' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, CorporateQuoteQuery]),
    __metadata("design:returntype", Promise)
], CorporatePublicController.prototype, "quote", null);
exports.CorporatePublicController = CorporatePublicController = __decorate([
    (0, swagger_1.ApiTags)('growth-corporate'),
    (0, common_1.Controller)('growth/v1/corporate'),
    (0, control_plane_public_1.RequiresFlag)(growth_flags_1.CORPORATE_FLAG),
    __metadata("design:paramtypes", [corporate_member_service_1.CorporateMemberService, corporate_benefit_service_1.CorporateBenefitService])
], CorporatePublicController);
//# sourceMappingURL=corporate-public.controller.js.map