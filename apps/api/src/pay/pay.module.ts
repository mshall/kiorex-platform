import { Global, Module } from '@nestjs/common';
import { PayController } from './pay.controller';
import { PayService } from './pay.service';

@Global()
@Module({ controllers: [PayController], providers: [PayService], exports: [PayService] })
export class PayModule {}
