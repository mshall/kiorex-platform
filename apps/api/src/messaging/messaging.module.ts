import { Global, Module } from '@nestjs/common';
import { DevMessagingController } from './dev-messaging.controller';
import { MessagingWebhookController } from './messaging-webhook.controller';
import { MessagingHub } from './messaging.hub';

@Global()
@Module({ controllers: [DevMessagingController, MessagingWebhookController], providers: [MessagingHub], exports: [MessagingHub] })
export class MessagingModule {}
