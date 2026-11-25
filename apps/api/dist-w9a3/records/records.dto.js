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
exports.OkDto = exports.RxVerifyResultDto = exports.FollowUpDto = exports.RecordSharingDto = exports.RecordShareScopeDto = exports.PrescriptionItemDto = exports.VaultDetailDto = exports.VaultLabReportDto = exports.VaultPrescriptionDto = exports.VaultRxItemDto = exports.VaultVisitContentDto = exports.VaultSoapDto = exports.RxVerificationDto = exports.VaultListDto = exports.VaultItemDto = void 0;
const swagger_1 = require("@nestjs/swagger");
class VaultItemDto {
    id;
    kind;
    title;
    source;
    clinicId;
    dependantId;
    signedAt;
    hasFile;
    fileName;
    mimeType;
    sizeBytes;
    createdAt;
}
exports.VaultItemDto = VaultItemDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], VaultItemDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['VISIT_SUMMARY', 'PRESCRIPTION', 'LAB_RESULT', 'UPLOAD'] }),
    __metadata("design:type", String)
], VaultItemDto.prototype, "kind", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], VaultItemDto.prototype, "title", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['CLINIC', 'LAB', 'PATIENT'], description: 'Where the record came from' }),
    __metadata("design:type", String)
], VaultItemDto.prototype, "source", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], VaultItemDto.prototype, "clinicId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], VaultItemDto.prototype, "dependantId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time' }),
    __metadata("design:type", Object)
], VaultItemDto.prototype, "signedAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Boolean)
], VaultItemDto.prototype, "hasFile", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], VaultItemDto.prototype, "fileName", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], VaultItemDto.prototype, "mimeType", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: Number }),
    __metadata("design:type", Object)
], VaultItemDto.prototype, "sizeBytes", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], VaultItemDto.prototype, "createdAt", void 0);
class VaultListDto {
    items;
    readOnly;
}
exports.VaultListDto = VaultListDto;
__decorate([
    (0, swagger_1.ApiProperty)({ type: [VaultItemDto] }),
    __metadata("design:type", Array)
], VaultListDto.prototype, "items", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'true when kiorex.record_vault is OFF: existing records stay readable/deletable, no uploads or new shares' }),
    __metadata("design:type", Boolean)
], VaultListDto.prototype, "readOnly", void 0);
class RxVerificationDto {
    token;
    qrPayload;
    verifyUrl;
}
exports.RxVerificationDto = RxVerificationDto;
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Opaque signed token' }),
    __metadata("design:type", String)
], RxVerificationDto.prototype, "token", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Encode this string as the QR code' }),
    __metadata("design:type", String)
], RxVerificationDto.prototype, "qrPayload", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], RxVerificationDto.prototype, "verifyUrl", void 0);
class VaultSoapDto {
    subjective;
    objective;
    assessment;
    plan;
}
exports.VaultSoapDto = VaultSoapDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], VaultSoapDto.prototype, "subjective", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], VaultSoapDto.prototype, "objective", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], VaultSoapDto.prototype, "assessment", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], VaultSoapDto.prototype, "plan", void 0);
class VaultVisitContentDto {
    encounterId;
    soap;
}
exports.VaultVisitContentDto = VaultVisitContentDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", String)
], VaultVisitContentDto.prototype, "encounterId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ type: VaultSoapDto }),
    __metadata("design:type", VaultSoapDto)
], VaultVisitContentDto.prototype, "soap", void 0);
class VaultRxItemDto {
    activeIngredient;
    strength;
    quantity;
    directions;
}
exports.VaultRxItemDto = VaultRxItemDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], VaultRxItemDto.prototype, "activeIngredient", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", String)
], VaultRxItemDto.prototype, "strength", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", Number)
], VaultRxItemDto.prototype, "quantity", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", String)
], VaultRxItemDto.prototype, "directions", void 0);
class VaultPrescriptionDto {
    encounterId;
    clinicId;
    signedAt;
    items;
    itemsAvailable;
    pdf;
}
exports.VaultPrescriptionDto = VaultPrescriptionDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", String)
], VaultPrescriptionDto.prototype, "encounterId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", String)
], VaultPrescriptionDto.prototype, "clinicId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ nullable: true, type: String, format: 'date-time' }),
    __metadata("design:type", Object)
], VaultPrescriptionDto.prototype, "signedAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [VaultRxItemDto], nullable: true, description: 'null until Kiorly shares line items (NEEDS_HUMAN #21)' }),
    __metadata("design:type", Object)
], VaultPrescriptionDto.prototype, "items", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Boolean)
], VaultPrescriptionDto.prototype, "itemsAvailable", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ type: 'object', properties: { url: { type: 'string' }, expiresAt: { type: 'string', format: 'date-time' } }, description: 'Signed expiring Rx PDF link' }),
    __metadata("design:type", Object)
], VaultPrescriptionDto.prototype, "pdf", void 0);
class VaultLabReportDto {
    reportId;
    orderId;
    labId;
    reportVersion;
    signedAt;
    secureLink;
}
exports.VaultLabReportDto = VaultLabReportDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], VaultLabReportDto.prototype, "reportId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], VaultLabReportDto.prototype, "orderId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], VaultLabReportDto.prototype, "labId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], VaultLabReportDto.prototype, "reportVersion", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], VaultLabReportDto.prototype, "signedAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Signed secure link only; never raw values (KLCRIT03)' }),
    __metadata("design:type", String)
], VaultLabReportDto.prototype, "secureLink", void 0);
class VaultDetailDto extends VaultItemDto {
    content;
    prescription;
    verification;
    report;
}
exports.VaultDetailDto = VaultDetailDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'VISIT_SUMMARY: SOAP note as shared by the clinic (clinical content)', type: VaultVisitContentDto }),
    __metadata("design:type", VaultVisitContentDto)
], VaultDetailDto.prototype, "content", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'PRESCRIPTION', type: VaultPrescriptionDto }),
    __metadata("design:type", VaultPrescriptionDto)
], VaultDetailDto.prototype, "prescription", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ type: RxVerificationDto }),
    __metadata("design:type", RxVerificationDto)
], VaultDetailDto.prototype, "verification", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'LAB_RESULT: signed report secure link (no raw values)', type: VaultLabReportDto }),
    __metadata("design:type", VaultLabReportDto)
], VaultDetailDto.prototype, "report", void 0);
class PrescriptionItemDto extends VaultItemDto {
    verification;
}
exports.PrescriptionItemDto = PrescriptionItemDto;
__decorate([
    (0, swagger_1.ApiProperty)({ type: RxVerificationDto, description: 'QR token the patient shows at the pharmacy' }),
    __metadata("design:type", RxVerificationDto)
], PrescriptionItemDto.prototype, "verification", void 0);
class RecordShareScopeDto {
    scope;
    granted;
    updatedAt;
}
exports.RecordShareScopeDto = RecordShareScopeDto;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['VISIT_SUMMARY', 'PRESCRIPTIONS', 'LAB_RESULTS', 'SHARE_WITH_OTHER_CLINICS'] }),
    __metadata("design:type", String)
], RecordShareScopeDto.prototype, "scope", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Boolean)
], RecordShareScopeDto.prototype, "granted", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time' }),
    __metadata("design:type", Object)
], RecordShareScopeDto.prototype, "updatedAt", void 0);
class RecordSharingDto {
    scopes;
    canGrant;
}
exports.RecordSharingDto = RecordSharingDto;
__decorate([
    (0, swagger_1.ApiProperty)({ type: [RecordShareScopeDto] }),
    __metadata("design:type", Array)
], RecordSharingDto.prototype, "scopes", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'false when clinic.record_share_patient_app is OFF: no NEW sharing can be granted; revoking always works' }),
    __metadata("design:type", Boolean)
], RecordSharingDto.prototype, "canGrant", void 0);
class FollowUpDto {
    id;
    recordId;
    clinicId;
    dueAt;
    source;
    status;
}
exports.FollowUpDto = FollowUpDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], FollowUpDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], FollowUpDto.prototype, "recordId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], FollowUpDto.prototype, "clinicId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], FollowUpDto.prototype, "dueAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['DOCTOR', 'PATIENT'] }),
    __metadata("design:type", String)
], FollowUpDto.prototype, "source", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['SCHEDULED', 'DUE', 'CANCELLED'] }),
    __metadata("design:type", String)
], FollowUpDto.prototype, "status", void 0);
class RxVerifyResultDto {
    valid;
    status;
    clinicId;
    signedAt;
}
exports.RxVerifyResultDto = RxVerifyResultDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Boolean)
], RxVerifyResultDto.prototype, "valid", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['ACTIVE', 'REVOKED', 'UNKNOWN'] }),
    __metadata("design:type", String)
], RxVerifyResultDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", String)
], RxVerifyResultDto.prototype, "clinicId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ format: 'date-time' }),
    __metadata("design:type", String)
], RxVerifyResultDto.prototype, "signedAt", void 0);
var dto_1 = require("../common/dto");
Object.defineProperty(exports, "OkDto", { enumerable: true, get: function () { return dto_1.OkDto; } });
//# sourceMappingURL=records.dto.js.map