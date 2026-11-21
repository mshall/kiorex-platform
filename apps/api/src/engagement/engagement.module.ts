import { Global, Module } from '@nestjs/common';
import { DevSamplesController } from './dev-samples.controller';
import { EngagementController } from './engagement.controller';
import { EngagementService } from './engagement.service';

@Global()
@Module({ controllers: [EngagementController, DevSamplesController], providers: [EngagementService], exports: [EngagementService] })
export class EngagementModule {}
