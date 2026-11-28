import { Module } from '@nestjs/common';
import { LeadConfigService } from './lead-config.service';
import { LeadOnboardingService } from './lead-onboarding.service';
import { LeadNotifier } from './lead-notifier';
import { LeadOnboardingController, LeadsAdminController, LeadsPublicController } from './leads.controller';
import { LeadsService } from './leads.service';
import { LeadRoutingService } from './lead-routing.service';
import { PartnerOnboardingModule } from '../partner-onboarding/partner-onboarding-public';

@Module({ imports: [PartnerOnboardingModule], controllers: [LeadsPublicController, LeadsAdminController, LeadOnboardingController], providers: [LeadConfigService, LeadNotifier, LeadOnboardingService, LeadRoutingService, LeadsService], exports: [LeadsService] })
export class LeadsModule {}
