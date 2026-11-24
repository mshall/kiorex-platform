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
exports.LabBookingDto = exports.LabBookingPaymentDto = exports.LabBookingTestDto = exports.LabSlotsResultDto = exports.LabSlotDto = exports.LabTestsResultDto = exports.LabTestDto = void 0;
const swagger_1 = require("@nestjs/swagger");
class LabTestDto {
    labId;
    partnerId;
    labName;
    code;
    name;
    nameAr;
    priceMinor;
    sampleType;
    sampleTypeAr;
    homeCollection;
    preparation;
    preparationAr;
}
exports.LabTestDto = LabTestDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], LabTestDto.prototype, "labId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ nullable: true, type: String, description: 'Registration (partner) id that owns this lab; pass it as partnerId when the same lab id could be offered by two partners' }),
    __metadata("design:type", Object)
], LabTestDto.prototype, "partnerId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], LabTestDto.prototype, "labName", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], LabTestDto.prototype, "code", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], LabTestDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Arabic test name when the lab holds one; fall back to `name`. Search matches Arabic and English.' }),
    __metadata("design:type", String)
], LabTestDto.prototype, "nameAr", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], LabTestDto.prototype, "priceMinor", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", String)
], LabTestDto.prototype, "sampleType", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Arabic specimen type when known; fall back to `sampleType`.' }),
    __metadata("design:type", String)
], LabTestDto.prototype, "sampleTypeAr", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Boolean)
], LabTestDto.prototype, "homeCollection", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", String)
], LabTestDto.prototype, "preparation", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Arabic preparation instructions when the lab holds them; fall back to `preparation`.' }),
    __metadata("design:type", String)
], LabTestDto.prototype, "preparationAr", void 0);
class LabTestsResultDto {
    items;
}
exports.LabTestsResultDto = LabTestsResultDto;
__decorate([
    (0, swagger_1.ApiProperty)({ type: [LabTestDto] }),
    __metadata("design:type", Array)
], LabTestsResultDto.prototype, "items", void 0);
class LabSlotDto {
    startsAt;
    endsAt;
}
exports.LabSlotDto = LabSlotDto;
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], LabSlotDto.prototype, "startsAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], LabSlotDto.prototype, "endsAt", void 0);
class LabSlotsResultDto {
    labId;
    partnerId;
    collectionType;
    slots;
}
exports.LabSlotsResultDto = LabSlotsResultDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], LabSlotsResultDto.prototype, "labId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], LabSlotsResultDto.prototype, "partnerId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['HOME', 'WALK_IN'] }),
    __metadata("design:type", String)
], LabSlotsResultDto.prototype, "collectionType", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [LabSlotDto] }),
    __metadata("design:type", Array)
], LabSlotsResultDto.prototype, "slots", void 0);
class LabBookingTestDto {
    code;
    name;
    nameAr;
    priceMinor;
}
exports.LabBookingTestDto = LabBookingTestDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], LabBookingTestDto.prototype, "code", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], LabBookingTestDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Arabic name snapshot (fall back to `name`)' }),
    __metadata("design:type", String)
], LabBookingTestDto.prototype, "nameAr", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], LabBookingTestDto.prototype, "priceMinor", void 0);
class LabBookingPaymentDto {
    paymentId;
    status;
    checkoutUrl;
}
exports.LabBookingPaymentDto = LabBookingPaymentDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], LabBookingPaymentDto.prototype, "paymentId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], LabBookingPaymentDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], LabBookingPaymentDto.prototype, "checkoutUrl", void 0);
class LabBookingDto {
    id;
    status;
    labId;
    partnerId;
    tests;
    collectionType;
    slotStartsAt;
    slotEndsAt;
    subtotalMinor;
    collectionFeeMinor;
    totalMinor;
    currency;
    resultRecordId;
    rejectionReason;
    payment;
    createdAt;
}
exports.LabBookingDto = LabBookingDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], LabBookingDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['PENDING_PAYMENT', 'PAID', 'SUBMITTED', 'RESULT_RELEASED', 'REJECTED', 'CANCELLED'] }),
    __metadata("design:type", String)
], LabBookingDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], LabBookingDto.prototype, "labId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ nullable: true, type: String, description: 'Registration (partner) that owns the lab and receives this booking' }),
    __metadata("design:type", Object)
], LabBookingDto.prototype, "partnerId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [LabBookingTestDto] }),
    __metadata("design:type", Array)
], LabBookingDto.prototype, "tests", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['HOME', 'WALK_IN'] }),
    __metadata("design:type", String)
], LabBookingDto.prototype, "collectionType", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], LabBookingDto.prototype, "slotStartsAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], LabBookingDto.prototype, "slotEndsAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], LabBookingDto.prototype, "subtotalMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], LabBookingDto.prototype, "collectionFeeMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], LabBookingDto.prototype, "totalMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], LabBookingDto.prototype, "currency", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, description: 'Vault record id of the released report (GET /me/vault/{id})' }),
    __metadata("design:type", Object)
], LabBookingDto.prototype, "resultRecordId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], LabBookingDto.prototype, "rejectionReason", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: LabBookingPaymentDto, nullable: true }),
    __metadata("design:type", Object)
], LabBookingDto.prototype, "payment", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], LabBookingDto.prototype, "createdAt", void 0);
//# sourceMappingURL=lab.dto.js.map