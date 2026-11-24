import { Module } from '@nestjs/common';
import { AiSummaryService } from './ai-summary.service';
import { RecommendationInputsService } from './recommendation-inputs.service';
import { RecommendationJob } from './recommendation.job';
import { RecommendationService } from './recommendation.service';
import { RecommendationsAdminController } from './recommendations-admin.controller';

/** GRW-P3-E AI-assisted campaign recommendations (advisory, aggregate-only, human approved). Needs the global Prisma, ControlPlane, Growth config and Campaigns modules. */
@Module({
  controllers: [RecommendationsAdminController],
  providers: [RecommendationInputsService, AiSummaryService, RecommendationService, RecommendationJob],
  exports: [RecommendationService, RecommendationJob, AiSummaryService],
})
export class RecommendationsModule {}
