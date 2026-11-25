"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CorporateModule = void 0;
const common_1 = require("@nestjs/common");
const growth_ports_public_1 = require("../growth-ports-public");
const b2b_referral_service_1 = require("./b2b-referral.service");
const corporate_admin_controller_1 = require("./corporate-admin.controller");
const corporate_benefit_service_1 = require("./corporate-benefit.service");
const corporate_config_1 = require("./corporate-config");
const corporate_events_service_1 = require("./corporate-events.service");
const corporate_member_service_1 = require("./corporate-member.service");
const corporate_public_controller_1 = require("./corporate-public.controller");
const corporate_report_service_1 = require("./corporate-report.service");
const corporate_job_1 = require("./corporate.job");
const corporate_service_1 = require("./corporate.service");
let CorporateModule = class CorporateModule {
};
exports.CorporateModule = CorporateModule;
exports.CorporateModule = CorporateModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        controllers: [corporate_admin_controller_1.CorporateAdminController, corporate_public_controller_1.CorporatePublicController],
        providers: [corporate_config_1.CorporateConfigService, corporate_events_service_1.CorporateEventsService, corporate_service_1.CorporateService, corporate_member_service_1.CorporateMemberService, corporate_benefit_service_1.CorporateBenefitService, corporate_report_service_1.CorporateReportService, b2b_referral_service_1.B2bReferralService, corporate_job_1.CorporateJob, { provide: growth_ports_public_1.CORPORATE_BENEFIT_PORT, useExisting: corporate_benefit_service_1.CorporateBenefitService }],
        exports: [corporate_service_1.CorporateService, corporate_member_service_1.CorporateMemberService, corporate_benefit_service_1.CorporateBenefitService, corporate_report_service_1.CorporateReportService, b2b_referral_service_1.B2bReferralService, corporate_job_1.CorporateJob, growth_ports_public_1.CORPORATE_BENEFIT_PORT],
    })
], CorporateModule);
//# sourceMappingURL=corporate.module.js.map