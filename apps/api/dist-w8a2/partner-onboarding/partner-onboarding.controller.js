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
exports.VerificationUpdateController = exports.PartnerOnboardingController = exports.PartnerConnectionPublicController = exports.PartnerEnrolmentController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const auth_1 = require("../common/auth");
const contracts_1 = require("@kiorex/contracts");
const errors_1 = require("../common/errors");
const partner_enrolment_service_1 = require("./partner-enrolment.service");
const partner_onboarding_service_1 = require("./partner-onboarding.service");
const verification_update_consumer_1 = require("./verification-update.consumer");
const partner_onboarding_dto_1 = require("./partner-onboarding.dto");
class VerificationDecisionBody {
    decision;
    note;
}
__decorate([
    (0, class_validator_1.IsIn)(['APPROVED', 'REJECTED', 'NEEDS_INFO']),
    __metadata("design:type", String)
], VerificationDecisionBody.prototype, "decision", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(300),
    __metadata("design:type", String)
], VerificationDecisionBody.prototype, "note", void 0);
class PartnerNoteBody {
    note;
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], PartnerNoteBody.prototype, "note", void 0);
class LicenceBody {
    reference;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(80),
    __metadata("design:type", String)
], LicenceBody.prototype, "reference", void 0);
class FeesBody {
    mode;
    note;
}
__decorate([
    (0, class_validator_1.IsIn)(['STANDARD', 'ORG_OVERRIDE']),
    __metadata("design:type", String)
], FeesBody.prototype, "mode", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], FeesBody.prototype, "note", void 0);
class PartnerReasonBody {
    reason;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(300),
    __metadata("design:type", String)
], PartnerReasonBody.prototype, "reason", void 0);
class EnrolmentBody {
    kind;
    label;
    orgRef;
    ttlHours;
}
__decorate([
    (0, class_validator_1.IsIn)(['CLINIC', 'NURSE', 'PHARMACY', 'LAB']),
    __metadata("design:type", String)
], EnrolmentBody.prototype, "kind", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(120),
    __metadata("design:type", String)
], EnrolmentBody.prototype, "label", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(80),
    __metadata("design:type", String)
], EnrolmentBody.prototype, "orgRef", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(336),
    __metadata("design:type", Number)
], EnrolmentBody.prototype, "ttlHours", void 0);
let PartnerEnrolmentController = class PartnerEnrolmentController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    list(kind, status) { return this.svc.list({ kind, status }); }
    create(u, b) { return this.svc.create(u.sub, b); }
    revoke(u, id) { return this.svc.revoke(u.sub, id); }
};
exports.PartnerEnrolmentController = PartnerEnrolmentController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'OP: enrolment codes (never the code itself)' }),
    (0, swagger_1.ApiOkResponse)({ type: partner_onboarding_dto_1.EnrolmentViewDto, isArray: true }),
    __param(0, (0, common_1.Query)('kind')),
    __param(1, (0, common_1.Query)('status')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], PartnerEnrolmentController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    (0, common_1.HttpCode)(201),
    (0, swagger_1.ApiOperation)({ summary: 'OP: create a one-time enrolment code; the code is in this response only' }),
    (0, swagger_1.ApiCreatedResponse)({ type: partner_onboarding_dto_1.EnrolmentCreatedDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, EnrolmentBody]),
    __metadata("design:returntype", void 0)
], PartnerEnrolmentController.prototype, "create", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'OP: revoke an unused enrolment code' }),
    (0, swagger_1.ApiOkResponse)({ type: partner_onboarding_dto_1.EnrolmentViewDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], PartnerEnrolmentController.prototype, "revoke", null);
exports.PartnerEnrolmentController = PartnerEnrolmentController = __decorate([
    (0, swagger_1.ApiTags)('ops-onboarding'),
    (0, auth_1.OpsOnly)(),
    (0, common_1.Controller)('admin/onboarding/enrolments'),
    __metadata("design:paramtypes", [partner_enrolment_service_1.PartnerEnrolmentService])
], PartnerEnrolmentController);
let PartnerConnectionPublicController = class PartnerConnectionPublicController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    intake(req, sig, ts, enrolment) {
        if (!req.rawBody)
            throw new errors_1.ApiError(400, 'RAW_BODY_REQUIRED', 'raw body unavailable');
        if (req.rawBody.length > contracts_1.INTAKE_MAX_BODY_BYTES)
            throw new errors_1.ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
        return this.svc.intake(req.rawBody.toString('utf8'), { signature: sig, timestamp: ts, enrolment, ip: req.ip });
    }
    status(req, id, token) { return this.svc.partnerStatus(id, token, req.ip); }
};
exports.PartnerConnectionPublicController = PartnerConnectionPublicController;
__decorate([
    (0, auth_1.Public)(),
    (0, common_1.Post)(),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'Submit / re-submit a connection request (HMAC-signed with ts.rawBody); idempotent per (kind, orgRef)' }),
    (0, swagger_1.ApiOkResponse)({ type: partner_onboarding_dto_1.IntakeResultDto }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Headers)('x-kiorly-signature')),
    __param(2, (0, common_1.Headers)('x-kiorly-timestamp')),
    __param(3, (0, common_1.Headers)('x-kiorex-enrolment')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], PartnerConnectionPublicController.prototype, "intake", null);
__decorate([
    (0, auth_1.Public)(),
    (0, common_1.Get)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Partner polls its own status with the status token returned at creation' }),
    (0, swagger_1.ApiOkResponse)({ type: partner_onboarding_dto_1.PartnerPublicStatusDto }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Headers)('x-connection-token')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], PartnerConnectionPublicController.prototype, "status", null);
exports.PartnerConnectionPublicController = PartnerConnectionPublicController = __decorate([
    (0, swagger_1.ApiTags)('partner-connections'),
    (0, common_1.Controller)('partners/v1/connection-requests'),
    __metadata("design:paramtypes", [partner_onboarding_service_1.PartnerOnboardingService])
], PartnerConnectionPublicController);
let PartnerOnboardingController = class PartnerOnboardingController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    list(status, kind) { return this.svc.list({ status, kind }); }
    get(id) { return this.svc.get(id); }
    audit(id) { return this.svc.auditTrail(id); }
    run(u, id) { return this.svc.runChecks(u.sub, id); }
    docs(u, id, b) { return this.svc.reviewDocuments(u.sub, id, b.note); }
    lic(u, id, b) { return this.svc.verifyLicence(u.sub, id, b.reference); }
    fees(u, id, b) { return this.svc.confirmFees(u.sub, id, b.mode, b.note); }
    changes(u, id, b) { return this.svc.requestChanges(u.sub, id, b.reason); }
    reject(u, id, b) { return this.svc.reject(u.sub, id, b.reason); }
    request(u, id) { return this.svc.requestApproval(u.sub, id); }
    approve(u, id) { return this.svc.approve(u.sub, id); }
    live(u, id) { return this.svc.goLive(u.sub, id); }
    pause(u, id, b) { return this.svc.pause(u.sub, id, b.reason); }
    resume(u, id) { return this.svc.resume(u.sub, id); }
    rotate(u, id) { return this.svc.applyRotation(u.sub, id); }
};
exports.PartnerOnboardingController = PartnerOnboardingController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'OP: connection requests (queue)' }),
    (0, swagger_1.ApiOkResponse)({ type: partner_onboarding_dto_1.PartnerConnectionRowDto, isArray: true }),
    __param(0, (0, common_1.Query)('status')),
    __param(1, (0, common_1.Query)('kind')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], PartnerOnboardingController.prototype, "list", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'OP: one connection request with its computed steps and go-live blockers' }),
    (0, swagger_1.ApiOkResponse)({ type: partner_onboarding_dto_1.PartnerConnectionDto }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], PartnerOnboardingController.prototype, "get", null);
__decorate([
    (0, common_1.Get)(':id/audit'),
    (0, swagger_1.ApiOperation)({ summary: 'OP: audit trail of the request' }),
    (0, swagger_1.ApiOkResponse)({ type: partner_onboarding_dto_1.PartnerAuditLineDto, isArray: true }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], PartnerOnboardingController.prototype, "audit", null);
__decorate([
    (0, common_1.Post)(':id/run-checks'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'OP: run the automatic checks now' }),
    (0, swagger_1.ApiOkResponse)({ type: partner_onboarding_dto_1.PartnerConnectionDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], PartnerOnboardingController.prototype, "run", null);
__decorate([
    (0, common_1.Post)(':id/steps/review_documents'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'OP: mark the documents reviewed' }),
    (0, swagger_1.ApiOkResponse)({ type: partner_onboarding_dto_1.PartnerConnectionDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, PartnerNoteBody]),
    __metadata("design:returntype", void 0)
], PartnerOnboardingController.prototype, "docs", null);
__decorate([
    (0, common_1.Post)(':id/steps/verify_licence'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'OP: record the licence verification reference' }),
    (0, swagger_1.ApiOkResponse)({ type: partner_onboarding_dto_1.PartnerConnectionDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, LicenceBody]),
    __metadata("design:returntype", void 0)
], PartnerOnboardingController.prototype, "lic", null);
__decorate([
    (0, common_1.Post)(':id/steps/fees'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'OP: confirm the fee mode (standard or org override)' }),
    (0, swagger_1.ApiOkResponse)({ type: partner_onboarding_dto_1.PartnerConnectionDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, FeesBody]),
    __metadata("design:returntype", void 0)
], PartnerOnboardingController.prototype, "fees", null);
__decorate([
    (0, common_1.Post)(':id/request-changes'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'OP: send the request back to the partner with a reason' }),
    (0, swagger_1.ApiOkResponse)({ type: partner_onboarding_dto_1.PartnerConnectionDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, PartnerReasonBody]),
    __metadata("design:returntype", void 0)
], PartnerOnboardingController.prototype, "changes", null);
__decorate([
    (0, common_1.Post)(':id/reject'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'OP: reject the request with a reason' }),
    (0, swagger_1.ApiOkResponse)({ type: partner_onboarding_dto_1.PartnerConnectionDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, PartnerReasonBody]),
    __metadata("design:returntype", void 0)
], PartnerOnboardingController.prototype, "reject", null);
__decorate([
    (0, common_1.Post)(':id/request-approval'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'OP: ask a super admin to approve (two-person rule)' }),
    (0, swagger_1.ApiOkResponse)({ type: partner_onboarding_dto_1.PartnerConnectionDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], PartnerOnboardingController.prototype, "request", null);
__decorate([
    (0, auth_1.SuperAdminOnly)(),
    (0, common_1.Post)(':id/approve'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'SA: approve (never the requester or the licence verifier)' }),
    (0, swagger_1.ApiOkResponse)({ type: partner_onboarding_dto_1.PartnerConnectionDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], PartnerOnboardingController.prototype, "approve", null);
__decorate([
    (0, common_1.Post)(':id/go-live'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'OP: register the partner and switch it live (idempotent)' }),
    (0, swagger_1.ApiOkResponse)({ type: partner_onboarding_dto_1.PartnerConnectionDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], PartnerOnboardingController.prototype, "live", null);
__decorate([
    (0, common_1.Post)(':id/pause'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'OP: pause a live partner with a reason' }),
    (0, swagger_1.ApiOkResponse)({ type: partner_onboarding_dto_1.PartnerConnectionDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, PartnerReasonBody]),
    __metadata("design:returntype", void 0)
], PartnerOnboardingController.prototype, "pause", null);
__decorate([
    (0, common_1.Post)(':id/resume'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'OP: resume a paused partner' }),
    (0, swagger_1.ApiOkResponse)({ type: partner_onboarding_dto_1.PartnerConnectionDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], PartnerOnboardingController.prototype, "resume", null);
__decorate([
    (0, common_1.Post)(':id/apply-rotation'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'OP: apply a pending credential rotation after a passing handshake' }),
    (0, swagger_1.ApiOkResponse)({ type: partner_onboarding_dto_1.PartnerConnectionDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], PartnerOnboardingController.prototype, "rotate", null);
exports.PartnerOnboardingController = PartnerOnboardingController = __decorate([
    (0, swagger_1.ApiTags)('ops-onboarding'),
    (0, auth_1.OpsOnly)(),
    (0, common_1.Controller)('admin/onboarding/partners'),
    __metadata("design:paramtypes", [partner_onboarding_service_1.PartnerOnboardingService])
], PartnerOnboardingController);
let VerificationUpdateController = class VerificationUpdateController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    list(status) { return this.svc.list({ status }); }
    get(ref) { return this.svc.detail(ref); }
    decide(u, ref, b) { return this.svc.decide(u.sub, ref, b.decision, b.note); }
};
exports.VerificationUpdateController = VerificationUpdateController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'OP: provider verification update requests (open first)' }),
    __param(0, (0, common_1.Query)('status')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], VerificationUpdateController.prototype, "list", null);
__decorate([
    (0, common_1.Get)(':ref'),
    (0, swagger_1.ApiOperation)({ summary: 'OP: one request with the requested value and evidence references read live from the Clinic' }),
    __param(0, (0, common_1.Param)('ref')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], VerificationUpdateController.prototype, "get", null);
__decorate([
    (0, common_1.Post)(':ref/decide'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'OP: approve, reject or ask for more information; the decision is delivered to the Clinic (ProviderVerificationDecided)' }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('ref')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, VerificationDecisionBody]),
    __metadata("design:returntype", void 0)
], VerificationUpdateController.prototype, "decide", null);
exports.VerificationUpdateController = VerificationUpdateController = __decorate([
    (0, swagger_1.ApiTags)('ops-onboarding'),
    (0, auth_1.OpsOnly)(),
    (0, common_1.Controller)('admin/onboarding/verification-updates'),
    __metadata("design:paramtypes", [verification_update_consumer_1.VerificationUpdateService])
], VerificationUpdateController);
//# sourceMappingURL=partner-onboarding.controller.js.map