import { Global, Module } from '@nestjs/common';
import { CORPORATE_BENEFIT_PORT } from '../growth-ports-public';
import { B2bReferralService } from './b2b-referral.service';
import { CorporateAdminController } from './corporate-admin.controller';
import { CorporateBenefitService } from './corporate-benefit.service';
import { CorporateConfigService } from './corporate-config';
import { CorporateEventsService } from './corporate-events.service';
import { CorporateMemberService } from './corporate-member.service';
import { CorporatePublicController } from './corporate-public.controller';
import { CorporateReportService } from './corporate-report.service';
import { CorporateJob } from './corporate.job';
import { CorporateService } from './corporate.service';

/** GRW-P4-C corporate partnerships (Kiorex side). Global so the webhook receiver and Pay reach the lead ingest and the benefit port by class or token without importing this folder. GrowthLimiter comes from the global GrowthModule. */
@Global()
@Module({
  controllers: [CorporateAdminController, CorporatePublicController],
  providers: [CorporateConfigService, CorporateEventsService, CorporateService, CorporateMemberService, CorporateBenefitService, CorporateReportService, B2bReferralService, CorporateJob, { provide: CORPORATE_BENEFIT_PORT, useExisting: CorporateBenefitService }],
  exports: [CorporateService, CorporateMemberService, CorporateBenefitService, CorporateReportService, B2bReferralService, CorporateJob, CORPORATE_BENEFIT_PORT],
})
export class CorporateModule {}
