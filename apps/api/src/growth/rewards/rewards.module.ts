import { Global, Module } from '@nestjs/common';
import { REWARDS_PORT } from '../growth-ports-public';
import { GoodwillService } from './goodwill.service';
import { RewardEventsService } from './reward-events.service';
import { RewardExpiryJob } from './reward-expiry.job';
import { RewardFinanceService } from './reward-finance.service';
import { RewardHoldService } from './reward-hold.service';
import { RewardHouseholdService } from './reward-household.service';
import { RewardIssuanceService } from './reward-issuance.service';
import { RewardLedgerService } from './reward-ledger.service';
import { RewardPolicyService } from './reward-policy.service';
import { RewardReconcileJob } from './reward-reconcile.job';
import { RewardRedemptionService } from './reward-redemption.service';
import { RewardReversalService } from './reward-reversal.service';
import { RewardsAdminController } from './rewards-admin.controller';
import { RewardsController } from './rewards.controller';
import { RewardsPortService } from './rewards-port.service';
import { RewardsQueryService } from './rewards-query.service';

/**
 * GRW-P2-B2 patient rewards and credit ledger. Global so the Pay module can reach the ledger through the `REWARDS_PORT` token without importing growth (no load-order cycle).
 * Imports no Pay or Clinic code: nothing here can pay out, transfer or top up (guard test rewards-guard.unit.spec.ts).
 */
@Global()
@Module({
  controllers: [RewardsController, RewardsAdminController],
  providers: [
    RewardEventsService, RewardPolicyService, RewardLedgerService, RewardIssuanceService, RewardRedemptionService, RewardReversalService, RewardHoldService, RewardHouseholdService, GoodwillService, RewardFinanceService,
    RewardReconcileJob, RewardExpiryJob, RewardsQueryService, RewardsPortService, { provide: REWARDS_PORT, useExisting: RewardsPortService },
  ],
  exports: [REWARDS_PORT, RewardPolicyService, RewardIssuanceService, RewardRedemptionService, RewardReversalService, RewardHoldService, RewardLedgerService, RewardEventsService, RewardExpiryJob, RewardReconcileJob, RewardFinanceService, GoodwillService, RewardHouseholdService],
})
export class RewardsModule {}
