import { Global, Module } from '@nestjs/common';
import { DevMessagingController } from './dev-messaging.controller';
import { MessagingOpsController } from './messaging-ops.controller';
import { MessagingOpsService } from './messaging-ops.service';
import { MessagingWebhookController, UnsubscribeController } from './messaging-webhook.controller';
import { MessagingHub } from './messaging.hub';

@Global()
@Module({ controllers: [DevMessagingController, MessagingWebhookController, UnsubscribeController, MessagingOpsController], providers: [MessagingHub, MessagingOpsService], exports: [MessagingHub, MessagingOpsService] })
export class MessagingModule {}
