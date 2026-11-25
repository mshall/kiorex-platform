import { Global, Module } from '@nestjs/common';
import { DevPayController } from './dev-pay.controller';
import { PayController } from './pay.controller';
import { PayConnectionService } from './pay-connection.service';
import { PayFinanceController, PayLinkPublicController } from './pay-finance.controller';
import { PayUnifiedService } from './pay-unified.service';
import { PayOpsController } from './pay-ops.controller';
import { PayReconcileService } from './pay-reconcile.service';
import { PayService } from './pay.service';
import { PspConfigService } from './psp-config.service';
import { RefundDestinationController } from './refund-destination.controller';
import { RefundDestinationService } from './refund-destination.service';

@Global()
@Module({ controllers: [PayController, DevPayController, RefundDestinationController, PayOpsController, PayFinanceController, PayLinkPublicController], providers: [PayUnifiedService, PayConnectionService, PspConfigService, PayReconcileService, PayService, RefundDestinationService], exports: [PayUnifiedService, PayService, PspConfigService, PayReconcileService, RefundDestinationService] })
export class PayModule {}
