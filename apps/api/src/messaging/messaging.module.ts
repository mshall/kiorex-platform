import { Global, Module } from '@nestjs/common';
import { DevMessagingController } from './dev-messaging.controller';
import { MessagingHub } from './messaging.hub';

@Global()
@Module({ controllers: [DevMessagingController], providers: [MessagingHub], exports: [MessagingHub] })
export class MessagingModule {}
