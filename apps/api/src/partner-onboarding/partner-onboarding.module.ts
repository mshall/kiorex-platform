import { Module } from '@nestjs/common';
import { PartnerConnectionPublicController, PartnerEnrolmentController, PartnerOnboardingController, VerificationUpdateController } from './partner-onboarding.controller';
import { VerificationUpdateService } from './verification-update.consumer';
import { PartnerEnrolmentService } from './partner-enrolment.service';
import { PartnerOnboardingService } from './partner-onboarding.service';

@Module({ controllers: [PartnerConnectionPublicController, PartnerEnrolmentController, PartnerOnboardingController, VerificationUpdateController], providers: [PartnerOnboardingService, PartnerEnrolmentService, VerificationUpdateService], exports: [PartnerOnboardingService, VerificationUpdateService] })
export class PartnerOnboardingModule {}
