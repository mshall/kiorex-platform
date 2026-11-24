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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OnboardingImportController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const auth_1 = require("../common/auth");
const onboarding_import_service_1 = require("./onboarding-import.service");
const onboarding_import_dto_1 = require("./onboarding-import.dto");
const ACTIONS = ['MAP_TABLE', 'MAP_COLUMN', 'EDIT_VALUE', 'SKIP_ROW', 'MERGE', 'KEEP_BOTH', 'ASSIGN_PATIENT', 'ASSIGN_FILE', 'SKIP_FILE', 'ACCEPT_REPAIR', 'CHOOSE_DATE_FORMAT', 'IGNORE'];
class OnbCreateBatchBody {
    orgId;
    orgName;
    label;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1),
    (0, class_validator_1.MaxLength)(80),
    __metadata("design:type", String)
], OnbCreateBatchBody.prototype, "orgId", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1),
    (0, class_validator_1.MaxLength)(160),
    __metadata("design:type", String)
], OnbCreateBatchBody.prototype, "orgName", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(160),
    __metadata("design:type", String)
], OnbCreateBatchBody.prototype, "label", void 0);
class OnbUploadBody {
    name;
    contentBase64;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], OnbUploadBody.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], OnbUploadBody.prototype, "contentBase64", void 0);
class OnbResolveBody {
    action;
    params;
    reason;
}
__decorate([
    (0, class_validator_1.IsIn)(ACTIONS),
    __metadata("design:type", String)
], OnbResolveBody.prototype, "action", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsObject)(),
    __metadata("design:type", Object)
], OnbResolveBody.prototype, "params", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], OnbResolveBody.prototype, "reason", void 0);
class OnbResolveManyBody extends OnbResolveBody {
    ids;
}
__decorate([
    (0, class_validator_1.IsArray)(),
    __metadata("design:type", Array)
], OnbResolveManyBody.prototype, "ids", void 0);
class OnbApproveBody {
    reportHash;
}
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], OnbApproveBody.prototype, "reportHash", void 0);
class OnbReasonBody {
    reason;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], OnbReasonBody.prototype, "reason", void 0);
void class_validator_1.IsBoolean;
let OnboardingImportController = class OnboardingImportController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    create(u, b) { return this.svc.create(u, b); }
    list() { return this.svc.list(); }
    get(id) { return this.svc.get(id); }
    upload(u, id, req, qname) {
        if (Buffer.isBuffer(req.body)) {
            if (!qname)
                throw new common_1.BadRequestException({ code: 'NAME_REQUIRED', message: 'NAME_REQUIRED' });
            return this.svc.addFile(u, id, qname, req.body.toString('base64'));
        }
        const b = req.body;
        if (!b || typeof b.name !== 'string' || typeof b.contentBase64 !== 'string')
            throw new common_1.BadRequestException({ code: 'BAD_UPLOAD', message: 'BAD_UPLOAD' });
        return this.svc.addFile(u, id, b.name, b.contentBase64);
    }
    rescan(id) { return this.svc.reanalyze(id).then((a) => ({ ok: true, stats: a?.stats ?? null })); }
    tasks(id, status, severity, type, page, pageSize) { return this.svc.tasks(id, { status, severity, type, page: page ? +page : 1, pageSize: pageSize ? +pageSize : 50 }); }
    resolveMany(u, id, b) { return this.svc.resolveMany(u, id, b.ids, b); }
    resolve(u, id, taskId, b) { return this.svc.resolve(u, id, taskId, b); }
    patients(id, q) { return this.svc.patientsLookup(id, q ?? ''); }
    dryRun(id) { return this.svc.dryRun(id); }
    request(u, id) { return this.svc.requestCommit(u, id); }
    approve(u, id, b) { return this.svc.approve(u, id, b.reportHash); }
    reject(u, id, b) { return this.svc.reject(u, id, b.reason); }
    commit(u, id) { return this.svc.commit(u, id); }
    rollback(u, id, b) { return this.svc.rollback(u, id, b.reason); }
    purge(u, id) { return this.svc.purgeStaging(u, id); }
    audit(id) { return this.svc.auditTrail(id); }
};
exports.OnboardingImportController = OnboardingImportController;
__decorate([
    (0, common_1.Post)(),
    (0, swagger_1.ApiOperation)({ summary: 'Create an import batch for a target organization' }),
    (0, swagger_1.ApiCreatedResponse)({ type: onboarding_import_dto_1.ImportBatchDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, OnbCreateBatchBody]),
    __metadata("design:returntype", void 0)
], OnboardingImportController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'Import batches, newest first (max 100)' }),
    (0, swagger_1.ApiOkResponse)({ type: onboarding_import_dto_1.ImportBatchDto, isArray: true }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], OnboardingImportController.prototype, "list", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'One batch with its staged files' }),
    (0, swagger_1.ApiOkResponse)({ type: onboarding_import_dto_1.ImportBatchDetailDto }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], OnboardingImportController.prototype, "get", null);
__decorate([
    (0, common_1.Post)(':id/files'),
    (0, common_1.HttpCode)(201),
    (0, swagger_1.ApiOperation)({ summary: 'Upload one file into quarantine: JSON {name, contentBase64} or application/octet-stream with ?name=' }),
    (0, swagger_1.ApiCreatedResponse)({ type: onboarding_import_dto_1.ImportUploadResultDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Req)()),
    __param(3, (0, common_1.Query)('name')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object, String]),
    __metadata("design:returntype", void 0)
], OnboardingImportController.prototype, "upload", null);
__decorate([
    (0, common_1.Post)(':id/rescan'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'Re-run the deterministic analysis' }),
    (0, swagger_1.ApiOkResponse)({ type: onboarding_import_dto_1.ImportRescanDto }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], OnboardingImportController.prototype, "rescan", null);
__decorate([
    (0, common_1.Get)(':id/tasks'),
    (0, swagger_1.ApiOperation)({ summary: 'Resolution queue (paged, filter by status/severity/type)' }),
    (0, swagger_1.ApiOkResponse)({ type: onboarding_import_dto_1.ImportTaskPageDto }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Query)('status')),
    __param(2, (0, common_1.Query)('severity')),
    __param(3, (0, common_1.Query)('type')),
    __param(4, (0, common_1.Query)('page')),
    __param(5, (0, common_1.Query)('pageSize')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, String, String]),
    __metadata("design:returntype", void 0)
], OnboardingImportController.prototype, "tasks", null);
__decorate([
    (0, common_1.Post)(':id/tasks/resolve-many'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'Apply one resolution to up to 500 tasks' }),
    (0, swagger_1.ApiOkResponse)({ type: onboarding_import_dto_1.ImportResolveManyDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, OnbResolveManyBody]),
    __metadata("design:returntype", void 0)
], OnboardingImportController.prototype, "resolveMany", null);
__decorate([
    (0, common_1.Post)(':id/tasks/:taskId/resolve'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'Resolve one task' }),
    (0, swagger_1.ApiOkResponse)({ type: onboarding_import_dto_1.ImportResolveDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Param)('taskId')),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, OnbResolveBody]),
    __metadata("design:returntype", void 0)
], OnboardingImportController.prototype, "resolve", null);
__decorate([
    (0, common_1.Get)(':id/patients'),
    (0, swagger_1.ApiOperation)({ summary: 'Staged patient lookup for the merge / assign pickers (max 20)' }),
    (0, swagger_1.ApiOkResponse)({ type: onboarding_import_dto_1.ImportPatientHitDto, isArray: true }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Query)('q')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], OnboardingImportController.prototype, "patients", null);
__decorate([
    (0, common_1.Get)(':id/dry-run'),
    (0, swagger_1.ApiOperation)({ summary: 'Dry-run report: what a commit would create, blockers and the report hash to approve' }),
    (0, swagger_1.ApiOkResponse)({ type: onboarding_import_dto_1.ImportDryRunDto }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], OnboardingImportController.prototype, "dryRun", null);
__decorate([
    (0, common_1.Post)(':id/request-commit'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'Ask for approval (two-person rule step 1)' }),
    (0, swagger_1.ApiOkResponse)({ type: onboarding_import_dto_1.ImportRequestedDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], OnboardingImportController.prototype, "request", null);
__decorate([
    (0, auth_1.SuperAdminOnly)(),
    (0, common_1.Post)(':id/approve'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'SA: approve the exact report hash (not the requester or creator)' }),
    (0, swagger_1.ApiOkResponse)({ type: onboarding_import_dto_1.ImportRequestedDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, OnbApproveBody]),
    __metadata("design:returntype", void 0)
], OnboardingImportController.prototype, "approve", null);
__decorate([
    (0, auth_1.SuperAdminOnly)(),
    (0, common_1.Post)(':id/reject'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'SA: reject the commit request with a reason' }),
    (0, swagger_1.ApiOkResponse)({ type: onboarding_import_dto_1.ImportRequestedDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, OnbReasonBody]),
    __metadata("design:returntype", void 0)
], OnboardingImportController.prototype, "reject", null);
__decorate([
    (0, auth_1.SuperAdminOnly)(),
    (0, common_1.Post)(':id/commit'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'SA: commit the approved batch into the target clinic (idempotent items)' }),
    (0, swagger_1.ApiOkResponse)({ type: onboarding_import_dto_1.ImportRequestedDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], OnboardingImportController.prototype, "commit", null);
__decorate([
    (0, auth_1.SuperAdminOnly)(),
    (0, common_1.Post)(':id/rollback'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'SA: roll back a committed batch' }),
    (0, swagger_1.ApiOkResponse)({ type: onboarding_import_dto_1.ImportRequestedDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, OnbReasonBody]),
    __metadata("design:returntype", void 0)
], OnboardingImportController.prototype, "rollback", null);
__decorate([
    (0, auth_1.SuperAdminOnly)(),
    (0, common_1.Post)(':id/purge-staging'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'SA: delete the quarantined files and staging rows' }),
    (0, swagger_1.ApiOkResponse)({ type: onboarding_import_dto_1.ImportRequestedDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], OnboardingImportController.prototype, "purge", null);
__decorate([
    (0, common_1.Get)(':id/audit'),
    (0, swagger_1.ApiOperation)({ summary: 'Audit trail of the batch (ids and counts only)' }),
    (0, swagger_1.ApiOkResponse)({ type: onboarding_import_dto_1.ImportAuditLineDto, isArray: true }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], OnboardingImportController.prototype, "audit", null);
exports.OnboardingImportController = OnboardingImportController = __decorate([
    (0, swagger_1.ApiTags)('ops-onboarding'),
    (0, auth_1.OpsOnly)(),
    (0, common_1.Controller)('admin/onboarding/imports'),
    __metadata("design:paramtypes", [onboarding_import_service_1.OnboardingImportService])
], OnboardingImportController);
//# sourceMappingURL=onboarding-import.controller.js.map