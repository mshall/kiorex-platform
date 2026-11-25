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
exports.ImportAuditLineDto = exports.ImportRequestedDto = exports.ImportDryRunDto = exports.ImportTaskBreakdownDto = exports.ImportPatientHitDto = exports.ImportResolveDto = exports.ImportResolveManyDto = exports.ImportTaskPageDto = exports.ImportTaskDto = exports.ImportTaskCountDto = exports.ImportRescanDto = exports.ImportUploadResultDto = exports.ImportBatchDetailDto = exports.ImportFileViewDto = exports.ImportBatchDto = void 0;
const swagger_1 = require("@nestjs/swagger");
class ImportBatchDto {
    id;
    orgId;
    orgName;
    label;
    status;
    createdBy;
    requestedBy;
    approvedBy;
    reportHash;
    summary;
    progress;
    createdAt;
    updatedAt;
}
exports.ImportBatchDto = ImportBatchDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], ImportBatchDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Target Kiorly Clinic organisation id' }),
    __metadata("design:type", String)
], ImportBatchDto.prototype, "orgId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], ImportBatchDto.prototype, "orgName", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ nullable: true }),
    __metadata("design:type", Object)
], ImportBatchDto.prototype, "label", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['DRAFT', 'NEEDS_REVIEW', 'READY', 'AWAITING_APPROVAL', 'APPROVED', 'COMMITTING', 'COMMIT_FAILED', 'COMMITTED', 'ROLLING_BACK', 'ROLLED_BACK'] }),
    __metadata("design:type", String)
], ImportBatchDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], ImportBatchDto.prototype, "createdBy", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ nullable: true }),
    __metadata("design:type", Object)
], ImportBatchDto.prototype, "requestedBy", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ nullable: true }),
    __metadata("design:type", Object)
], ImportBatchDto.prototype, "approvedBy", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ nullable: true, description: 'sha256 of the dry-run report the approver signed off' }),
    __metadata("design:type", Object)
], ImportBatchDto.prototype, "reportHash", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: 'object', additionalProperties: true, nullable: true, description: 'Last analysis: classification, mappings, stats (no row data)' }),
    __metadata("design:type", Object)
], ImportBatchDto.prototype, "summary", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: 'object', additionalProperties: true, nullable: true, description: 'Per-entity committed counts, last error code' }),
    __metadata("design:type", Object)
], ImportBatchDto.prototype, "progress", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], ImportBatchDto.prototype, "createdAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], ImportBatchDto.prototype, "updatedAt", void 0);
class ImportFileViewDto {
    id;
    name;
    kind;
    rejectReason;
    size;
    sha256;
    meta;
    createdAt;
}
exports.ImportFileViewDto = ImportFileViewDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], ImportFileViewDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], ImportFileViewDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], ImportFileViewDto.prototype, "kind", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ nullable: true }),
    __metadata("design:type", Object)
], ImportFileViewDto.prototype, "rejectReason", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], ImportFileViewDto.prototype, "size", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], ImportFileViewDto.prototype, "sha256", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: 'object', additionalProperties: true, nullable: true }),
    __metadata("design:type", Object)
], ImportFileViewDto.prototype, "meta", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], ImportFileViewDto.prototype, "createdAt", void 0);
class ImportBatchDetailDto extends ImportBatchDto {
    files;
}
exports.ImportBatchDetailDto = ImportBatchDetailDto;
__decorate([
    (0, swagger_1.ApiProperty)({ type: [ImportFileViewDto] }),
    __metadata("design:type", Array)
], ImportBatchDetailDto.prototype, "files", void 0);
class ImportUploadResultDto {
    id;
    kind;
    rejectReason;
}
exports.ImportUploadResultDto = ImportUploadResultDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], ImportUploadResultDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'File class, or REJECTED with rejectReason' }),
    __metadata("design:type", String)
], ImportUploadResultDto.prototype, "kind", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", String)
], ImportUploadResultDto.prototype, "rejectReason", void 0);
class ImportRescanDto {
    ok;
    stats;
}
exports.ImportRescanDto = ImportRescanDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Boolean)
], ImportRescanDto.prototype, "ok", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: 'object', additionalProperties: true, nullable: true }),
    __metadata("design:type", Object)
], ImportRescanDto.prototype, "stats", void 0);
class ImportTaskCountDto {
    status;
    severity;
    count;
}
exports.ImportTaskCountDto = ImportTaskCountDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], ImportTaskCountDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], ImportTaskCountDto.prototype, "severity", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], ImportTaskCountDto.prototype, "count", void 0);
class ImportTaskDto {
    id;
    status;
    resolvedBy;
    type;
    severity;
}
exports.ImportTaskDto = ImportTaskDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], ImportTaskDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['OPEN', 'RESOLVED', 'IGNORED'] }),
    __metadata("design:type", String)
], ImportTaskDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ nullable: true }),
    __metadata("design:type", Object)
], ImportTaskDto.prototype, "resolvedBy", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'The task payload (type, severity, entity, options); never row values' }),
    __metadata("design:type", String)
], ImportTaskDto.prototype, "type", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['BLOCKER', 'WARNING', 'INFO'] }),
    __metadata("design:type", String)
], ImportTaskDto.prototype, "severity", void 0);
class ImportTaskPageDto {
    total;
    page;
    pageSize;
    counts;
    items;
}
exports.ImportTaskPageDto = ImportTaskPageDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], ImportTaskPageDto.prototype, "total", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], ImportTaskPageDto.prototype, "page", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], ImportTaskPageDto.prototype, "pageSize", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [ImportTaskCountDto] }),
    __metadata("design:type", Array)
], ImportTaskPageDto.prototype, "counts", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [ImportTaskDto] }),
    __metadata("design:type", Array)
], ImportTaskPageDto.prototype, "items", void 0);
class ImportResolveManyDto {
    ok;
    resolved;
}
exports.ImportResolveManyDto = ImportResolveManyDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Boolean)
], ImportResolveManyDto.prototype, "ok", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Tasks resolved' }),
    __metadata("design:type", Number)
], ImportResolveManyDto.prototype, "resolved", void 0);
class ImportResolveDto {
    ok;
    open;
}
exports.ImportResolveDto = ImportResolveDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Boolean)
], ImportResolveDto.prototype, "ok", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Open tasks left' }),
    __metadata("design:type", Number)
], ImportResolveDto.prototype, "open", void 0);
class ImportPatientHitDto {
    sourceKey;
    name;
    phone;
}
exports.ImportPatientHitDto = ImportPatientHitDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], ImportPatientHitDto.prototype, "sourceKey", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ nullable: true }),
    __metadata("design:type", Object)
], ImportPatientHitDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ nullable: true }),
    __metadata("design:type", Object)
], ImportPatientHitDto.prototype, "phone", void 0);
class ImportTaskBreakdownDto {
    type;
    status;
    count;
}
exports.ImportTaskBreakdownDto = ImportTaskBreakdownDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], ImportTaskBreakdownDto.prototype, "type", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], ImportTaskBreakdownDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], ImportTaskBreakdownDto.prototype, "count", void 0);
class ImportDryRunDto {
    batchId;
    status;
    orgId;
    orgName;
    reportHash;
    canCommit;
    willCreate;
    filesToAttach;
    mergedPatients;
    skippedFiles;
    openBlockers;
    openWarnings;
    ignoredWithReason;
    taskBreakdown;
    targetMode;
    progress;
}
exports.ImportDryRunDto = ImportDryRunDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], ImportDryRunDto.prototype, "batchId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], ImportDryRunDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", String)
], ImportDryRunDto.prototype, "orgId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", String)
], ImportDryRunDto.prototype, "orgName", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'sha256 of the report: what the approver signs off' }),
    __metadata("design:type", String)
], ImportDryRunDto.prototype, "reportHash", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", Boolean)
], ImportDryRunDto.prototype, "canCommit", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ type: 'object', additionalProperties: true, description: 'Rows per entity that would be created' }),
    __metadata("design:type", Object)
], ImportDryRunDto.prototype, "willCreate", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", Number)
], ImportDryRunDto.prototype, "filesToAttach", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", Number)
], ImportDryRunDto.prototype, "mergedPatients", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", Number)
], ImportDryRunDto.prototype, "skippedFiles", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", Number)
], ImportDryRunDto.prototype, "openBlockers", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", Number)
], ImportDryRunDto.prototype, "openWarnings", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", Number)
], ImportDryRunDto.prototype, "ignoredWithReason", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ type: [ImportTaskBreakdownDto] }),
    __metadata("design:type", Array)
], ImportDryRunDto.prototype, "taskBreakdown", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", String)
], ImportDryRunDto.prototype, "targetMode", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ type: 'object', additionalProperties: true, nullable: true, description: 'Committed batches only: the per-entity progress' }),
    __metadata("design:type", Object)
], ImportDryRunDto.prototype, "progress", void 0);
class ImportRequestedDto {
    ok;
    reportHash;
    committed;
    removed;
}
exports.ImportRequestedDto = ImportRequestedDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Boolean)
], ImportRequestedDto.prototype, "ok", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", String)
], ImportRequestedDto.prototype, "reportHash", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ type: 'object', additionalProperties: true }),
    __metadata("design:type", Object)
], ImportRequestedDto.prototype, "committed", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", Number)
], ImportRequestedDto.prototype, "removed", void 0);
class ImportAuditLineDto {
    id;
    actor;
    action;
    resource;
    resourceId;
    metadata;
    createdAt;
}
exports.ImportAuditLineDto = ImportAuditLineDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], ImportAuditLineDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], ImportAuditLineDto.prototype, "actor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], ImportAuditLineDto.prototype, "action", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], ImportAuditLineDto.prototype, "resource", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ nullable: true }),
    __metadata("design:type", Object)
], ImportAuditLineDto.prototype, "resourceId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: 'object', additionalProperties: true, nullable: true, description: 'Ids and counts only' }),
    __metadata("design:type", Object)
], ImportAuditLineDto.prototype, "metadata", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], ImportAuditLineDto.prototype, "createdAt", void 0);
//# sourceMappingURL=onboarding-import.dto.js.map