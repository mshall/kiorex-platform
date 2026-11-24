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
exports.VaultController = exports.FollowUpCreateBody = exports.FollowUpBody = exports.RecordShareBody = exports.UploadBody = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const auth_1 = require("../common/auth");
const control_plane_public_1 = require("../control-plane/control-plane-public");
const records_dto_1 = require("./records.dto");
const records_service_1 = require("./records.service");
class UploadBody {
    fileName;
    mimeType;
    contentBase64;
    title;
}
exports.UploadBody = UploadBody;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(160),
    __metadata("design:type", String)
], UploadBody.prototype, "fileName", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UploadBody.prototype, "mimeType", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UploadBody.prototype, "contentBase64", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(120),
    __metadata("design:type", String)
], UploadBody.prototype, "title", void 0);
class RecordShareBody {
    granted;
}
exports.RecordShareBody = RecordShareBody;
__decorate([
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], RecordShareBody.prototype, "granted", void 0);
class FollowUpBody {
    afterDays;
}
exports.FollowUpBody = FollowUpBody;
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(730),
    __metadata("design:type", Number)
], FollowUpBody.prototype, "afterDays", void 0);
class FollowUpCreateBody {
    afterDays;
    recordId;
}
exports.FollowUpCreateBody = FollowUpCreateBody;
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(730),
    __metadata("design:type", Number)
], FollowUpCreateBody.prototype, "afterDays", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], FollowUpCreateBody.prototype, "recordId", void 0);
let VaultController = class VaultController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    list(u, kind) { return this.svc.list(u.sub, kind); }
    upload(u, b) { return this.svc.upload(u.sub, b); }
    detail(u, id) { return this.svc.detail(u.sub, id); }
    async content(u, id) {
        const f = await this.svc.content(u.sub, id);
        return new common_1.StreamableFile(f.bytes, { type: f.mimeType, disposition: `attachment; filename="${encodeURIComponent(f.fileName)}"` });
    }
    remove(u, id) { return this.svc.remove(u.sub, id); }
    sharing(u) { return this.svc.sharing(u.sub); }
    setSharing(u, scope, b) { return this.svc.setSharing(u.sub, scope, b.granted); }
    prescriptions(u) { return this.svc.prescriptions(u.sub); }
    verify(t) { return this.svc.verifyRx(t); }
    followUps(u) { return this.svc.followUps(u.sub); }
    async createFollowUp(u, b) { return b.recordId ? this.svc.followUpForOwner(u.sub, b.recordId, b.afterDays) : this.svc.createFollowUp({ sub: u.sub, afterDays: b.afterDays, source: 'PATIENT' }); }
    cancelFollowUp(u, id) { return this.svc.cancelFollowUp(u.sub, id); }
};
exports.VaultController = VaultController;
__decorate([
    (0, common_1.Get)('me/vault'),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-RC-01 patient vault: shared + uploaded records (always readable; readOnly=true when kiorex.record_vault is OFF)' }),
    (0, swagger_1.ApiOkResponse)({ type: records_dto_1.VaultListDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Query)('kind')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], VaultController.prototype, "list", null);
__decorate([
    (0, common_1.Post)('me/vault/uploads'),
    (0, common_1.HttpCode)(201),
    (0, control_plane_public_1.RequiresFlag)('kiorex.record_vault'),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-RC-01 upload a PDF/JPEG/PNG to the vault (flag kiorex.record_vault; JSON base64, stored encrypted via the storage adapter)' }),
    (0, swagger_1.ApiCreatedResponse)({ type: records_dto_1.VaultItemDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, UploadBody]),
    __metadata("design:returntype", void 0)
], VaultController.prototype, "upload", null);
__decorate([
    (0, common_1.Get)('me/vault/:id'),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-RC-01 view a record (owner only; prescriptions include the verification QR payload)' }),
    (0, swagger_1.ApiOkResponse)({ type: records_dto_1.VaultDetailDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], VaultController.prototype, "detail", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ description: 'The uploaded file (application/pdf, image/jpeg, image/png)', schema: { type: 'string', format: 'binary' } }),
    (0, common_1.Get)('me/vault/:id/content'),
    (0, swagger_1.ApiOperation)({ summary: 'Download an uploaded file (decrypted on the fly, owner only)' }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], VaultController.prototype, "content", null);
__decorate([
    (0, common_1.Delete)('me/vault/:id'),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-RC-01 revoke/delete a record from the vault (always allowed, even when the vault flag is OFF)' }),
    (0, swagger_1.ApiOkResponse)({ type: records_dto_1.OkDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], VaultController.prototype, "remove", null);
__decorate([
    (0, common_1.Get)('me/record-sharing'),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-RC-01 record-share consent per scope (VISIT_SUMMARY, PRESCRIPTIONS, LAB_RESULTS, SHARE_WITH_OTHER_CLINICS)' }),
    (0, swagger_1.ApiOkResponse)({ type: records_dto_1.RecordSharingDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], VaultController.prototype, "sharing", null);
__decorate([
    (0, common_1.Put)('me/record-sharing/:scope'),
    (0, swagger_1.ApiOperation)({ summary: 'Grant (needs flags kiorex.record_vault + clinic.record_share_patient_app) or revoke (always allowed; deletes Kiorex copies and tells Kiorly)' }),
    (0, swagger_1.ApiOkResponse)({ type: records_dto_1.RecordSharingDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('scope')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, RecordShareBody]),
    __metadata("design:returntype", void 0)
], VaultController.prototype, "setSharing", null);
__decorate([
    (0, common_1.Get)('me/prescriptions'),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-RC-02 prescriptions with verification QR payloads' }),
    (0, swagger_1.ApiOkResponse)({ type: records_dto_1.PrescriptionItemDto, isArray: true }),
    __param(0, (0, auth_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], VaultController.prototype, "prescriptions", null);
__decorate([
    (0, auth_1.Public)(),
    (0, common_1.Get)('rx/verify'),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-RC-02 pharmacist check of a prescription QR token: validity, issuing clinic id and signed date only (no patient data)' }),
    (0, swagger_1.ApiOkResponse)({ type: records_dto_1.RxVerifyResultDto }),
    __param(0, (0, common_1.Query)('t')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], VaultController.prototype, "verify", null);
__decorate([
    (0, common_1.Get)('me/follow-ups'),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-RC-03 follow-up reminders (doctor-specified or patient-set)' }),
    (0, swagger_1.ApiOkResponse)({ type: records_dto_1.FollowUpDto, isArray: true }),
    __param(0, (0, auth_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], VaultController.prototype, "followUps", null);
__decorate([
    (0, common_1.Post)('me/follow-ups'),
    (0, common_1.HttpCode)(201),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-RC-03 set a follow-up reminder N days from now (optionally tied to a vault record)' }),
    (0, swagger_1.ApiCreatedResponse)({ type: records_dto_1.FollowUpDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, FollowUpCreateBody]),
    __metadata("design:returntype", Promise)
], VaultController.prototype, "createFollowUp", null);
__decorate([
    (0, common_1.Delete)('me/follow-ups/:id'),
    (0, swagger_1.ApiOkResponse)({ type: records_dto_1.OkDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], VaultController.prototype, "cancelFollowUp", null);
exports.VaultController = VaultController = __decorate([
    (0, swagger_1.ApiTags)('records'),
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [records_service_1.RecordsService])
], VaultController);
//# sourceMappingURL=vault.controller.js.map