import { Global, Module } from '@nestjs/common';
import { DevPayController } from './dev-pay.controller';
import { PayController } from './pay.controller';
import { PayService } from './pay.service';
import { RefundDestinationController } from './refund-destination.controller';
import { RefundDestinationService } from './refund-destination.service';

@Global()
@Module({ controllers: [PayController, DevPayController, RefundDestinationController], providers: [PayService, RefundDestinationService], exports: [PayService, RefundDestinationService] })
export class PayModule {}
