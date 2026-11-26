import { Global, Module } from '@nestjs/common';
import { COMMISSION_NETTING_PORT } from '../common/commission-netting-port';
import { KiorlyModule } from '../kiorly/kiorly-public';
import { OutboxModule } from '../outbox/outbox-public';
import { CommissionClaimsService } from './commission-claims.service';
import { COMMISSION_COLLECTOR, MockCommissionCollector, RealCommissionCollector, collectorForMode } from './commission-collector';
import { CommissionCollectionService } from './commission-collection.service';
import { CommissionConfigService } from './commission-config.service';
import { CommissionOpsController } from './commission-ops.controller';
import { CommissionQueryService } from './commission-query.service';
import { CommissionPolicyController } from './commission-policy.controller';
import { CommissionPolicyService } from './commission-policy.service';
import { COUNSEL_GATE_PORT } from '../common/counsel-gate-port';
import { PAYOUT_ROUTE_GATE_PORT } from '../common/payout-route-gate-port';
import { CommissionSettlementService } from './commission-settlement.service';
import { CommissionRateService } from './commission-rate.service';
import { CommissionRatesController } from './commission-rates.controller';
import { CommissionPartnerStatementController } from './commission-partner-statement.controller';
import { CommissionPartnerStatementService } from './commission-partner-statement.service';

@Global()
@Module({
  imports: [OutboxModule, KiorlyModule],
  controllers: [CommissionOpsController, CommissionRatesController, CommissionPolicyController, CommissionPartnerStatementController],
  providers: [
    CommissionClaimsService, CommissionConfigService, CommissionPolicyService, CommissionSettlementService, CommissionPartnerStatementService, CommissionRateService, CommissionQueryService, CommissionCollectionService, MockCommissionCollector, RealCommissionCollector,
    { provide: COMMISSION_COLLECTOR, useFactory: collectorForMode, inject: [MockCommissionCollector, RealCommissionCollector] },
    { provide: COMMISSION_NETTING_PORT, useExisting: CommissionCollectionService },
    { provide: COUNSEL_GATE_PORT, useExisting: CommissionPolicyService },
    { provide: PAYOUT_ROUTE_GATE_PORT, useFactory: (p: CommissionPolicyService) => ({ blockedReason: (orgRef: string, psp: string) => p.payoutRouteBlock(orgRef, psp) }), inject: [CommissionPolicyService] },
  ],
  exports: [CommissionClaimsService, CommissionConfigService, CommissionPolicyService, PAYOUT_ROUTE_GATE_PORT, COUNSEL_GATE_PORT, CommissionRateService, CommissionQueryService, CommissionCollectionService, COMMISSION_NETTING_PORT],
})
export class CommissionsModule {}
