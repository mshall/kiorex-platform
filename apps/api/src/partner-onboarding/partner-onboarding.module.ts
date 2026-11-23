import { Module } from '@nestjs/common';
import { PartnerConnectionPublicController, PartnerOnboardingController } from './partner-onboarding.controller';
import { PartnerOnboardingService } from './partner-onboarding.service';

@Module({ controllers: [PartnerConnectionPublicController, PartnerOnboardingController], providers: [PartnerOnboardingService], exports: [PartnerOnboardingService] })
export class PartnerOnboardingModule {}
