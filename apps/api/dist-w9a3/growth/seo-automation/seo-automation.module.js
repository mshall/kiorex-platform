"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SeoAutomationModule = void 0;
const common_1 = require("@nestjs/common");
const indexation_service_1 = require("./indexation.service");
const seo_automation_controller_1 = require("./seo-automation.controller");
const seo_trigger_service_1 = require("./seo-trigger.service");
const seo_automation_job_1 = require("./seo-automation.job");
const seo_automation_public_1 = require("./seo-automation-public");
const seo_automation_service_1 = require("./seo-automation.service");
const vitals_service_1 = require("./vitals.service");
let SeoAutomationModule = class SeoAutomationModule {
};
exports.SeoAutomationModule = SeoAutomationModule;
exports.SeoAutomationModule = SeoAutomationModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        controllers: [seo_automation_controller_1.SeoAutomationController],
        providers: [seo_automation_service_1.SeoAutomationService, { provide: seo_automation_public_1.SEO_QUALITY, useExisting: seo_automation_service_1.SeoAutomationService }, vitals_service_1.SeoVitalsService, indexation_service_1.SeoIndexationService, seo_automation_job_1.SeoAutomationJob, seo_trigger_service_1.SeoGateTriggerService, { provide: seo_automation_public_1.SEO_TRIGGER, useExisting: seo_trigger_service_1.SeoGateTriggerService }],
        exports: [seo_automation_public_1.SEO_QUALITY, seo_automation_public_1.SEO_TRIGGER, seo_trigger_service_1.SeoGateTriggerService, seo_automation_service_1.SeoAutomationService, vitals_service_1.SeoVitalsService, indexation_service_1.SeoIndexationService, seo_automation_job_1.SeoAutomationJob],
    })
], SeoAutomationModule);
//# sourceMappingURL=seo-automation.module.js.map