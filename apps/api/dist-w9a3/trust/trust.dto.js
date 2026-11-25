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
exports.ComplaintCreatedDto = exports.ProviderReviewsDto = exports.PublicReviewDto = exports.ReviewDto = void 0;
const swagger_1 = require("@nestjs/swagger");
class ReviewDto {
    id;
    bookingId;
    rating;
    text;
    status;
    clinicReply;
    editableUntil;
    createdAt;
}
exports.ReviewDto = ReviewDto;
__decorate([
    (0, swagger_1.ApiProperty)({ minimum: 1, maximum: 5 }),
    __metadata("design:type", Number)
], ReviewDto.prototype, "rating", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], ReviewDto.prototype, "text", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['VISIBLE', 'HIDDEN'] }),
    __metadata("design:type", String)
], ReviewDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], ReviewDto.prototype, "clinicReply", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time', description: 'Editable for 7 days' }),
    __metadata("design:type", String)
], ReviewDto.prototype, "editableUntil", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], ReviewDto.prototype, "createdAt", void 0);
class PublicReviewDto {
    id;
    rating;
    text;
    clinicReply;
    createdAt;
}
exports.PublicReviewDto = PublicReviewDto;
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], PublicReviewDto.prototype, "text", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], PublicReviewDto.prototype, "clinicReply", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], PublicReviewDto.prototype, "createdAt", void 0);
class ProviderReviewsDto {
    average;
    count;
    reviews;
}
exports.ProviderReviewsDto = ProviderReviewsDto;
__decorate([
    (0, swagger_1.ApiProperty)({ type: [PublicReviewDto] }),
    __metadata("design:type", Array)
], ProviderReviewsDto.prototype, "reviews", void 0);
class ComplaintCreatedDto {
    id;
    bookingId;
    category;
    status;
    slaDueAt;
    createdAt;
}
exports.ComplaintCreatedDto = ComplaintCreatedDto;
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], ComplaintCreatedDto.prototype, "bookingId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['OPEN', 'RESOLVED'] }),
    __metadata("design:type", String)
], ComplaintCreatedDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time', description: 'Support SLA due time' }),
    __metadata("design:type", String)
], ComplaintCreatedDto.prototype, "slaDueAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], ComplaintCreatedDto.prototype, "createdAt", void 0);
//# sourceMappingURL=trust.dto.js.map