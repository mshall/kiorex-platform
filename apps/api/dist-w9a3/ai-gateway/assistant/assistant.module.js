"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssistantModule = void 0;
const common_1 = require("@nestjs/common");
const assistant_admin_controller_1 = require("./assistant-admin.controller");
const assistant_link_controller_1 = require("./assistant-link.controller");
const assistant_audit_1 = require("./assistant.audit");
const assistant_config_1 = require("./assistant.config");
const assistant_confirm_1 = require("./assistant.confirm");
const assistant_cost_service_1 = require("./assistant.cost.service");
const assistant_escalation_service_1 = require("./assistant.escalation.service");
const assistant_link_service_1 = require("./assistant.link.service");
const assistant_model_factory_1 = require("./assistant.model.factory");
const assistant_orchestrator_1 = require("./assistant.orchestrator");
const assistant_rate_limit_1 = require("./assistant.rate-limit");
const assistant_retention_job_1 = require("./assistant.retention.job");
const assistant_router_1 = require("./assistant.router");
const assistant_session_service_1 = require("./assistant.session.service");
const assistant_tools_1 = require("./assistant.tools");
let AssistantModule = class AssistantModule {
};
exports.AssistantModule = AssistantModule;
exports.AssistantModule = AssistantModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        controllers: [assistant_admin_controller_1.AssistantAdminController, assistant_link_controller_1.AssistantLinkController],
        providers: [assistant_audit_1.AssistantAudit, assistant_config_1.AssistantPolicyService, assistant_confirm_1.ConfirmationStore, assistant_cost_service_1.AssistantCostService, assistant_escalation_service_1.AssistantEscalationService, assistant_link_service_1.AssistantLinkService, assistant_model_factory_1.AssistantModelFactory, assistant_orchestrator_1.AssistantOrchestrator, assistant_rate_limit_1.AssistantRateLimit, assistant_retention_job_1.AssistantRetentionJob, assistant_router_1.AssistantRouter, assistant_session_service_1.AssistantSessionService, assistant_tools_1.AssistantTools],
        exports: [assistant_router_1.AssistantRouter, assistant_model_factory_1.AssistantModelFactory, assistant_orchestrator_1.AssistantOrchestrator, assistant_retention_job_1.AssistantRetentionJob, assistant_escalation_service_1.AssistantEscalationService, assistant_cost_service_1.AssistantCostService, assistant_config_1.AssistantPolicyService, assistant_link_service_1.AssistantLinkService],
    })
], AssistantModule);
//# sourceMappingURL=assistant.module.js.map