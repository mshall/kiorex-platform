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
exports.PromotionsPublicController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const auth_1 = require("../../common/auth");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const growth_flags_1 = require("../growth-flags");
const promotion_quote_service_1 = require("./promotion-quote.service");
class QuoteQuery {
    bookingId;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(80),
    __metadata("design:type", String)
], QuoteQuery.prototype, "bookingId", void 0);
const OBJ = { schema: { type: 'object', additionalProperties: true } };
let PromotionsPublicController = class PromotionsPublicController {
    quotes;
    constructor(quotes) {
        this.quotes = quotes;
    }
    async quote(u, q) { return { quote: await this.quotes.quote(u.sub, q.bookingId) }; }
};
exports.PromotionsPublicController = PromotionsPublicController;
__decorate([
    (0, common_1.Get)('quote'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-S the sponsored discount line for my booking, if any' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, QuoteQuery]),
    __metadata("design:returntype", Promise)
], PromotionsPublicController.prototype, "quote", null);
exports.PromotionsPublicController = PromotionsPublicController = __decorate([
    (0, swagger_1.ApiTags)('growth-sponsored-promotions'),
    (0, common_1.Controller)('growth/v1/promotions'),
    (0, control_plane_public_1.RequiresFlag)(growth_flags_1.GROWTH_FLAG.SPONSORED_PROMOTIONS),
    __metadata("design:paramtypes", [promotion_quote_service_1.PromotionQuoteService])
], PromotionsPublicController);
//# sourceMappingURL=promotions-public.controller.js.map