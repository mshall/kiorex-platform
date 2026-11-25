"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FraudModule = void 0;
const common_1 = require("@nestjs/common");
const case_service_1 = require("./case.service");
const calibration_job_1 = require("./calibration.job");
const fraud_admin_controller_1 = require("./fraud-admin.controller");
const fraud_config_service_1 = require("./fraud-config.service");
const fraud_hold_service_1 = require("./fraud-hold.service");
const fraud_public_1 = require("./fraud-public");
const fraud_scoring_service_1 = require("./fraud-scoring.service");
const review_queue_service_1 = require("./review-queue.service");
let FraudModule = class FraudModule {
};
exports.FraudModule = FraudModule;
exports.FraudModule = FraudModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        controllers: [fraud_admin_controller_1.FraudAdminController],
        providers: [fraud_config_service_1.FraudConfigService, fraud_hold_service_1.FraudHoldService, case_service_1.FraudCaseService, review_queue_service_1.FraudReviewQueueService, fraud_scoring_service_1.FraudScoringService, { provide: fraud_public_1.FRAUD_SCORER, useExisting: fraud_scoring_service_1.FraudScoringService }, calibration_job_1.FraudCalibrationService, calibration_job_1.FraudJob],
        exports: [fraud_public_1.FRAUD_SCORER, fraud_scoring_service_1.FraudScoringService, fraud_config_service_1.FraudConfigService, case_service_1.FraudCaseService, review_queue_service_1.FraudReviewQueueService, calibration_job_1.FraudCalibrationService, fraud_hold_service_1.FraudHoldService, calibration_job_1.FraudJob],
    })
], FraudModule);
//# sourceMappingURL=fraud.module.js.map