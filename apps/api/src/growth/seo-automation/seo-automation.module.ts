import { Global, Module } from '@nestjs/common';
import { SeoIndexationService } from './indexation.service';
import { SeoAutomationController } from './seo-automation.controller';
import { SeoAutomationJob } from './seo-automation.job';
import { SEO_QUALITY } from './seo-automation-public';
import { SeoAutomationService } from './seo-automation.service';
import { SeoVitalsService } from './vitals.service';

/**
 * GRW-P3-F SEO automation. Global so the public site reaches the quality port through the `SEO_QUALITY` token (optional there) without a module cycle. It imports nothing from the public site:
 * the site provides the `SEO_SITE` port (read-only page captures, sitemap entries, facets).
 */
@Global()
@Module({
  controllers: [SeoAutomationController],
  providers: [SeoAutomationService, { provide: SEO_QUALITY, useExisting: SeoAutomationService }, SeoVitalsService, SeoIndexationService, SeoAutomationJob],
  exports: [SEO_QUALITY, SeoAutomationService, SeoVitalsService, SeoIndexationService, SeoAutomationJob],
})
export class SeoAutomationModule {}
