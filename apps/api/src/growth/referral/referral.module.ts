import { Global, Module } from '@nestjs/common';
import { KiorlyModule } from '../../kiorly/kiorly-public';
import { REFERRAL_PORT } from '../growth-ports-public';
import { ReferralAdminController } from './referral-admin.controller';
import { ReferralClaimService } from './referral-claim.service';
import { ReferralExpiryJob } from './referral-expiry.job';
import { ReferralFraudService } from './referral-fraud.service';
import { ClinicStaffPhoneMatch, MockStaffPhoneMatch, ReferralIdentityService, STAFF_PHONE_MATCH } from './referral-identity.service';
import { ReferralQualificationService } from './referral-qualification.service';
import { ReferralController } from './referral.controller';
import { ReferralService } from './referral.service';

/**
 * GRW-P2-B1 patient referral engine. Global so the growth booking service can hand it booking facts through the `REFERRAL_PORT` token without a load-order cycle.
 * The staff-phone match against the Clinic is a port: MOCK by default, `STAFF_PHONE_MATCH_MODE=clinic` calls the signed Clinic endpoint (built in wave 9).
 */
@Global()
@Module({
  imports: [KiorlyModule],
  controllers: [ReferralController, ReferralAdminController],
  providers: [
    ReferralIdentityService, MockStaffPhoneMatch, ClinicStaffPhoneMatch, { provide: STAFF_PHONE_MATCH, useFactory: (m: MockStaffPhoneMatch, c: ClinicStaffPhoneMatch) => (process.env.STAFF_PHONE_MATCH_MODE === 'clinic' ? c : m), inject: [MockStaffPhoneMatch, ClinicStaffPhoneMatch] }, ReferralFraudService, ReferralService, ReferralClaimService, ReferralQualificationService,
    { provide: REFERRAL_PORT, useExisting: ReferralQualificationService }, ReferralExpiryJob,
  ],
  exports: [REFERRAL_PORT, ReferralService, ReferralClaimService, ReferralQualificationService, ReferralIdentityService, ReferralExpiryJob, MockStaffPhoneMatch],
})
export class ReferralModule {}
