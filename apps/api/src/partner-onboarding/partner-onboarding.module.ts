import { Module } from '@nestjs/common';
import { PartnerConnectionPublicController, PartnerEnrolmentController, PartnerOnboardingController } from './partner-onboarding.controller';
import { PartnerEnrolmentService } from './partner-enrolment.service';
import { PartnerOnboardingService } from './partner-onboarding.service';

@Module({ controllers: [PartnerConnectionPublicController, PartnerEnrolmentController, PartnerOnboardingController], providers: [PartnerOnboardingService, PartnerEnrolmentService], exports: [PartnerOnboardingService] })
export class PartnerOnboardingModule {}
