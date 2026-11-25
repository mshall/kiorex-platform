"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecommendationsModule = void 0;
const common_1 = require("@nestjs/common");
const ai_summary_service_1 = require("./ai-summary.service");
const recommendation_inputs_service_1 = require("./recommendation-inputs.service");
const recommendation_job_1 = require("./recommendation.job");
const recommendation_service_1 = require("./recommendation.service");
const recommendations_admin_controller_1 = require("./recommendations-admin.controller");
let RecommendationsModule = class RecommendationsModule {
};
exports.RecommendationsModule = RecommendationsModule;
exports.RecommendationsModule = RecommendationsModule = __decorate([
    (0, common_1.Module)({
        controllers: [recommendations_admin_controller_1.RecommendationsAdminController],
        providers: [recommendation_inputs_service_1.RecommendationInputsService, ai_summary_service_1.AiSummaryService, recommendation_service_1.RecommendationService, recommendation_job_1.RecommendationJob],
        exports: [recommendation_service_1.RecommendationService, recommendation_job_1.RecommendationJob, ai_summary_service_1.AiSummaryService],
    })
], RecommendationsModule);
//# sourceMappingURL=recommendations.module.js.map