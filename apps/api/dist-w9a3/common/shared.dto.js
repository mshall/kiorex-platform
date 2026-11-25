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
exports.CancellationPolicyDto = exports.EmergencyDto = exports.SpecialtyDto = void 0;
const swagger_1 = require("@nestjs/swagger");
class SpecialtyDto {
    code;
    en;
    ar;
}
exports.SpecialtyDto = SpecialtyDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'dermatology' }),
    __metadata("design:type", String)
], SpecialtyDto.prototype, "code", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], SpecialtyDto.prototype, "en", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], SpecialtyDto.prototype, "ar", void 0);
class EmergencyDto {
    number;
    service;
    messageEn;
    messageAr;
    bookingBlocked;
    categories;
}
exports.EmergencyDto = EmergencyDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: '123' }),
    __metadata("design:type", String)
], EmergencyDto.prototype, "number", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], EmergencyDto.prototype, "service", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], EmergencyDto.prototype, "messageEn", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], EmergencyDto.prototype, "messageAr", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Boolean)
], EmergencyDto.prototype, "bookingBlocked", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [String] }),
    __metadata("design:type", Array)
], EmergencyDto.prototype, "categories", void 0);
class CancellationPolicyDto {
    patientCancelMinHours;
    patientRescheduleMinHours;
    depositRefundMinHours;
    maxPatientReschedules;
}
exports.CancellationPolicyDto = CancellationPolicyDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Hours before the visit a patient may still cancel' }),
    __metadata("design:type", Number)
], CancellationPolicyDto.prototype, "patientCancelMinHours", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", Number)
], CancellationPolicyDto.prototype, "patientRescheduleMinHours", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Deposit is refunded when cancelled at least this many hours ahead' }),
    __metadata("design:type", Number)
], CancellationPolicyDto.prototype, "depositRefundMinHours", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", Number)
], CancellationPolicyDto.prototype, "maxPatientReschedules", void 0);
//# sourceMappingURL=shared.dto.js.map