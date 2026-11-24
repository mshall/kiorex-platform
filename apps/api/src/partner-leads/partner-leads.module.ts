import { Module } from '@nestjs/common';
import { PartnerLeadsOpsController, PartnerLeadsPublicController } from './partner-leads.controller';
import { LeadAlertsService } from './lead-alerts.service';
import { PartnerLeadsService } from './partner-leads.service';

@Module({ controllers: [PartnerLeadsPublicController, PartnerLeadsOpsController], providers: [PartnerLeadsService, LeadAlertsService], exports: [PartnerLeadsService, LeadAlertsService] })
export class PartnerLeadsModule {}
