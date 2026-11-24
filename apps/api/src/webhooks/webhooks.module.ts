import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { PublicSiteModule } from '../public-site/public-site-public';

@Module({ imports: [PublicSiteModule], controllers: [WebhooksController], providers: [WebhooksService] })
export class WebhooksModule {}
