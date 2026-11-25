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
exports.TeleVisitDto = exports.TeleVisitDoctorDto = exports.TeleProvidersResultDto = exports.TeleProviderDto = exports.VideoTokenDto = exports.TeleSessionDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const booking_public_1 = require("../booking/booking-public");
class TeleSessionDto {
    id;
    bookingId;
    providerId;
    status;
    scheduledStartsAt;
    startedAt;
    endedAt;
    durationSec;
    consultFeeMinor;
    joinOpensAt;
}
exports.TeleSessionDto = TeleSessionDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], TeleSessionDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], TeleSessionDto.prototype, "bookingId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], TeleSessionDto.prototype, "providerId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['SCHEDULED', 'WAITING', 'IN_PROGRESS', 'ENDED', 'CANCELLED'] }),
    __metadata("design:type", String)
], TeleSessionDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], TeleSessionDto.prototype, "scheduledStartsAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time' }),
    __metadata("design:type", Object)
], TeleSessionDto.prototype, "startedAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time' }),
    __metadata("design:type", Object)
], TeleSessionDto.prototype, "endedAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: Number }),
    __metadata("design:type", Object)
], TeleSessionDto.prototype, "durationSec", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Per-consult fee placeholder (NEEDS_HUMAN, 0 while unset)' }),
    __metadata("design:type", Number)
], TeleSessionDto.prototype, "consultFeeMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time', description: 'Join window opens (15 min before the visit)' }),
    __metadata("design:type", String)
], TeleSessionDto.prototype, "joinOpensAt", void 0);
class VideoTokenDto {
    token;
    room;
    url;
    expiresAt;
    role;
    provider;
}
exports.VideoTokenDto = VideoTokenDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], VideoTokenDto.prototype, "token", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], VideoTokenDto.prototype, "room", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], VideoTokenDto.prototype, "url", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], VideoTokenDto.prototype, "expiresAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['patient', 'clinician'] }),
    __metadata("design:type", String)
], VideoTokenDto.prototype, "role", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'mock | the real provider name' }),
    __metadata("design:type", String)
], VideoTokenDto.prototype, "provider", void 0);
class TeleProviderDto {
    id;
    nameEn;
    nameAr;
    specialty;
    defaultTypeId;
    nextSlots;
}
exports.TeleProviderDto = TeleProviderDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], TeleProviderDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], TeleProviderDto.prototype, "nameEn", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], TeleProviderDto.prototype, "nameAr", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], TeleProviderDto.prototype, "specialty", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], TeleProviderDto.prototype, "defaultTypeId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: 'array', items: { type: 'object', properties: { startsAt: { type: 'string' }, endsAt: { type: 'string' } } }, nullable: true }),
    __metadata("design:type", Object)
], TeleProviderDto.prototype, "nextSlots", void 0);
class TeleProvidersResultDto {
    items;
}
exports.TeleProvidersResultDto = TeleProvidersResultDto;
__decorate([
    (0, swagger_1.ApiProperty)({ type: [TeleProviderDto] }),
    __metadata("design:type", Array)
], TeleProvidersResultDto.prototype, "items", void 0);
class TeleVisitDoctorDto {
    nameEn;
    nameAr;
    specialty;
}
exports.TeleVisitDoctorDto = TeleVisitDoctorDto;
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], TeleVisitDoctorDto.prototype, "nameEn", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], TeleVisitDoctorDto.prototype, "nameAr", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], TeleVisitDoctorDto.prototype, "specialty", void 0);
class TeleVisitDto {
    bookingId;
    status;
    startsAt;
    endsAt;
    doctor;
    telehealth;
}
exports.TeleVisitDto = TeleVisitDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], TeleVisitDto.prototype, "bookingId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['INTENT', 'HELD', 'PENDING_CLINIC', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW', 'CANCELLED', 'EXPIRED'] }),
    __metadata("design:type", String)
], TeleVisitDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], TeleVisitDto.prototype, "startsAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], TeleVisitDto.prototype, "endsAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: TeleVisitDoctorDto, nullable: true }),
    __metadata("design:type", Object)
], TeleVisitDto.prototype, "doctor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: booking_public_1.BookingTelehealthDto }),
    __metadata("design:type", booking_public_1.BookingTelehealthDto)
], TeleVisitDto.prototype, "telehealth", void 0);
//# sourceMappingURL=tele.dto.js.map