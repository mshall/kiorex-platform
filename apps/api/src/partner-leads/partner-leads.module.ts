import { Module } from '@nestjs/common';
import { PartnerLeadsOpsController, PartnerLeadsPublicController } from './partner-leads.controller';
import { PartnerLeadsService } from './partner-leads.service';

@Module({ controllers: [PartnerLeadsPublicController, PartnerLeadsOpsController], providers: [PartnerLeadsService], exports: [PartnerLeadsService] })
export class PartnerLeadsModule {}
