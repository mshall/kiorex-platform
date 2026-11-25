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
exports.WaitlistScanResultDto = exports.WaitlistEntryDto = exports.WaitlistDoctorDto = exports.WaitlistOfferDto = void 0;
const swagger_1 = require("@nestjs/swagger");
class WaitlistOfferDto {
    id;
    startsAt;
    endsAt;
    status;
    expiresAt;
    bookingId;
}
exports.WaitlistOfferDto = WaitlistOfferDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], WaitlistOfferDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], WaitlistOfferDto.prototype, "startsAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], WaitlistOfferDto.prototype, "endsAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['OFFERED', 'ACCEPTED', 'DECLINED', 'EXPIRED'] }),
    __metadata("design:type", String)
], WaitlistOfferDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time', description: 'Accept before this time; afterwards the slot is offered onward' }),
    __metadata("design:type", String)
], WaitlistOfferDto.prototype, "expiresAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, description: 'Held booking created on accept; confirm it with POST /bookings/{id}/confirm' }),
    __metadata("design:type", Object)
], WaitlistOfferDto.prototype, "bookingId", void 0);
class WaitlistDoctorDto {
    id;
    nameEn;
    nameAr;
    specialty;
    photoUrl;
}
exports.WaitlistDoctorDto = WaitlistDoctorDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], WaitlistDoctorDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], WaitlistDoctorDto.prototype, "nameEn", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], WaitlistDoctorDto.prototype, "nameAr", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, description: 'Launch specialty code' }),
    __metadata("design:type", Object)
], WaitlistDoctorDto.prototype, "specialty", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], WaitlistDoctorDto.prototype, "photoUrl", void 0);
class WaitlistEntryDto {
    id;
    providerId;
    doctor;
    clinicNameEn;
    clinicNameAr;
    typeId;
    preferredFrom;
    preferredTo;
    status;
    expiresAt;
    offers;
}
exports.WaitlistEntryDto = WaitlistEntryDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], WaitlistEntryDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], WaitlistEntryDto.prototype, "providerId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: WaitlistDoctorDto, nullable: true, description: 'Doctor summary so clients need not fetch the profile per entry' }),
    __metadata("design:type", Object)
], WaitlistEntryDto.prototype, "doctor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], WaitlistEntryDto.prototype, "clinicNameEn", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], WaitlistEntryDto.prototype, "clinicNameAr", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], WaitlistEntryDto.prototype, "typeId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time' }),
    __metadata("design:type", Object)
], WaitlistEntryDto.prototype, "preferredFrom", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time' }),
    __metadata("design:type", Object)
], WaitlistEntryDto.prototype, "preferredTo", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['WAITING', 'OFFERED', 'BOOKED', 'CANCELLED', 'EXPIRED'] }),
    __metadata("design:type", String)
], WaitlistEntryDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], WaitlistEntryDto.prototype, "expiresAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [WaitlistOfferDto] }),
    __metadata("design:type", Array)
], WaitlistEntryDto.prototype, "offers", void 0);
class WaitlistScanResultDto {
    offersCreated;
    offersExpired;
}
exports.WaitlistScanResultDto = WaitlistScanResultDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], WaitlistScanResultDto.prototype, "offersCreated", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], WaitlistScanResultDto.prototype, "offersExpired", void 0);
//# sourceMappingURL=waitlist.dto.js.map