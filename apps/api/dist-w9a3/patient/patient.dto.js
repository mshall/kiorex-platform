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
exports.DeletionResultDto = exports.DataExportDto = exports.KiorlyLinkDto = exports.AuthSessionDto = exports.ConsentSetResultDto = exports.ConsentRecordDto = exports.ConsentStateDto = exports.DependantDto = exports.PatientProfileDto = void 0;
const swagger_1 = require("@nestjs/swagger");
class PatientProfileDto {
    id;
    sub;
    phone;
    email;
    nameEn;
    nameAr;
    dateOfBirth;
    gender;
    hasNationalId;
    nationalIdLast4;
    preferredLocale;
    market;
    noShowCount;
    createdAt;
}
exports.PatientProfileDto = PatientProfileDto;
__decorate([
    (0, swagger_1.ApiProperty)({ type: String, format: 'date-time', nullable: true }),
    __metadata("design:type", Object)
], PatientProfileDto.prototype, "dateOfBirth", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['MALE', 'FEMALE'], nullable: true, type: String }),
    __metadata("design:type", Object)
], PatientProfileDto.prototype, "gender", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, description: 'National ID is never returned; last 4 digits only' }),
    __metadata("design:type", Object)
], PatientProfileDto.prototype, "nationalIdLast4", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['ar', 'en'] }),
    __metadata("design:type", String)
], PatientProfileDto.prototype, "preferredLocale", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'EG' }),
    __metadata("design:type", String)
], PatientProfileDto.prototype, "market", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], PatientProfileDto.prototype, "createdAt", void 0);
class DependantDto {
    id;
    guardianSub;
    nameEn;
    nameAr;
    dateOfBirth;
    gender;
    relationship;
    evidence;
    expiresAt;
    deletedAt;
    createdAt;
    guardianAccessExpired;
}
exports.DependantDto = DependantDto;
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], DependantDto.prototype, "nameAr", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], DependantDto.prototype, "dateOfBirth", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], DependantDto.prototype, "gender", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['CHILD', 'PARENT', 'SPOUSE', 'OTHER'] }),
    __metadata("design:type", String)
], DependantDto.prototype, "relationship", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], DependantDto.prototype, "evidence", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time', description: 'Age of majority: guardian access ends' }),
    __metadata("design:type", Object)
], DependantDto.prototype, "expiresAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time' }),
    __metadata("design:type", Object)
], DependantDto.prototype, "deletedAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], DependantDto.prototype, "createdAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false, description: 'Present on list responses' }),
    __metadata("design:type", Boolean)
], DependantDto.prototype, "guardianAccessExpired", void 0);
class ConsentStateDto {
    purpose;
    granted;
    version;
    updatedAt;
}
exports.ConsentStateDto = ConsentStateDto;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['MARKETPLACE_PROCESSING', 'REMINDERS', 'RECORD_SHARING', 'AI_PROCESSING', 'VISIT_STATUS_SHARING'] }),
    __metadata("design:type", String)
], ConsentStateDto.prototype, "purpose", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], ConsentStateDto.prototype, "version", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time' }),
    __metadata("design:type", Object)
], ConsentStateDto.prototype, "updatedAt", void 0);
class ConsentRecordDto {
    id;
    sub;
    purpose;
    granted;
    version;
    source;
    createdAt;
}
exports.ConsentRecordDto = ConsentRecordDto;
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], ConsentRecordDto.prototype, "createdAt", void 0);
class ConsentSetResultDto {
    purpose;
    granted;
}
exports.ConsentSetResultDto = ConsentSetResultDto;
class AuthSessionDto {
    id;
    device;
    clientId;
    createdAt;
    lastSeenAt;
    current;
}
exports.AuthSessionDto = AuthSessionDto;
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], AuthSessionDto.prototype, "device", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], AuthSessionDto.prototype, "clientId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], AuthSessionDto.prototype, "createdAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], AuthSessionDto.prototype, "lastSeenAt", void 0);
class KiorlyLinkDto {
    id;
    sub;
    dependantId;
    clinicId;
    kiorlyPatientId;
    evidence;
    status;
    createdAt;
}
exports.KiorlyLinkDto = KiorlyLinkDto;
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], KiorlyLinkDto.prototype, "dependantId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['PHONE', 'NATIONAL_ID', 'PHONE_AND_NATIONAL_ID'] }),
    __metadata("design:type", String)
], KiorlyLinkDto.prototype, "evidence", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['LINKED', 'CONFLICT_REVIEW'] }),
    __metadata("design:type", String)
], KiorlyLinkDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], KiorlyLinkDto.prototype, "createdAt", void 0);
class DataExportDto {
    id;
    generatedAt;
    profile;
    dependants;
    consents;
    kiorlyLinks;
    bookings;
}
exports.DataExportDto = DataExportDto;
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'DataRequest id' }),
    __metadata("design:type", String)
], DataExportDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], DataExportDto.prototype, "generatedAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: 'object', additionalProperties: true, nullable: true }),
    __metadata("design:type", Object)
], DataExportDto.prototype, "profile", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: 'array', items: { type: 'object', additionalProperties: true } }),
    __metadata("design:type", Array)
], DataExportDto.prototype, "dependants", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: 'array', items: { type: 'object', additionalProperties: true } }),
    __metadata("design:type", Array)
], DataExportDto.prototype, "consents", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: 'array', items: { type: 'object', additionalProperties: true } }),
    __metadata("design:type", Array)
], DataExportDto.prototype, "kiorlyLinks", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: 'array', items: { type: 'object', additionalProperties: true }, required: false, description: 'Contributed by other modules (bookings, vault, pharmacyOrders, labBookings ...)' }),
    __metadata("design:type", Array)
], DataExportDto.prototype, "bookings", void 0);
class DeletionResultDto {
    ok;
    deleted;
    code;
    note;
    export;
}
exports.DeletionResultDto = DeletionResultDto;
__decorate([
    (0, swagger_1.ApiProperty)({ required: false }),
    __metadata("design:type", String)
], DeletionResultDto.prototype, "code", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false }),
    __metadata("design:type", String)
], DeletionResultDto.prototype, "note", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ type: 'object', additionalProperties: true }),
    __metadata("design:type", Object)
], DeletionResultDto.prototype, "export", void 0);
//# sourceMappingURL=patient.dto.js.map