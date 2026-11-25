"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AutomationModule = void 0;
const common_1 = require("@nestjs/common");
const lifecycle_public_1 = require("../lifecycle/lifecycle-public");
const automation_admin_controller_1 = require("./automation-admin.controller");
const automation_hooks_service_1 = require("./automation-hooks.service");
const automation_triggers_service_1 = require("./automation-triggers.service");
const automation_job_1 = require("./automation.job");
const journey_definition_service_1 = require("./journey-definition.service");
let AutomationModule = class AutomationModule {
};
exports.AutomationModule = AutomationModule;
exports.AutomationModule = AutomationModule = __decorate([
    (0, common_1.Module)({
        imports: [lifecycle_public_1.LifecycleModule],
        controllers: [automation_admin_controller_1.AutomationAdminController],
        providers: [journey_definition_service_1.JourneyDefinitionService, automation_hooks_service_1.AutomationHooksService, automation_triggers_service_1.AutomationTriggersService, automation_job_1.AutomationJob],
        exports: [journey_definition_service_1.JourneyDefinitionService, automation_triggers_service_1.AutomationTriggersService, automation_job_1.AutomationJob],
    })
], AutomationModule);
//# sourceMappingURL=automation.module.js.map