import { Module } from '@nestjs/common';
import { LeadConfigService } from './lead-config.service';
import { LeadNotifier } from './lead-notifier';
import { LeadsAdminController, LeadsPublicController } from './leads.controller';
import { LeadsService } from './leads.service';

@Module({ controllers: [LeadsPublicController, LeadsAdminController], providers: [LeadConfigService, LeadNotifier, LeadsService], exports: [LeadsService] })
export class LeadsModule {}
