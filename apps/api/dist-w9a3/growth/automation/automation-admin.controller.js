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
exports.AutomationAdminController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const auth_1 = require("../../common/auth");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const growth_access_1 = require("../admin/growth-access");
const automation_flags_1 = require("./automation-flags");
const automation_job_1 = require("./automation.job");
const journey_definition_service_1 = require("./journey-definition.service");
const market_core_public_1 = require("../../market/market-core-public");
const OBJ = { schema: { type: 'object', additionalProperties: true } };
const ARR = { schema: { type: 'array', items: { type: 'object', additionalProperties: true } } };
const actor = (u) => ({ sub: u.sub, kind: 'USER' });
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
let AutomationAdminController = class AutomationAdminController {
    svc;
    job;
    constructor(svc, job) {
        this.svc = svc;
        this.job = job;
    }
    catalog() { return this.svc.catalog(); }
    status(market) { return this.svc.status(market && /^[A-Z]{2}$/.test(market) ? market : undefined); }
    validate(b) { return this.svc.preview(b?.graph, { market: b?.market && /^[A-Z]{2}$/.test(b.market) ? b.market : undefined }); }
    dryRun(b) { return this.svc.dryRunGraph(b?.graph, b?.market && /^[A-Z]{2}$/.test(b.market) ? b.market : market_core_public_1.DEFAULT_MARKET, { size: b?.size === undefined ? undefined : num(b.size, 1000), seed: b?.seed === undefined ? undefined : num(b.seed, 1) }); }
    list(market, status, take) { return this.svc.list({ market: market && /^[A-Z]{2}$/.test(market) ? market : undefined, status, take: take ? num(take, 100) : undefined }); }
    get(id) { return this.svc.get(id); }
    dryRunSaved(id, b) { return this.svc.dryRunSaved(id, { size: b?.size === undefined ? undefined : num(b.size, 1000), seed: b?.seed === undefined ? undefined : num(b.seed, 1) }); }
    create(u, b) { return this.svc.create(actor(u), b ?? {}); }
    update(u, id, b) { return this.svc.update(actor(u), id, b ?? {}); }
    submit(u, id) { return this.svc.submit(actor(u), id); }
    approve(u, id) { return this.svc.approve(actor(u), id); }
    reject(u, id, b) { return this.svc.reject(actor(u), id, b?.reason ?? ''); }
    retire(u, id) { return this.svc.retire(actor(u), id); }
    kill(u, id, b) { return this.svc.kill(actor(u), id, b?.reason ?? ''); }
    scan() { return this.job.runOnce(); }
};
exports.AutomationAdminController = AutomationAdminController;
__decorate([
    (0, common_1.Get)('catalog'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-E the closed vocabulary of the builder: node types, trigger events, templates with their class, channels, attributes and the policy numbers' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AutomationAdminController.prototype, "catalog", null);
__decorate([
    (0, common_1.Get)('status'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-E banner facts: automation switch and the marketing licence flag status' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('market')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AutomationAdminController.prototype, "status", null);
__decorate([
    (0, common_1.Post)('validate'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-E validate and compile an unsaved graph (the builder calls it on every change); writes nothing' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AutomationAdminController.prototype, "validate", null);
__decorate([
    (0, common_1.Post)('dry-run'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-E dry run of an unsaved graph on a synthetic cohort: volumes and gate decisions, nobody is read or sent anything' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AutomationAdminController.prototype, "dryRun", null);
__decorate([
    (0, common_1.Get)('journeys'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-E list journey definitions' }),
    (0, swagger_1.ApiOkResponse)(ARR),
    __param(0, (0, common_1.Query)('market')),
    __param(1, (0, common_1.Query)('status')),
    __param(2, (0, common_1.Query)('take')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", void 0)
], AutomationAdminController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('journeys/:id'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-E one definition with its compiled steps, counts per day and active enrolments (counts only)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AutomationAdminController.prototype, "get", null);
__decorate([
    (0, common_1.Post)('journeys/:id/dry-run'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-E dry run of a saved journey' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], AutomationAdminController.prototype, "dryRunSaved", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manageCampaigns')),
    (0, control_plane_public_1.RequiresFlag)(automation_flags_1.AUTOMATION_FLAG),
    (0, common_1.Post)('journeys'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-E create a draft; 422 JOURNEY_INVALID lists every error with a code and a path' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AutomationAdminController.prototype, "create", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manageCampaigns')),
    (0, control_plane_public_1.RequiresFlag)(automation_flags_1.AUTOMATION_FLAG),
    (0, common_1.Patch)('journeys/:id'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-E edit a draft (a published journey is immutable)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], AutomationAdminController.prototype, "update", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manageCampaigns')),
    (0, control_plane_public_1.RequiresFlag)(automation_flags_1.AUTOMATION_FLAG),
    (0, common_1.Post)('journeys/:id/submit'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-E submit a draft for approval' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AutomationAdminController.prototype, "submit", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manageCampaigns')),
    (0, control_plane_public_1.RequiresFlag)(automation_flags_1.AUTOMATION_FLAG),
    (0, common_1.Post)('journeys/:id/approve'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-E a DIFFERENT super admin approves and publishes (two-person rule); the previous version of the key is retired' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AutomationAdminController.prototype, "approve", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manageCampaigns')),
    (0, control_plane_public_1.RequiresFlag)(automation_flags_1.AUTOMATION_FLAG),
    (0, common_1.Post)('journeys/:id/reject'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-E a different super admin sends a pending journey back to draft' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], AutomationAdminController.prototype, "reject", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manageCampaigns')),
    (0, common_1.Post)('journeys/:id/retire'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-E retire a published journey (running enrolments end with RETIRED; never flag-gated)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AutomationAdminController.prototype, "retire", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manageCampaigns')),
    (0, common_1.Post)('journeys/:id/kill'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-E per-journey kill switch: the next evaluation of every enrolment ends it with KILLED (never flag-gated, one person suffices)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], AutomationAdminController.prototype, "kill", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manageCampaigns')),
    (0, common_1.Post)('scan'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-E run the trigger scan once (idempotent; also what the job does)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AutomationAdminController.prototype, "scan", null);
exports.AutomationAdminController = AutomationAdminController = __decorate([
    (0, swagger_1.ApiTags)('growth-automation'),
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('read')),
    (0, common_1.Controller)('admin/growth/automation'),
    __metadata("design:paramtypes", [journey_definition_service_1.JourneyDefinitionService, automation_job_1.AutomationJob])
], AutomationAdminController);
//# sourceMappingURL=automation-admin.controller.js.map