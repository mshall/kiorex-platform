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

@Global()
@Module({
  imports: [OutboxModule, KiorlyModule],
  controllers: [CommissionOpsController],
  providers: [
    CommissionClaimsService, CommissionConfigService, CommissionQueryService, CommissionCollectionService, MockCommissionCollector, RealCommissionCollector,
    { provide: COMMISSION_COLLECTOR, useFactory: collectorForMode, inject: [MockCommissionCollector, RealCommissionCollector] },
    { provide: COMMISSION_NETTING_PORT, useExisting: CommissionCollectionService },
  ],
  exports: [CommissionClaimsService, CommissionConfigService, CommissionQueryService, CommissionCollectionService, COMMISSION_NETTING_PORT],
})
export class CommissionsModule {}
