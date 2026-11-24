"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LifecycleModule = void 0;
const common_1 = require("@nestjs/common");
const journey_runner_service_1 = require("./journey-runner.service");
const lifecycle_admin_controller_1 = require("./lifecycle-admin.controller");
const lifecycle_policy_service_1 = require("./lifecycle-policy.service");
const lifecycle_preferences_controller_1 = require("./lifecycle-preferences.controller");
const lifecycle_state_service_1 = require("./lifecycle-state.service");
const lifecycle_triggers_service_1 = require("./lifecycle-triggers.service");
const lifecycle_job_1 = require("./lifecycle.job");
const lifecycle_service_1 = require("./lifecycle.service");
const send_gate_service_1 = require("./send-gate.service");
let LifecycleModule = class LifecycleModule {
};
exports.LifecycleModule = LifecycleModule;
exports.LifecycleModule = LifecycleModule = __decorate([
    (0, common_1.Module)({
        controllers: [lifecycle_admin_controller_1.LifecycleAdminController, lifecycle_preferences_controller_1.LifecyclePreferencesController],
        providers: [lifecycle_policy_service_1.LifecyclePolicyService, lifecycle_state_service_1.LifecycleStateService, send_gate_service_1.SendGateService, journey_runner_service_1.JourneyRunnerService, lifecycle_triggers_service_1.LifecycleTriggersService, lifecycle_job_1.LifecycleJob, lifecycle_service_1.LifecycleService],
        exports: [lifecycle_service_1.LifecycleService, lifecycle_state_service_1.LifecycleStateService, lifecycle_policy_service_1.LifecyclePolicyService],
    })
], LifecycleModule);
//# sourceMappingURL=lifecycle.module.js.map