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
exports.PatientController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const consent_service_1 = require("./consent/consent.service");
const auth_public_1 = require("../auth/auth-public");
const auth_1 = require("../common/auth");
const control_plane_public_1 = require("../control-plane/control-plane-public");
const patient_service_1 = require("./patient.service");
const patient_dto_1 = require("./patient.dto");
const dto_1 = require("../common/dto");
class ProfileBody {
    nameEn;
    nameAr;
    dateOfBirth;
    gender;
    nationalId;
    preferredLocale;
    email;
    market;
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(120),
    __metadata("design:type", String)
], ProfileBody.prototype, "nameEn", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(120),
    __metadata("design:type", String)
], ProfileBody.prototype, "nameAr", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], ProfileBody.prototype, "dateOfBirth", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['MALE', 'FEMALE']),
    __metadata("design:type", String)
], ProfileBody.prototype, "gender", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", Object)
], ProfileBody.prototype, "nationalId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['ar', 'en']),
    __metadata("design:type", String)
], ProfileBody.prototype, "preferredLocale", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEmail)(),
    __metadata("design:type", String)
], ProfileBody.prototype, "email", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(2),
    __metadata("design:type", String)
], ProfileBody.prototype, "market", void 0);
class DependantBody {
    nameEn;
    nameAr;
    dateOfBirth;
    gender;
    relationship;
    evidence;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(120),
    __metadata("design:type", String)
], DependantBody.prototype, "nameEn", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(120),
    __metadata("design:type", String)
], DependantBody.prototype, "nameAr", void 0);
__decorate([
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], DependantBody.prototype, "dateOfBirth", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['MALE', 'FEMALE']),
    __metadata("design:type", String)
], DependantBody.prototype, "gender", void 0);
__decorate([
    (0, class_validator_1.IsIn)(['CHILD', 'PARENT', 'SPOUSE', 'OTHER']),
    __metadata("design:type", String)
], DependantBody.prototype, "relationship", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], DependantBody.prototype, "evidence", void 0);
class DependantPatch {
    nameEn;
    nameAr;
    gender;
    relationship;
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], DependantPatch.prototype, "nameEn", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], DependantPatch.prototype, "nameAr", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['MALE', 'FEMALE']),
    __metadata("design:type", String)
], DependantPatch.prototype, "gender", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], DependantPatch.prototype, "relationship", void 0);
class ConsentBody {
    granted;
    source;
    textVersion;
    evidence;
}
__decorate([
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], ConsentBody.prototype, "granted", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)([...consent_service_1.CONSENT_SOURCES]),
    __metadata("design:type", String)
], ConsentBody.prototype, "source", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(64),
    __metadata("design:type", String)
], ConsentBody.prototype, "textVersion", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(64),
    __metadata("design:type", String)
], ConsentBody.prototype, "evidence", void 0);
class DeleteBody {
    confirm;
    includeExport;
}
__decorate([
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], DeleteBody.prototype, "confirm", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], DeleteBody.prototype, "includeExport", void 0);
let PatientController = class PatientController {
    svc;
    sessions;
    constructor(svc, sessions) {
        this.svc = svc;
        this.sessions = sessions;
    }
    profile(u) { return this.svc.getProfile(u); }
    update(u, b) { return this.svc.updateProfile(u, b); }
    deps(u) { return this.svc.listDependants(u.sub); }
    addDep(u, b) { return this.svc.addDependant(u, b); }
    patchDep(u, id, b) { return this.svc.updateDependant(u.sub, id, b); }
    delDep(u, id) { return this.svc.removeDependant(u.sub, id); }
    consents(u) { return this.svc.consents(u.sub); }
    consentHistory(u) { return this.svc.consentHistory(u.sub); }
    setConsent(u, purpose, b, req) { return this.svc.setConsent(u.sub, purpose, b.granted, { source: b.source ?? 'app', textVersion: b.textVersion, evidence: b.evidence, ip: req.ip }); }
    sessionsList(u) { return this.sessions.list(u.sub, u.sid); }
    revoke(u, id) { return this.sessions.revoke(u.sub, id); }
    links(u) { return this.svc.links(u.sub); }
    export(u) { return this.svc.requestExport(u.sub); }
    async deletion(u, b) {
        if (!b.confirm)
            return { ok: false, deleted: false, code: 'CONFIRMATION_REQUIRED' };
        return this.svc.requestDeletion(u.sub, { includeExport: b.includeExport });
    }
};
exports.PatientController = PatientController;
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: patient_dto_1.PatientProfileDto }),
    (0, common_1.Get)('profile'),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-AC-02 profile (national ID masked)' }),
    __param(0, (0, auth_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], PatientController.prototype, "profile", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: patient_dto_1.PatientProfileDto }),
    (0, common_1.Put)('profile'),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-AC-02 update profile; national ID encrypted at rest' }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, ProfileBody]),
    __metadata("design:returntype", void 0)
], PatientController.prototype, "update", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: patient_dto_1.DependantDto, isArray: true }),
    (0, common_1.Get)('dependants'),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-AC-03 list family members' }),
    __param(0, (0, auth_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], PatientController.prototype, "deps", null);
__decorate([
    (0, swagger_1.ApiCreatedResponse)({ type: patient_dto_1.DependantDto }),
    (0, common_1.Post)('dependants'),
    (0, control_plane_public_1.RequiresFlag)('kiorex.family_accounts'),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-AC-03 add dependant (flag kiorex.family_accounts)' }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, DependantBody]),
    __metadata("design:returntype", void 0)
], PatientController.prototype, "addDep", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: patient_dto_1.DependantDto }),
    (0, common_1.Patch)('dependants/:id'),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, DependantPatch]),
    __metadata("design:returntype", void 0)
], PatientController.prototype, "patchDep", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: dto_1.OkDto }),
    (0, common_1.Delete)('dependants/:id'),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], PatientController.prototype, "delDep", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: patient_dto_1.ConsentStateDto, isArray: true }),
    (0, common_1.Get)('consents'),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-AC-04 consent centre — current state' }),
    __param(0, (0, auth_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], PatientController.prototype, "consents", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: patient_dto_1.ConsentRecordDto, isArray: true }),
    (0, common_1.Get)('consents/history'),
    __param(0, (0, auth_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], PatientController.prototype, "consentHistory", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: patient_dto_1.ConsentSetResultDto }),
    (0, common_1.Put)('consents/:purpose'),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-AC-04 grant or withdraw a consent' }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('purpose')),
    __param(2, (0, common_1.Body)()),
    __param(3, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, ConsentBody, Object]),
    __metadata("design:returntype", void 0)
], PatientController.prototype, "setConsent", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: patient_dto_1.AuthSessionDto, isArray: true }),
    (0, common_1.Get)('sessions'),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-AC-05 device/session list' }),
    __param(0, (0, auth_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], PatientController.prototype, "sessionsList", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: dto_1.OkDto }),
    (0, common_1.Delete)('sessions/:id'),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-AC-05 remote sign-out' }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], PatientController.prototype, "revoke", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: patient_dto_1.KiorlyLinkDto, isArray: true }),
    (0, common_1.Get)('kiorly-links'),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-AC-07 Kiorly record links (never auto-merged)' }),
    __param(0, (0, auth_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], PatientController.prototype, "links", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: patient_dto_1.DataExportDto }),
    (0, common_1.Post)('export'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-AC-06 data export' }),
    __param(0, (0, auth_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], PatientController.prototype, "export", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: patient_dto_1.DeletionResultDto }),
    (0, common_1.Post)('deletion'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-AC-06 in-app account deletion with optional export' }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, DeleteBody]),
    __metadata("design:returntype", Promise)
], PatientController.prototype, "deletion", null);
exports.PatientController = PatientController = __decorate([
    (0, swagger_1.ApiTags)('patient'),
    (0, common_1.Controller)('me'),
    __metadata("design:paramtypes", [patient_service_1.PatientService, auth_public_1.AuthSessionService])
], PatientController);
//# sourceMappingURL=patient.controller.js.map