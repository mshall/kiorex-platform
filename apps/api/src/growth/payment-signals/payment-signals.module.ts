import { Global, Module } from '@nestjs/common';
import { PAYMENT_SIGNALS_PORT } from '../growth-ports-public';
import { ReferralModule } from '../referral/referral.module';
import { RewardsModule } from '../rewards/rewards.module';
import { PaymentSignalsService } from './payment-signals.service';

/** PAY-READY: Pay reaches the growth engine's card-fingerprint and dispute signals through the PAYMENT_SIGNALS_PORT token only. */
@Global()
@Module({ imports: [ReferralModule, RewardsModule], providers: [PaymentSignalsService, { provide: PAYMENT_SIGNALS_PORT, useExisting: PaymentSignalsService }], exports: [PAYMENT_SIGNALS_PORT, PaymentSignalsService] })
export class PaymentSignalsModule {}
