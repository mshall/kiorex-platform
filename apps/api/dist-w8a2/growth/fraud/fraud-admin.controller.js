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
exports.FraudAdminController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const auth_1 = require("../../common/auth");
const growth_access_1 = require("../admin/growth-access");
const case_service_1 = require("./case.service");
const calibration_job_1 = require("./calibration.job");
const fraud_config_service_1 = require("./fraud-config.service");
const review_queue_service_1 = require("./review-queue.service");
const signals_1 = require("./signals");
const OBJ = { schema: { type: 'object', additionalProperties: true } };
class FraudAssignBody {
    assignTo;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(80),
    __metadata("design:type", String)
], FraudAssignBody.prototype, "assignTo", void 0);
class FraudDecisionBody {
    decision;
    note;
    reverseRewards;
    suspendDays;
}
__decorate([
    (0, class_validator_1.IsIn)(['CONFIRM', 'DISMISS']),
    __metadata("design:type", String)
], FraudDecisionBody.prototype, "decision", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(300),
    __metadata("design:type", String)
], FraudDecisionBody.prototype, "note", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], FraudDecisionBody.prototype, "reverseRewards", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(730),
    __metadata("design:type", Number)
], FraudDecisionBody.prototype, "suspendDays", void 0);
class FraudAppealBody {
    note;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(300),
    __metadata("design:type", String)
], FraudAppealBody.prototype, "note", void 0);
class FraudAppealDecisionBody {
    decision;
    note;
}
__decorate([
    (0, class_validator_1.IsIn)(['CONFIRM', 'DISMISS']),
    __metadata("design:type", String)
], FraudAppealDecisionBody.prototype, "decision", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(300),
    __metadata("design:type", String)
], FraudAppealDecisionBody.prototype, "note", void 0);
class FraudBulkBody {
    ids;
    reason;
}
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMinSize)(1),
    (0, class_validator_1.ArrayMaxSize)(100),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], FraudBulkBody.prototype, "ids", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(300),
    __metadata("design:type", String)
], FraudBulkBody.prototype, "reason", void 0);
class FraudIdentityBody {
    reason;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], FraudIdentityBody.prototype, "reason", void 0);
let FraudAdminController = class FraudAdminController {
    queue;
    cases;
    cal;
    cfg;
    job;
    constructor(queue, cases, cal, cfg, job) {
        this.queue = queue;
        this.cases = cases;
        this.cal = cal;
        this.cfg = cfg;
        this.job = job;
    }
    list(status, kind, band, breached, take) {
        return this.queue.list({ status, kind, band, breached: breached === 'true', take: Number(take) || 50 }).then((rows) => ({ rows }));
    }
    summary() { return this.queue.summary(); }
    one(id) { return this.cases.evidence(id); }
    async bulk(u, b) { return this.queue.bulkDismiss(b.ids, u.sub, b.reason, await this.cfg.get()); }
    assign(u, id, b) { return this.cases.assign(id, u.sub, b.assignTo); }
    async decide(u, id, b) { return this.cases.decide(id, u.sub, b, await this.cfg.get()); }
    async appeal(u, id, b) { return this.cases.appeal(id, u.sub, b.note, await this.cfg.get()); }
    appealDecision(u, id, b) { return this.cases.redecide(id, u.sub, b); }
    identity(u, id, b) { return this.cases.identity(id, u.sub, b.reason); }
    async rules() { const c = await this.cfg.get(); return { ruleIds: signals_1.FRAUD_RULE_IDS, config: c, editable: false, source: c.version === null ? 'PROPOSED_DEFAULT' : 'ACTIVE' }; }
    shadow(days) { return this.cal.report(Math.min(Math.max(Number(days) || 90, 1), 365)); }
    fairness(weekStart) {
        const d = weekStart && !Number.isNaN(Date.parse(weekStart)) ? new Date(weekStart) : new Date(Date.now() - 7 * 86_400_000);
        return this.cal.fairness(d);
    }
    run() { return this.job.run(); }
    propose() { return this.cal.propose(); }
};
exports.FraudAdminController = FraudAdminController;
__decorate([
    (0, common_1.Get)('cases'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-D review queue' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('status')),
    __param(1, (0, common_1.Query)('kind')),
    __param(2, (0, common_1.Query)('band')),
    __param(3, (0, common_1.Query)('breached')),
    __param(4, (0, common_1.Query)('take')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, String]),
    __metadata("design:returntype", void 0)
], FraudAdminController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('cases/summary'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-D open cases by kind, band and mode, and SLA breaches' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], FraudAdminController.prototype, "summary", null);
__decorate([
    (0, common_1.Get)('cases/:id'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-D evidence viewer: signals, check rows, decision log (hashed references only)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], FraudAdminController.prototype, "one", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('reviewFraud')),
    (0, common_1.Post)('cases/bulk-dismiss'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-D bulk dismiss LOW and MEDIUM cases with a reason' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, FraudBulkBody]),
    __metadata("design:returntype", Promise)
], FraudAdminController.prototype, "bulk", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('reviewFraud')),
    (0, common_1.Post)('cases/:id/assign'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-D assign a case' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, FraudAssignBody]),
    __metadata("design:returntype", void 0)
], FraudAdminController.prototype, "assign", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('reviewFraud')),
    (0, common_1.Post)('cases/:id/decision'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-D CONFIRM (reversing reward value needs a second person) or DISMISS' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, FraudDecisionBody]),
    __metadata("design:returntype", Promise)
], FraudAdminController.prototype, "decide", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('reviewFraud')),
    (0, common_1.Post)('cases/:id/appeal'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-D file an appeal for a confirmed case (support, inside the appeal window)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, FraudAppealBody]),
    __metadata("design:returntype", Promise)
], FraudAdminController.prototype, "appeal", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('reviewFraud')),
    (0, common_1.Post)('cases/:id/appeal-decision'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-D decide an appeal (a different reviewer)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, FraudAppealDecisionBody]),
    __metadata("design:returntype", void 0)
], FraudAdminController.prototype, "appealDecision", null);
__decorate([
    (0, auth_1.Roles)('dpo'),
    (0, common_1.Post)('cases/:id/identity'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-D account references of a case (DPO role, audited)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, FraudIdentityBody]),
    __metadata("design:returntype", void 0)
], FraudAdminController.prototype, "identity", null);
__decorate([
    (0, common_1.Get)('rules'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-D rules, weights, enforce switches and thresholds (read-only; change through the FRAUD_RULES configuration)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], FraudAdminController.prototype, "rules", null);
__decorate([
    (0, common_1.Get)('shadow-report'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-D precision and volume by rule' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('days')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], FraudAdminController.prototype, "shadow", null);
__decorate([
    (0, common_1.Get)('fairness'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-D weekly HOLD rate by language and city (aggregate, k >= 10)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('weekStart')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], FraudAdminController.prototype, "fairness", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manage')),
    (0, common_1.Post)('jobs/run'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-D run the hourly job now (SLA sweep, housekeeping, calibration counts)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], FraudAdminController.prototype, "run", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manage')),
    (0, common_1.Post)('calibration/propose'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-D propose weight changes as a draft (never applied)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], FraudAdminController.prototype, "propose", null);
exports.FraudAdminController = FraudAdminController = __decorate([
    (0, swagger_1.ApiTags)('growth-fraud'),
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('read')),
    (0, common_1.Controller)('admin/growth/fraud'),
    __metadata("design:paramtypes", [review_queue_service_1.FraudReviewQueueService, case_service_1.FraudCaseService, calibration_job_1.FraudCalibrationService, fraud_config_service_1.FraudConfigService, calibration_job_1.FraudJob])
], FraudAdminController);
//# sourceMappingURL=fraud-admin.controller.js.map