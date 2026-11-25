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
exports.ExperimentsAdminController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const auth_1 = require("../../common/auth");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const growth_access_1 = require("../admin/growth-access");
const growth_flags_1 = require("../growth-flags");
const experiment_evaluator_job_1 = require("./experiment-evaluator.job");
const experiment_service_1 = require("./experiment.service");
const experiment_types_1 = require("./experiment.types");
const surfaces_1 = require("./surfaces");
const OBJ = { schema: { type: 'object', additionalProperties: true } };
const ARR = { schema: { type: 'array', items: { type: 'object', additionalProperties: true } } };
const actor = (u) => ({ sub: u.sub, kind: 'USER' });
let ExperimentsAdminController = class ExperimentsAdminController {
    svc;
    job;
    constructor(svc, job) {
        this.svc = svc;
        this.job = job;
    }
    list(market, status, surface, take) { return this.svc.list({ market: market && /^[A-Z]{2}$/.test(market) ? market : undefined, status, surface, take: take ? Number(take) : undefined }); }
    catalog() { return { surfaces: surfaces_1.SURFACES, metrics: experiment_types_1.METRICS, policy: experiment_types_1.EXPERIMENT_POLICY }; }
    create(u, b) { return this.svc.create(actor(u), b); }
    get(id) { return this.svc.get(id); }
    history(id) { return this.svc.history(id); }
    results(id) { return this.svc.results(id); }
    update(u, id, b) { return this.svc.update(actor(u), id, b); }
    submit(u, id) { return this.svc.submit(actor(u), id); }
    approve(u, id) { return this.svc.approveAndStart(actor(u), id); }
    stop(u, id, b) { return this.svc.stop(actor(u), id, b?.reason ?? ''); }
    archive(u, id) { return this.svc.archive(actor(u), id); }
    ship(u, id) { return this.svc.shipWinner(actor(u), id); }
    run() { return this.job.runOnce(); }
};
exports.ExperimentsAdminController = ExperimentsAdminController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-A list experiments (status, surface, market filters)' }),
    (0, swagger_1.ApiOkResponse)(ARR),
    __param(0, (0, common_1.Query)('market')),
    __param(1, (0, common_1.Query)('status')),
    __param(2, (0, common_1.Query)('surface')),
    __param(3, (0, common_1.Query)('take')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String]),
    __metadata("design:returntype", void 0)
], ExperimentsAdminController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('catalog'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-A the closed allowlist of surfaces, the metric registry and the policy defaults' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ExperimentsAdminController.prototype, "catalog", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manageExperiments')),
    (0, control_plane_public_1.RequiresFlag)(growth_flags_1.GROWTH_FLAG.EXPERIMENTS),
    (0, common_1.Post)(),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-A create an experiment (DRAFT); 422 EXPERIMENT_SURFACE_FORBIDDEN outside the allowlist' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ExperimentsAdminController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-A one experiment with its history and the latest result (redacted while SRM or a blocker stands)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ExperimentsAdminController.prototype, "get", null);
__decorate([
    (0, common_1.Get)(':id/history'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-A append-only history: config diffs, state changes, stop reasons' }),
    (0, swagger_1.ApiOkResponse)(ARR),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ExperimentsAdminController.prototype, "history", null);
__decorate([
    (0, common_1.Get)(':id/results'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-A result snapshots, newest first' }),
    (0, swagger_1.ApiOkResponse)(ARR),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ExperimentsAdminController.prototype, "results", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manageExperiments')),
    (0, control_plane_public_1.RequiresFlag)(growth_flags_1.GROWTH_FLAG.EXPERIMENTS),
    (0, common_1.Patch)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-A edit a DRAFT (the design is frozen once submitted)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], ExperimentsAdminController.prototype, "update", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manageExperiments')),
    (0, control_plane_public_1.RequiresFlag)(growth_flags_1.GROWTH_FLAG.EXPERIMENTS),
    (0, common_1.Post)(':id/submit'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-A submit for approval' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ExperimentsAdminController.prototype, "submit", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manageExperiments')),
    (0, control_plane_public_1.RequiresFlag)(growth_flags_1.GROWTH_FLAG.EXPERIMENTS),
    (0, common_1.Post)(':id/approve'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-A a DIFFERENT super admin approves and starts the experiment' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ExperimentsAdminController.prototype, "approve", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manageExperiments')),
    (0, common_1.Post)(':id/stop'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-A stop with a reason; every unit returns to control at once (never flag-gated)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], ExperimentsAdminController.prototype, "stop", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manageExperiments')),
    (0, common_1.Post)(':id/archive'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-A archive a stopped or concluded experiment' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ExperimentsAdminController.prototype, "archive", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manageExperiments')),
    (0, control_plane_public_1.RequiresFlag)(growth_flags_1.GROWTH_FLAG.EXPERIMENTS),
    (0, common_1.Post)(':id/ship-winner'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-A record a ship-winner PROPOSAL (never applied automatically; a human uses the existing maker-checker)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ExperimentsAdminController.prototype, "ship", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manageExperiments')),
    (0, common_1.Post)('evaluator/run'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-A run the hourly evaluator once (idempotent; also what the job does)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ExperimentsAdminController.prototype, "run", null);
exports.ExperimentsAdminController = ExperimentsAdminController = __decorate([
    (0, swagger_1.ApiTags)('growth-experiments'),
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('read')),
    (0, common_1.Controller)('admin/growth/experiments'),
    __metadata("design:paramtypes", [experiment_service_1.ExperimentService, experiment_evaluator_job_1.ExperimentEvaluatorJob])
], ExperimentsAdminController);
//# sourceMappingURL=experiments-admin.controller.js.map