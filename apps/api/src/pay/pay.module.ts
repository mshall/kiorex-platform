import { Global, Module } from '@nestjs/common';
import { DevPayController } from './dev-pay.controller';
import { PayController } from './pay.controller';
import { PayService } from './pay.service';

@Global()
@Module({ controllers: [PayController, DevPayController], providers: [PayService], exports: [PayService] })
export class PayModule {}
