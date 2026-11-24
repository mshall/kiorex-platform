import { Module } from '@nestjs/common';
import { CampaignsStubController } from './campaigns-stub.controller';

/** GRW-P2-X1 stub. GRW-P2-A replaces the controller below with the campaign engine. */
@Module({ controllers: [CampaignsStubController] })
export class CampaignsModule {}
