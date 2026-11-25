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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PayLinkCheckoutDto = exports.PayLinkDto = exports.PspWebhookAckDto = exports.PayIntentDto = void 0;
const swagger_1 = require("@nestjs/swagger");
class PayIntentDto {
    id;
    bookingId;
    amountMinor;
    currency;
    status;
    checkoutUrl;
    refundedMinor;
}
exports.PayIntentDto = PayIntentDto;
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], PayIntentDto.prototype, "bookingId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['CREATED', 'CAPTURED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED'] }),
    __metadata("design:type", String)
], PayIntentDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], PayIntentDto.prototype, "checkoutUrl", void 0);
class PspWebhookAckDto {
    status;
}
exports.PspWebhookAckDto = PspWebhookAckDto;
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'CAPTURED | ALREADY_CAPTURED | FAILED_RECORDED | DUPLICATE | IGNORED' }),
    __metadata("design:type", String)
], PspWebhookAckDto.prototype, "status", void 0);
class PayLinkDto {
    token;
    clinicId;
    amountMinor;
    currency;
    status;
    expiresAt;
}
exports.PayLinkDto = PayLinkDto;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['OPEN', 'PAID', 'EXPIRED'] }),
    __metadata("design:type", String)
], PayLinkDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], PayLinkDto.prototype, "expiresAt", void 0);
class PayLinkCheckoutDto {
    paymentId;
    checkoutUrl;
    status;
}
exports.PayLinkCheckoutDto = PayLinkCheckoutDto;
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], PayLinkCheckoutDto.prototype, "checkoutUrl", void 0);
//# sourceMappingURL=pay.dto.js.map