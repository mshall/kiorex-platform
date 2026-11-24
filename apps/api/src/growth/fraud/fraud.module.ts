import { Global, Module } from '@nestjs/common';
import { FraudCaseService } from './case.service';
import { FraudCalibrationService, FraudJob } from './calibration.job';
import { FraudAdminController } from './fraud-admin.controller';
import { FraudConfigService } from './fraud-config.service';
import { FraudHoldService } from './fraud-hold.service';
import { FRAUD_SCORER } from './fraud-public';
import { FraudScoringService } from './fraud-scoring.service';
import { FraudReviewQueueService } from './review-queue.service';

/**
 * GRW-P3-D fraud detection v2. Global so the referral, touch and widget code reach the scorer through the `FRAUD_SCORER` token (optional there) without a load-order cycle.
 * Imports no booking, Pay, Clinic or attribution code: nothing here can change a decision, a commission or a booking (guard test fraud-guard.unit.spec.ts).
 */
@Global()
@Module({
  controllers: [FraudAdminController],
  providers: [FraudConfigService, FraudHoldService, FraudCaseService, FraudReviewQueueService, FraudScoringService, { provide: FRAUD_SCORER, useExisting: FraudScoringService }, FraudCalibrationService, FraudJob],
  exports: [FRAUD_SCORER, FraudScoringService, FraudConfigService, FraudCaseService, FraudReviewQueueService, FraudCalibrationService, FraudHoldService, FraudJob],
})
export class FraudModule {}
