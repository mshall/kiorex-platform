"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntegrationsModule = void 0;
const common_1 = require("@nestjs/common");
const channel_performance_service_1 = require("../analytics/channel-performance.service");
const external_metrics_service_1 = require("../analytics/external-metrics.service");
const integration_service_1 = require("./integration.service");
const integrations_admin_controller_1 = require("./integrations-admin.controller");
const pull_job_1 = require("./jobs/pull.job");
const push_conversions_job_1 = require("./jobs/push-conversions.job");
let IntegrationsModule = class IntegrationsModule {
};
exports.IntegrationsModule = IntegrationsModule;
exports.IntegrationsModule = IntegrationsModule = __decorate([
    (0, common_1.Module)({
        controllers: [integrations_admin_controller_1.IntegrationsAdminController],
        providers: [integration_service_1.IntegrationService, pull_job_1.IntegrationPullJob, push_conversions_job_1.PushConversionsJob, external_metrics_service_1.ExternalMetricsService, channel_performance_service_1.ChannelPerformanceService],
        exports: [integration_service_1.IntegrationService, channel_performance_service_1.ChannelPerformanceService],
    })
], IntegrationsModule);
//# sourceMappingURL=integrations.module.js.map