import { Global, Module } from '@nestjs/common';
import { CampaignApprovalService } from './campaign-approval.service';
import { CampaignBudgetService } from './campaign-budget.service';
import { CampaignReportService } from './campaign-report.service';
import { CampaignSchedulerService } from './campaign-scheduler.service';
import { CampaignService } from './campaign.service';
import { CampaignsAdminController } from './campaigns-admin.controller';
import { CampaignsPublicController } from './campaigns-public.controller';

/**
 * GRW-P2-A campaign management engine. Global so the touch service and the spend service of the growth module reach `CampaignService` and `CampaignBudgetService` without importing this module
 * (they sit in the same bounded context; the module is registered in app.module by GRW-P2-X1).
 */
@Global()
@Module({
  controllers: [CampaignsAdminController, CampaignsPublicController],
  providers: [CampaignService, CampaignApprovalService, CampaignBudgetService, CampaignReportService, CampaignSchedulerService],
  exports: [CampaignService, CampaignBudgetService, CampaignSchedulerService],
})
export class CampaignsModule {}
