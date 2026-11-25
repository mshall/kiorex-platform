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
exports.CorporateAdminController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
const auth_1 = require("../../common/auth");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const growth_access_1 = require("../admin/growth-access");
const growth_flags_1 = require("../growth-flags");
const b2b_referral_service_1 = require("./b2b-referral.service");
const corporate_member_service_1 = require("./corporate-member.service");
const corporate_report_service_1 = require("./corporate-report.service");
const corporate_service_1 = require("./corporate.service");
const OBJ = { schema: { type: 'object', additionalProperties: true } };
const num = (v) => (v === undefined || v === '' ? undefined : Number(v));
class CorporateCreateAccountBody {
    displayName;
    fundingMode;
    legalNameRef;
    billingContactRef;
    leadId;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(120),
    __metadata("design:type", String)
], CorporateCreateAccountBody.prototype, "displayName", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['SPONSOR_CREDIT', 'PLATFORM_PROMO']),
    __metadata("design:type", String)
], CorporateCreateAccountBody.prototype, "fundingMode", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(120),
    __metadata("design:type", String)
], CorporateCreateAccountBody.prototype, "legalNameRef", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(120),
    __metadata("design:type", String)
], CorporateCreateAccountBody.prototype, "billingContactRef", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(40),
    __metadata("design:type", String)
], CorporateCreateAccountBody.prototype, "leadId", void 0);
class CorporateTermsBody {
    contractRef;
    sponsorCeilingMinor;
    perMemberCapMinor;
    perVisitMaxMinor;
    coverBp;
    startsAt;
    endsAt;
    emailDomains;
    fundingMode;
    billingContactRef;
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateIf)((_o, v) => v !== null),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(120),
    __metadata("design:type", Object)
], CorporateTermsBody.prototype, "contractRef", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateIf)((_o, v) => v !== null),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(corporate_service_1.MAX_MINOR),
    __metadata("design:type", Object)
], CorporateTermsBody.prototype, "sponsorCeilingMinor", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateIf)((_o, v) => v !== null),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(corporate_service_1.MAX_MINOR),
    __metadata("design:type", Object)
], CorporateTermsBody.prototype, "perMemberCapMinor", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateIf)((_o, v) => v !== null),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(corporate_service_1.MAX_MINOR),
    __metadata("design:type", Object)
], CorporateTermsBody.prototype, "perVisitMaxMinor", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateIf)((_o, v) => v !== null),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(10000),
    __metadata("design:type", Object)
], CorporateTermsBody.prototype, "coverBp", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateIf)((_o, v) => v !== null),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(40),
    __metadata("design:type", Object)
], CorporateTermsBody.prototype, "startsAt", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateIf)((_o, v) => v !== null),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(40),
    __metadata("design:type", Object)
], CorporateTermsBody.prototype, "endsAt", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMaxSize)(20),
    (0, class_validator_1.IsString)({ each: true }),
    (0, class_validator_1.MaxLength)(100, { each: true }),
    __metadata("design:type", Array)
], CorporateTermsBody.prototype, "emailDomains", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['SPONSOR_CREDIT', 'PLATFORM_PROMO']),
    __metadata("design:type", String)
], CorporateTermsBody.prototype, "fundingMode", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateIf)((_o, v) => v !== null),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(120),
    __metadata("design:type", Object)
], CorporateTermsBody.prototype, "billingContactRef", void 0);
class CorporateCodeBody {
    label;
    kind;
    maxRedemptions;
    perMemberCapMinor;
    expiresAt;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(80),
    __metadata("design:type", String)
], CorporateCodeBody.prototype, "label", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['OPEN', 'LIST']),
    __metadata("design:type", String)
], CorporateCodeBody.prototype, "kind", void 0);
__decorate([
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(100000),
    __metadata("design:type", Number)
], CorporateCodeBody.prototype, "maxRedemptions", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateIf)((_o, v) => v !== null),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(corporate_service_1.MAX_MINOR),
    __metadata("design:type", Object)
], CorporateCodeBody.prototype, "perMemberCapMinor", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateIf)((_o, v) => v !== null),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(40),
    __metadata("design:type", Object)
], CorporateCodeBody.prototype, "expiresAt", void 0);
class CorporateInvoiceNoteBody {
    month;
    notes;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Matches)(/^\d{4}-(0[1-9]|1[0-2])$/),
    __metadata("design:type", String)
], CorporateInvoiceNoteBody.prototype, "month", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(1000),
    __metadata("design:type", String)
], CorporateInvoiceNoteBody.prototype, "notes", void 0);
class CorporateHrBody {
    rows;
}
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMaxSize)(100000),
    (0, class_validator_1.IsString)({ each: true }),
    (0, class_validator_1.MaxLength)(80, { each: true }),
    __metadata("design:type", Array)
], CorporateHrBody.prototype, "rows", void 0);
class CorporateHrDecisionBody {
    decision;
}
__decorate([
    (0, class_validator_1.IsIn)(['APPROVED', 'REJECTED']),
    __metadata("design:type", String)
], CorporateHrDecisionBody.prototype, "decision", void 0);
class CorporateLeadBody {
    companyName;
    source;
    sizeBucket;
    contactRef;
    notes;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(120),
    __metadata("design:type", String)
], CorporateLeadBody.prototype, "companyName", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['OUTBOUND', 'INBOUND']),
    __metadata("design:type", String)
], CorporateLeadBody.prototype, "source", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(20),
    __metadata("design:type", String)
], CorporateLeadBody.prototype, "sizeBucket", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(80),
    __metadata("design:type", String)
], CorporateLeadBody.prototype, "contactRef", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(2000),
    __metadata("design:type", String)
], CorporateLeadBody.prototype, "notes", void 0);
class CorporateLeadTransitionBody {
    status;
    note;
}
__decorate([
    (0, class_validator_1.IsIn)(['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST', 'DUPLICATE']),
    __metadata("design:type", String)
], CorporateLeadTransitionBody.prototype, "status", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], CorporateLeadTransitionBody.prototype, "note", void 0);
class CorporateAssignBody {
    ownerSub;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(80),
    __metadata("design:type", String)
], CorporateAssignBody.prototype, "ownerSub", void 0);
class CorporateNotesBody {
    notes;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(2000),
    __metadata("design:type", String)
], CorporateNotesBody.prototype, "notes", void 0);
let CorporateAdminController = class CorporateAdminController {
    accounts;
    members;
    reports;
    leads;
    constructor(accounts, members, reports, leads) {
        this.accounts = accounts;
        this.members = members;
        this.reports = reports;
        this.leads = leads;
    }
    list(status, take) { return this.accounts.list({ status, take: num(take) }); }
    create(u, b) { return this.accounts.create({ sub: u.sub, roles: u.roles }, b); }
    get(id) { return this.accounts.get(id); }
    terms(u, id, b) { return this.accounts.updateTerms({ sub: u.sub, roles: u.roles }, id, b); }
    activate(u, id) { return this.accounts.activate({ sub: u.sub, roles: u.roles }, id); }
    pause(u, id) { return this.accounts.pause({ sub: u.sub, roles: u.roles }, id); }
    end(u, id) { return this.accounts.end({ sub: u.sub, roles: u.roles }, id); }
    codes(id) { return this.accounts.listCodes(id); }
    createCode(u, id, b) { return this.accounts.createCode({ sub: u.sub, roles: u.roles }, id, b); }
    revoke(u, id, codeId) { return this.accounts.revokeCode({ sub: u.sub, roles: u.roles }, id, codeId); }
    report(id) { return this.reports.report(id); }
    statement(id, month) { return this.reports.monthlyStatement(id, /^\d{4}-(0[1-9]|1[0-2])$/.test(month ?? '') ? month : new Date().toISOString().slice(0, 7)); }
    notes(id) { return this.accounts.invoiceNotes(id); }
    addNote(u, id, b) { return this.accounts.invoiceNote({ sub: u.sub, roles: u.roles }, id, b); }
    hr(id) { return this.members.hrBatches(id); }
    uploadHr(u, id, b) { return this.members.uploadHrList({ sub: u.sub, roles: u.roles }, id, b.rows); }
    decideHr(u, batchId, b) { return this.members.decideHrList({ sub: u.sub, roles: u.roles }, batchId, b.decision); }
    leadList(status, source, take) { return this.leads.list({ status, source, take: num(take) }); }
    leadCreate(u, b) { return this.leads.create({ sub: u.sub, roles: u.roles }, b); }
    leadGet(id) { return this.leads.get(id); }
    leadTransition(u, id, b) { return this.leads.transition({ sub: u.sub, roles: u.roles }, id, b.status, b.note); }
    leadAssign(u, id, b) { return this.leads.assign({ sub: u.sub, roles: u.roles }, id, b.ownerSub); }
    leadNotes(u, id, b) { return this.leads.setNotes({ sub: u.sub, roles: u.roles }, id, b.notes); }
};
exports.CorporateAdminController = CorporateAdminController;
__decorate([
    (0, common_1.Get)('accounts'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P4-C corporate accounts (company data and terms)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('status')),
    __param(1, (0, common_1.Query)('take')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], CorporateAdminController.prototype, "list", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manageCorporate')),
    (0, common_1.Post)('accounts'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P4-C open a corporate account (LEAD)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, CorporateCreateAccountBody]),
    __metadata("design:returntype", void 0)
], CorporateAdminController.prototype, "create", null);
__decorate([
    (0, common_1.Get)('accounts/:id'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P4-C one account' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CorporateAdminController.prototype, "get", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manageCorporate')),
    (0, common_1.Put)('accounts/:id/terms'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P4-C edit the commercial terms (LEAD or PAUSED only); the editor cannot activate' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, CorporateTermsBody]),
    __metadata("design:returntype", void 0)
], CorporateAdminController.prototype, "terms", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manageCorporate')),
    (0, control_plane_public_1.RequiresFlag)(growth_flags_1.CORPORATE_FLAG),
    (0, common_1.Post)('accounts/:id/activate'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P4-C activate (a second person; terms complete)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], CorporateAdminController.prototype, "activate", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manageCorporate')),
    (0, common_1.Post)('accounts/:id/pause'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P4-C pause' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], CorporateAdminController.prototype, "pause", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manageCorporate')),
    (0, common_1.Post)('accounts/:id/end'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P4-C end the programme (final)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], CorporateAdminController.prototype, "end", null);
__decorate([
    (0, common_1.Get)('accounts/:id/codes'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P4-C codes: label, counters, state (never the code or its hash)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CorporateAdminController.prototype, "codes", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manageCorporate')),
    (0, control_plane_public_1.RequiresFlag)(growth_flags_1.CORPORATE_FLAG),
    (0, common_1.Post)('accounts/:id/codes'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P4-C create a code (the plain code is returned once)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, CorporateCodeBody]),
    __metadata("design:returntype", void 0)
], CorporateAdminController.prototype, "createCode", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manageCorporate')),
    (0, common_1.Post)('accounts/:id/codes/:codeId/revoke'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P4-C revoke a code' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Param)('codeId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], CorporateAdminController.prototype, "revoke", null);
__decorate([
    (0, common_1.Get)('accounts/:id/report'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P4-C aggregate report (enrolment, utilisation, sponsored value), every cell masked below k' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CorporateAdminController.prototype, "report", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('readFinance')),
    (0, common_1.Get)('accounts/:id/statement'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P4-C invoice basis of one month (finance)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Query)('month')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], CorporateAdminController.prototype, "statement", null);
__decorate([
    (0, common_1.Get)('accounts/:id/invoice-notes'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P4-C manual invoice notes' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CorporateAdminController.prototype, "notes", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manageCorporate')),
    (0, common_1.Post)('accounts/:id/invoice-notes'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P4-C record the sponsor spend of a month for manual invoicing' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, CorporateInvoiceNoteBody]),
    __metadata("design:returntype", void 0)
], CorporateAdminController.prototype, "addNote", null);
__decorate([
    (0, common_1.Get)('accounts/:id/hr-lists'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P4-C HR lists as counts only' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CorporateAdminController.prototype, "hr", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manageCorporate')),
    (0, control_plane_public_1.RequiresFlag)(growth_flags_1.CORPORATE_FLAG),
    (0, common_1.Post)('accounts/:id/hr-lists'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P4-C upload an HR list (phone or e-mail per row; only keyed hashes are stored; a second person approves)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, CorporateHrBody]),
    __metadata("design:returntype", void 0)
], CorporateAdminController.prototype, "uploadHr", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manageCorporate')),
    (0, control_plane_public_1.RequiresFlag)(growth_flags_1.CORPORATE_FLAG),
    (0, common_1.Post)('hr-lists/:batchId/decision'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P4-C approve or reject an HR list (not the uploader)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('batchId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, CorporateHrDecisionBody]),
    __metadata("design:returntype", void 0)
], CorporateAdminController.prototype, "decideHr", null);
__decorate([
    (0, common_1.Get)('leads'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P4-C enterprise leads and the pipeline counts' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('status')),
    __param(1, (0, common_1.Query)('source')),
    __param(2, (0, common_1.Query)('take')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", void 0)
], CorporateAdminController.prototype, "leadList", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manageCorporate')),
    (0, common_1.Post)('leads'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P4-C add an inbound or outbound lead (company data only)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, CorporateLeadBody]),
    __metadata("design:returntype", void 0)
], CorporateAdminController.prototype, "leadCreate", null);
__decorate([
    (0, common_1.Get)('leads/:id'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P4-C one lead with its history' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CorporateAdminController.prototype, "leadGet", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manageCorporate')),
    (0, common_1.Post)('leads/:id/transition'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P4-C move a lead through the pipeline' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, CorporateLeadTransitionBody]),
    __metadata("design:returntype", void 0)
], CorporateAdminController.prototype, "leadTransition", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manageCorporate')),
    (0, common_1.Post)('leads/:id/assign'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P4-C assign an owner' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, CorporateAssignBody]),
    __metadata("design:returntype", void 0)
], CorporateAdminController.prototype, "leadAssign", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manageCorporate')),
    (0, common_1.Put)('leads/:id/notes'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P4-C replace the company notes' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, CorporateNotesBody]),
    __metadata("design:returntype", void 0)
], CorporateAdminController.prototype, "leadNotes", null);
exports.CorporateAdminController = CorporateAdminController = __decorate([
    (0, swagger_1.ApiTags)('growth-corporate'),
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('read')),
    (0, common_1.Controller)('admin/growth/corporate'),
    __metadata("design:paramtypes", [corporate_service_1.CorporateService, corporate_member_service_1.CorporateMemberService, corporate_report_service_1.CorporateReportService, b2b_referral_service_1.B2bReferralService])
], CorporateAdminController);
//# sourceMappingURL=corporate-admin.controller.js.map