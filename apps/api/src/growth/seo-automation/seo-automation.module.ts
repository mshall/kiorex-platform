import { Global, Module } from '@nestjs/common';
import { SeoIndexationService } from './indexation.service';
import { SeoAutomationController } from './seo-automation.controller';
import { SeoGateTriggerService } from './seo-trigger.service';
import { SeoAutomationJob } from './seo-automation.job';
import { SEO_EDITS, SEO_QUALITY, SEO_TRIGGER } from './seo-automation-public';
import { LandingEditController } from './landing-edit.controller';
import { LandingEditService } from './landing-edit.service';
import { SeoAutomationService } from './seo-automation.service';
import { SeoVitalsService } from './vitals.service';

/**
 * GRW-P3-F SEO automation. Global so the public site reaches the quality port through the `SEO_QUALITY` token (optional there) without a module cycle. It imports nothing from the public site:
 * the site provides the `SEO_SITE` port (read-only page captures, sitemap entries, facets).
 */
@Global()
@Module({
  controllers: [SeoAutomationController, LandingEditController],
  providers: [LandingEditService, { provide: SEO_EDITS, useExisting: LandingEditService }, SeoAutomationService, { provide: SEO_QUALITY, useExisting: SeoAutomationService }, SeoVitalsService, SeoIndexationService, SeoAutomationJob, SeoGateTriggerService, { provide: SEO_TRIGGER, useExisting: SeoGateTriggerService }],
  exports: [SEO_EDITS, LandingEditService, SEO_QUALITY, SEO_TRIGGER, SeoGateTriggerService, SeoAutomationService, SeoVitalsService, SeoIndexationService, SeoAutomationJob],
})
export class SeoAutomationModule {}
