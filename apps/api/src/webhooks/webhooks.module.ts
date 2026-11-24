import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { PublicSiteModule } from '../public-site/public-site-public';
import { WidgetModule } from '../widget/widget-public';
import { PartnerOnboardingModule } from '../partner-onboarding/partner-onboarding-public';

@Module({ imports: [PublicSiteModule, WidgetModule, PartnerOnboardingModule], controllers: [WebhooksController], providers: [WebhooksService] })
export class WebhooksModule {}
