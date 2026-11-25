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
exports.CampaignsAdminController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const auth_1 = require("../../common/auth");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const growth_access_1 = require("../admin/growth-access");
const spend_service_1 = require("../analytics/spend.service");
const growth_flags_1 = require("../growth-flags");
const campaign_dto_1 = require("./campaign-dto");
const campaign_approval_service_1 = require("./campaign-approval.service");
const campaign_report_service_1 = require("./campaign-report.service");
const campaign_scheduler_service_1 = require("./campaign-scheduler.service");
const campaign_service_1 = require("./campaign.service");
const campaign_budget_service_1 = require("./campaign-budget.service");
const OBJ = { schema: { type: 'object', additionalProperties: true } };
const ARR = { schema: { type: 'array', items: { type: 'object', additionalProperties: true } } };
const user = (u) => ({ sub: u.sub, kind: 'USER' });
let CampaignsAdminController = class CampaignsAdminController {
    svc;
    approvals;
    report;
    scheduler;
    spend;
    budget;
    constructor(svc, approvals, report, scheduler, spend, budget) {
        this.svc = svc;
        this.approvals = approvals;
        this.report = report;
        this.scheduler = scheduler;
        this.spend = spend;
        this.budget = budget;
    }
    list(market, status, q, objective, promotional, take) {
        return this.svc.list({ market: market && /^[A-Z]{2}$/.test(market) ? market : undefined, status, q: q?.slice(0, 60), objective, promotional: promotional === '1' || promotional === 'true', take: take ? Number(take) : undefined });
    }
    create(u, b) { return this.svc.create(user(u), b); }
    listApprovals(status, campaignId, take) { return this.approvals.list({ status: status === 'pending' || status === 'decided' ? status : undefined, campaignId, take: take ? Number(take) : undefined }); }
    getApproval(id) { return this.approvals.get(id); }
    decide(u, id, b) { return this.approvals.decide(user(u), id, b); }
    runScheduler() { return this.scheduler.runOnce(); }
    get(id) { return this.svc.get(id); }
    update(u, id, b) { return this.svc.update(user(u), id, b); }
    transition(u, id, b) {
        return this.svc.transition(user(u), id, b.to, { reasonCode: b.reasonCode, reason: b.reason, pauseReason: b.to === 'PAUSED' ? 'MANUAL' : undefined });
    }
    requestApproval(u, id, b) { return this.approvals.request(user(u), id, b); }
    getReport(u, id, from, to) { return this.report.report(id, { from, to }, new Date(), (0, growth_access_1.can)(u.roles, 'readFinance')); }
    history(id) { return this.svc.history(id); }
    creatives(id) { return this.svc.creatives(id); }
    addCreative(u, id, b) { return this.svc.addCreative(user(u), id, b); }
    async spendOf(id) { await this.svc.must(id); return { entries: await this.spend.list({ campaignId: id }), daily: await this.budget.daily(id) }; }
    addSpend(u, id, b) { return this.spend.create(u.sub, { day: b.day, amountMinor: b.amountMinor, note: b.note, campaignId: id }); }
};
exports.CampaignsAdminController = CampaignsAdminController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-A list campaigns (filters: status, q, objective, promotional=1)' }),
    (0, swagger_1.ApiOkResponse)(ARR),
    __param(0, (0, common_1.Query)('market')),
    __param(1, (0, common_1.Query)('status')),
    __param(2, (0, common_1.Query)('q')),
    __param(3, (0, common_1.Query)('objective')),
    __param(4, (0, common_1.Query)('promotional')),
    __param(5, (0, common_1.Query)('take')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, String, String]),
    __metadata("design:returntype", void 0)
], CampaignsAdminController.prototype, "list", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manageCampaigns')),
    (0, control_plane_public_1.RequiresFlag)(growth_flags_1.GROWTH_FLAG.CAMPAIGNS),
    (0, common_1.Post)(),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-A create a campaign plan (DRAFT)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, campaign_dto_1.CreateCampaignDto]),
    __metadata("design:returntype", void 0)
], CampaignsAdminController.prototype, "create", null);
__decorate([
    (0, common_1.Get)('approvals'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-A approval requests (status=pending|decided)' }),
    (0, swagger_1.ApiOkResponse)(ARR),
    __param(0, (0, common_1.Query)('status')),
    __param(1, (0, common_1.Query)('campaignId')),
    __param(2, (0, common_1.Query)('take')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", void 0)
], CampaignsAdminController.prototype, "listApprovals", null);
__decorate([
    (0, common_1.Get)('approvals/:id'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-A one approval with the campaign it covers' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CampaignsAdminController.prototype, "getApproval", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manageCampaigns')),
    (0, control_plane_public_1.RequiresFlag)(growth_flags_1.GROWTH_FLAG.CAMPAIGNS),
    (0, common_1.Post)('approvals/:id/decide'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-A approve or reject (never the requester)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, campaign_dto_1.DecideApprovalDto]),
    __metadata("design:returntype", void 0)
], CampaignsAdminController.prototype, "decide", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manageCampaigns')),
    (0, control_plane_public_1.RequiresFlag)(growth_flags_1.GROWTH_FLAG.CAMPAIGNS),
    (0, common_1.Post)('scheduler/run'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-A run the 1-minute scheduler once (idempotent; also what the job does)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], CampaignsAdminController.prototype, "runScheduler", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-A one campaign with tracking links, approval state, budget and the transitions possible now' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CampaignsAdminController.prototype, "get", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manageCampaigns')),
    (0, control_plane_public_1.RequiresFlag)(growth_flags_1.GROWTH_FLAG.CAMPAIGNS),
    (0, common_1.Patch)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-A edit (optimistic version; money-relevant edits invalidate an approval)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, campaign_dto_1.UpdateCampaignDto]),
    __metadata("design:returntype", void 0)
], CampaignsAdminController.prototype, "update", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manageCampaigns')),
    (0, control_plane_public_1.RequiresFlag)(growth_flags_1.GROWTH_FLAG.CAMPAIGNS),
    (0, common_1.Post)(':id/transition'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-A move to another state (409 CAMPAIGN_INVALID_TRANSITION when not allowed)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, campaign_dto_1.TransitionDto]),
    __metadata("design:returntype", void 0)
], CampaignsAdminController.prototype, "transition", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manageCampaigns')),
    (0, control_plane_public_1.RequiresFlag)(growth_flags_1.GROWTH_FLAG.CAMPAIGNS),
    (0, common_1.Post)(':id/approvals'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-A ask a second person to approve activation, a budget increase or reactivation' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, campaign_dto_1.RequestApprovalDto]),
    __metadata("design:returntype", void 0)
], CampaignsAdminController.prototype, "requestApproval", null);
__decorate([
    (0, common_1.Get)(':id/report'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-A performance: funnel, spend, utilisation, CPA, CAC, ROAS by day and source (k >= 10); external numbers only from read-only adapters' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Query)('from')),
    __param(3, (0, common_1.Query)('to')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], CampaignsAdminController.prototype, "getReport", null);
__decorate([
    (0, common_1.Get)(':id/history'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-A every state change with actor and reason' }),
    (0, swagger_1.ApiOkResponse)(ARR),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CampaignsAdminController.prototype, "history", null);
__decorate([
    (0, common_1.Get)(':id/creatives'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-A creative asset references' }),
    (0, swagger_1.ApiOkResponse)(ARR),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CampaignsAdminController.prototype, "creatives", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manageCampaigns')),
    (0, control_plane_public_1.RequiresFlag)(growth_flags_1.GROWTH_FLAG.CAMPAIGNS),
    (0, common_1.Post)(':id/creatives'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-A add a creative REFERENCE (object-store key under the campaign prefix or an allowlisted https URL)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, campaign_dto_1.AddCreativeDto]),
    __metadata("design:returntype", void 0)
], CampaignsAdminController.prototype, "addCreative", null);
__decorate([
    (0, common_1.Get)(':id/spend'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-A spend lines booked against the campaign, with the daily utilisation' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], CampaignsAdminController.prototype, "spendOf", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manageCampaigns')),
    (0, control_plane_public_1.RequiresFlag)(growth_flags_1.GROWTH_FLAG.CAMPAIGNS),
    (0, common_1.Post)(':id/spend'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-A enter a spend line for the campaign (PENDING until a different person approves it on the Finance page)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, campaign_dto_1.CampaignSpendDto]),
    __metadata("design:returntype", void 0)
], CampaignsAdminController.prototype, "addSpend", null);
exports.CampaignsAdminController = CampaignsAdminController = __decorate([
    (0, swagger_1.ApiTags)('growth-campaigns'),
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('read')),
    (0, common_1.Controller)('admin/growth/campaigns'),
    __metadata("design:paramtypes", [campaign_service_1.CampaignService, campaign_approval_service_1.CampaignApprovalService, campaign_report_service_1.CampaignReportService, campaign_scheduler_service_1.CampaignSchedulerService, spend_service_1.GrowthSpendService, campaign_budget_service_1.CampaignBudgetService])
], CampaignsAdminController);
//# sourceMappingURL=campaigns-admin.controller.js.map