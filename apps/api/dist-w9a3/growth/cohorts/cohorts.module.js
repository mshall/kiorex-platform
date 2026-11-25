"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CohortsModule = void 0;
const common_1 = require("@nestjs/common");
const cohort_data_service_1 = require("./cohort-data.service");
const cohort_rollup_job_1 = require("./cohort-rollup.job");
const cohort_service_1 = require("./cohort.service");
const cohorts_controller_1 = require("./cohorts.controller");
let CohortsModule = class CohortsModule {
};
exports.CohortsModule = CohortsModule;
exports.CohortsModule = CohortsModule = __decorate([
    (0, common_1.Module)({ controllers: [cohorts_controller_1.CohortsController], providers: [cohort_data_service_1.CohortDataService, cohort_service_1.CohortService, cohort_rollup_job_1.CohortRollupJob], exports: [cohort_service_1.CohortService] })
], CohortsModule);
//# sourceMappingURL=cohorts.module.js.map