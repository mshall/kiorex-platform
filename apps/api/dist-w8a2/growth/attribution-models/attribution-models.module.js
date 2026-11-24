"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AttributionModelsModule = void 0;
const common_1 = require("@nestjs/common");
const attribution_models_controller_1 = require("./attribution-models.controller");
const model_data_service_1 = require("./model-data.service");
const model_report_service_1 = require("./model-report.service");
const model_rollup_job_1 = require("./model-rollup.job");
let AttributionModelsModule = class AttributionModelsModule {
};
exports.AttributionModelsModule = AttributionModelsModule;
exports.AttributionModelsModule = AttributionModelsModule = __decorate([
    (0, common_1.Module)({ controllers: [attribution_models_controller_1.AttributionModelsController], providers: [model_data_service_1.ModelDataService, model_report_service_1.ModelReportService, model_rollup_job_1.ModelRollupJob], exports: [model_report_service_1.ModelReportService] })
], AttributionModelsModule);
//# sourceMappingURL=attribution-models.module.js.map