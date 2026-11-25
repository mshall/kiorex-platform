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
exports.PartnerAuditLineDto = exports.PartnerConnectionDto = exports.PartnerConnectionRowDto = exports.PartnerPublicStatusDto = exports.PartnerPublicStepDto = exports.PartnerStepDto = exports.IntakeResultDto = exports.EnrolmentCreatedDto = exports.EnrolmentViewDto = void 0;
const swagger_1 = require("@nestjs/swagger");
class EnrolmentViewDto {
    id;
    kind;
    orgRef;
    label;
    status;
    expiresAt;
    createdBy;
    revokedBy;
    revokedAt;
    usedAt;
    connectionId;
    createdAt;
}
exports.EnrolmentViewDto = EnrolmentViewDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'kxe_ab12cd34' }),
    __metadata("design:type", String)
], EnrolmentViewDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['CLINIC', 'NURSE', 'PHARMACY', 'LAB'] }),
    __metadata("design:type", String)
], EnrolmentViewDto.prototype, "kind", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ nullable: true }),
    __metadata("design:type", Object)
], EnrolmentViewDto.prototype, "orgRef", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], EnrolmentViewDto.prototype, "label", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['ACTIVE', 'USED', 'REVOKED', 'EXPIRED'] }),
    __metadata("design:type", String)
], EnrolmentViewDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], EnrolmentViewDto.prototype, "expiresAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], EnrolmentViewDto.prototype, "createdBy", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ nullable: true }),
    __metadata("design:type", Object)
], EnrolmentViewDto.prototype, "revokedBy", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ nullable: true }),
    __metadata("design:type", Object)
], EnrolmentViewDto.prototype, "revokedAt", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ nullable: true }),
    __metadata("design:type", Object)
], EnrolmentViewDto.prototype, "usedAt", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ nullable: true }),
    __metadata("design:type", Object)
], EnrolmentViewDto.prototype, "connectionId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], EnrolmentViewDto.prototype, "createdAt", void 0);
class EnrolmentCreatedDto extends EnrolmentViewDto {
    code;
    shownOnce;
}
exports.EnrolmentCreatedDto = EnrolmentCreatedDto;
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'The one-time enrolment code (kxe_<id>.<secret>); only ever present in this response' }),
    __metadata("design:type", String)
], EnrolmentCreatedDto.prototype, "code", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: true }),
    __metadata("design:type", Boolean)
], EnrolmentCreatedDto.prototype, "shownOnce", void 0);
class IntakeResultDto {
    id;
    status;
    created;
    statusToken;
    intakeKey;
}
exports.IntakeResultDto = IntakeResultDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'pc_ab12cd34' }),
    __metadata("design:type", String)
], IntakeResultDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], IntakeResultDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'true on the first submission, false on a re-submit' }),
    __metadata("design:type", Boolean)
], IntakeResultDto.prototype, "created", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Status-poll token, shown once on creation (not returned when the partner supplied its own)' }),
    __metadata("design:type", String)
], IntakeResultDto.prototype, "statusToken", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Intake key kxi_..., shown once: on creation and after a recovery re-enrolment' }),
    __metadata("design:type", String)
], IntakeResultDto.prototype, "intakeKey", void 0);
class PartnerStepDto {
    key;
    type;
    state;
    code;
    detail;
    actor;
    link;
}
exports.PartnerStepDto = PartnerStepDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PartnerStepDto.prototype, "key", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['AUTO', 'HUMAN'] }),
    __metadata("design:type", String)
], PartnerStepDto.prototype, "type", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['DONE', 'FAILED', 'WARN', 'PENDING', 'ACTION', 'LOCKED'] }),
    __metadata("design:type", String)
], PartnerStepDto.prototype, "state", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", String)
], PartnerStepDto.prototype, "code", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ type: 'object', additionalProperties: true }),
    __metadata("design:type", Object)
], PartnerStepDto.prototype, "detail", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: ['ops_admin', 'super_admin'], description: 'HUMAN steps: who may act' }),
    __metadata("design:type", String)
], PartnerStepDto.prototype, "actor", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", String)
], PartnerStepDto.prototype, "link", void 0);
class PartnerPublicStepDto {
    key;
    type;
    state;
}
exports.PartnerPublicStepDto = PartnerPublicStepDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PartnerPublicStepDto.prototype, "key", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['AUTO', 'HUMAN'] }),
    __metadata("design:type", String)
], PartnerPublicStepDto.prototype, "type", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PartnerPublicStepDto.prototype, "state", void 0);
class PartnerPublicStatusDto {
    id;
    kind;
    status;
    decisionReason;
    progress;
    steps;
    liveAt;
    updatedAt;
}
exports.PartnerPublicStatusDto = PartnerPublicStatusDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PartnerPublicStatusDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PartnerPublicStatusDto.prototype, "kind", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PartnerPublicStatusDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ nullable: true }),
    __metadata("design:type", Object)
], PartnerPublicStatusDto.prototype, "decisionReason", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], PartnerPublicStatusDto.prototype, "progress", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [PartnerPublicStepDto], description: 'key, type and state only (no internal detail)' }),
    __metadata("design:type", Array)
], PartnerPublicStatusDto.prototype, "steps", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ nullable: true }),
    __metadata("design:type", Object)
], PartnerPublicStatusDto.prototype, "liveAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PartnerPublicStatusDto.prototype, "updatedAt", void 0);
class PartnerConnectionRowDto {
    id;
    kind;
    name;
    nameAr;
    market;
    status;
    progress;
    humanActions;
    createdAt;
    updatedAt;
}
exports.PartnerConnectionRowDto = PartnerConnectionRowDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PartnerConnectionRowDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PartnerConnectionRowDto.prototype, "kind", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PartnerConnectionRowDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ nullable: true }),
    __metadata("design:type", Object)
], PartnerConnectionRowDto.prototype, "nameAr", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PartnerConnectionRowDto.prototype, "market", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PartnerConnectionRowDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Percent of steps done (0-100)' }),
    __metadata("design:type", Number)
], PartnerConnectionRowDto.prototype, "progress", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [String], description: 'Human step keys waiting for ops' }),
    __metadata("design:type", Array)
], PartnerConnectionRowDto.prototype, "humanActions", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PartnerConnectionRowDto.prototype, "createdAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PartnerConnectionRowDto.prototype, "updatedAt", void 0);
class PartnerConnectionDto extends PartnerConnectionRowDto {
    orgRef;
    baseUrl;
    clientKey;
    decisionReason;
    readiness;
    checksRunAt;
    requestedBy;
    approvedBy;
    liveAt;
    rotationPending;
    steps;
    blockers;
}
exports.PartnerConnectionDto = PartnerConnectionDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PartnerConnectionDto.prototype, "orgRef", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ nullable: true }),
    __metadata("design:type", Object)
], PartnerConnectionDto.prototype, "baseUrl", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ nullable: true }),
    __metadata("design:type", Object)
], PartnerConnectionDto.prototype, "clientKey", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ nullable: true }),
    __metadata("design:type", Object)
], PartnerConnectionDto.prototype, "decisionReason", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: 'object', additionalProperties: true, description: 'The partner\'s own readiness answers (no secrets)' }),
    __metadata("design:type", Object)
], PartnerConnectionDto.prototype, "readiness", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ nullable: true }),
    __metadata("design:type", Object)
], PartnerConnectionDto.prototype, "checksRunAt", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ nullable: true }),
    __metadata("design:type", Object)
], PartnerConnectionDto.prototype, "requestedBy", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ nullable: true }),
    __metadata("design:type", Object)
], PartnerConnectionDto.prototype, "approvedBy", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ nullable: true }),
    __metadata("design:type", Object)
], PartnerConnectionDto.prototype, "liveAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Boolean)
], PartnerConnectionDto.prototype, "rotationPending", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [PartnerStepDto] }),
    __metadata("design:type", Array)
], PartnerConnectionDto.prototype, "steps", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [String], description: 'Reasons go-live is still blocked' }),
    __metadata("design:type", Array)
], PartnerConnectionDto.prototype, "blockers", void 0);
class PartnerAuditLineDto {
    id;
    actor;
    action;
    metadata;
    createdAt;
}
exports.PartnerAuditLineDto = PartnerAuditLineDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PartnerAuditLineDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PartnerAuditLineDto.prototype, "actor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'e.g. submitted, approved, go_live' }),
    __metadata("design:type", String)
], PartnerAuditLineDto.prototype, "action", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: 'object', additionalProperties: true, nullable: true, description: 'Ids and codes only' }),
    __metadata("design:type", Object)
], PartnerAuditLineDto.prototype, "metadata", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PartnerAuditLineDto.prototype, "createdAt", void 0);
//# sourceMappingURL=partner-onboarding.dto.js.map