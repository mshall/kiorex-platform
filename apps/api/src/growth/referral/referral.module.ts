import { Global, Module } from '@nestjs/common';
import { REFERRAL_PORT } from '../growth-ports-public';
import { ReferralAdminController } from './referral-admin.controller';
import { ReferralClaimService } from './referral-claim.service';
import { ReferralExpiryJob } from './referral-expiry.job';
import { ReferralFraudService } from './referral-fraud.service';
import { MockStaffPhoneMatch, ReferralIdentityService, STAFF_PHONE_MATCH } from './referral-identity.service';
import { ReferralQualificationService } from './referral-qualification.service';
import { ReferralController } from './referral.controller';
import { ReferralService } from './referral.service';

/**
 * GRW-P2-B1 patient referral engine. Global so the growth booking service can hand it booking facts through the `REFERRAL_PORT` token without a load-order cycle.
 * The staff-phone match against the Clinic is a port with a MOCK implementation (the signed Clinic endpoint is not built, see Docs/GROWTH.md).
 */
@Global()
@Module({
  controllers: [ReferralController, ReferralAdminController],
  providers: [
    ReferralIdentityService, MockStaffPhoneMatch, { provide: STAFF_PHONE_MATCH, useExisting: MockStaffPhoneMatch }, ReferralFraudService, ReferralService, ReferralClaimService, ReferralQualificationService,
    { provide: REFERRAL_PORT, useExisting: ReferralQualificationService }, ReferralExpiryJob,
  ],
  exports: [REFERRAL_PORT, ReferralService, ReferralClaimService, ReferralQualificationService, ReferralIdentityService, ReferralExpiryJob, MockStaffPhoneMatch],
})
export class ReferralModule {}
