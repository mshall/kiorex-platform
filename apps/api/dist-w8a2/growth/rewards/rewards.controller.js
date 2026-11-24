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
exports.RewardsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const auth_1 = require("../../common/auth");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const growth_flags_1 = require("../growth-flags");
const reward_household_service_1 = require("./reward-household.service");
const rewards_query_service_1 = require("./rewards-query.service");
const OBJ = { schema: { type: 'object', additionalProperties: true } };
const loc = (u) => (u.locale === 'en' ? 'en' : 'ar');
class QuoteBody {
    amountMinor;
    bookingRef;
    careType;
    couponCode;
    lotId;
}
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(2_147_483_647),
    __metadata("design:type", Number)
], QuoteBody.prototype, "amountMinor", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(80),
    __metadata("design:type", String)
], QuoteBody.prototype, "bookingRef", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['IN_CLINIC', 'VIDEO', 'HOME_VISIT']),
    __metadata("design:type", String)
], QuoteBody.prototype, "careType", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(24),
    __metadata("design:type", String)
], QuoteBody.prototype, "couponCode", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Matches)(/^rwl_[a-z0-9]+$/),
    __metadata("design:type", String)
], QuoteBody.prototype, "lotId", void 0);
class HouseholdBody {
    dependantId;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(80),
    __metadata("design:type", String)
], HouseholdBody.prototype, "dependantId", void 0);
let RewardsController = class RewardsController {
    q;
    households;
    constructor(q, households) {
        this.q = q;
        this.households = households;
    }
    rewards(u, cursor, take) { return this.q.rewards(u.sub, { cursor, take: take ? Number(take) : undefined }); }
    reveal(u, lotId) { return this.q.reveal(u.sub, lotId); }
    quote(u, b) { return this.q.quote(u.sub, b); }
    credit(u) { return this.q.credit(u.sub, loc(u)); }
    household(u) { return this.households.view(u.sub); }
    addMember(u, b) { return this.households.add(u.sub, b.dependantId); }
    removeMember(u, memberId) { return this.households.remove(u.sub, memberId); }
};
exports.RewardsController = RewardsController;
__decorate([
    (0, control_plane_public_1.RequiresFlag)(growth_flags_1.GROWTH_FLAG.REWARDS),
    (0, common_1.Get)('referral/rewards'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-B2 my vouchers and credit lots with expiry and status (coupons are masked until revealed once)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Query)('cursor')),
    __param(2, (0, common_1.Query)('take')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], RewardsController.prototype, "rewards", null);
__decorate([
    (0, control_plane_public_1.RequiresFlag)(growth_flags_1.GROWTH_FLAG.REWARDS),
    (0, common_1.Post)('rewards/:lotId/reveal'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-B2 show a coupon code once' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('lotId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], RewardsController.prototype, "reveal", null);
__decorate([
    (0, control_plane_public_1.RequiresFlag)(growth_flags_1.GROWTH_FLAG.REWARDS),
    (0, common_1.Post)('rewards/quote'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-B2 checkout lines for a deposit: price, credit, card (read only; the booking and pay flow apply them)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, QuoteBody]),
    __metadata("design:returntype", void 0)
], RewardsController.prototype, "quote", null);
__decorate([
    (0, control_plane_public_1.RequiresFlag)(growth_flags_1.GROWTH_FLAG.PATIENT_CREDIT),
    (0, common_1.Get)('credit'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-B2 my credit: open balance, lots by expiry with scope text, household' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], RewardsController.prototype, "credit", null);
__decorate([
    (0, control_plane_public_1.RequiresFlag)(growth_flags_1.GROWTH_FLAG.FAMILY_CREDIT),
    (0, common_1.Get)('credit/household'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-B2 my household (owner only)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], RewardsController.prototype, "household", null);
__decorate([
    (0, control_plane_public_1.RequiresFlag)(growth_flags_1.GROWTH_FLAG.FAMILY_CREDIT),
    (0, common_1.Post)('credit/household'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-B2 let one of my dependants draw from my credit' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, HouseholdBody]),
    __metadata("design:returntype", void 0)
], RewardsController.prototype, "addMember", null);
__decorate([
    (0, control_plane_public_1.RequiresFlag)(growth_flags_1.GROWTH_FLAG.FAMILY_CREDIT),
    (0, common_1.Delete)('credit/household'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-B2 stop a member drawing from my credit' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Query)('memberId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], RewardsController.prototype, "removeMember", null);
exports.RewardsController = RewardsController = __decorate([
    (0, swagger_1.ApiTags)('growth-credit'),
    (0, common_1.Controller)('growth/v1'),
    __metadata("design:paramtypes", [rewards_query_service_1.RewardsQueryService, reward_household_service_1.RewardHouseholdService])
], RewardsController);
//# sourceMappingURL=rewards.controller.js.map