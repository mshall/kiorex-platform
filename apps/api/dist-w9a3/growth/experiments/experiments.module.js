"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExperimentsModule = void 0;
const common_1 = require("@nestjs/common");
const experiment_evaluator_job_1 = require("./experiment-evaluator.job");
const experiment_rollup_service_1 = require("./experiment-rollup.service");
const experiment_service_1 = require("./experiment.service");
const experiments_admin_controller_1 = require("./experiments-admin.controller");
const experiments_public_controller_1 = require("./experiments-public.controller");
const exposure_service_1 = require("./exposure.service");
const ssr_variant_service_1 = require("./ssr-variant.service");
let ExperimentsModule = class ExperimentsModule {
};
exports.ExperimentsModule = ExperimentsModule;
exports.ExperimentsModule = ExperimentsModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        controllers: [experiments_admin_controller_1.ExperimentsAdminController, experiments_public_controller_1.ExperimentsPublicController],
        providers: [experiment_service_1.ExperimentService, exposure_service_1.ExposureService, ssr_variant_service_1.SsrVariantService, experiment_rollup_service_1.ExperimentRollupService, experiment_evaluator_job_1.ExperimentEvaluatorJob],
        exports: [experiment_service_1.ExperimentService, exposure_service_1.ExposureService, ssr_variant_service_1.SsrVariantService, experiment_evaluator_job_1.ExperimentEvaluatorJob],
    })
], ExperimentsModule);
//# sourceMappingURL=experiments.module.js.map