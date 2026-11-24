import { Global, Module } from '@nestjs/common';
import { KiorlyModule } from '../../kiorly/kiorly-public';
import { PromotionFraudSignals } from './promotion-fraud.signals';
import { PromotionLedgerViewService } from './promotion-ledger-view.service';
import { PromotionProjectionService } from './promotion-projection.service';
import { PromotionQuoteService } from './promotion-quote.service';
import { KiorlyPromotionReservationClient, PROMOTION_RESERVATION_CLIENT } from './promotion-reservation.client';
import { PromotionReviewService } from './promotion-review.service';
import { PromotionsAdminController } from './promotions-admin.controller';
import { PromotionsPublicController } from './promotions-public.controller';
import { SPONSORED_DISCOUNT_PORT } from '../growth-ports-public';
import { SponsoredDiscountService } from './sponsored-discount.service';

/** GRW-P2-S (Kiorex side). Global so the webhook receiver and the booking service reach the projection and the sponsored-discount service by class without importing this folder. */
@Global()
@Module({
  imports: [KiorlyModule],
  controllers: [PromotionsAdminController, PromotionsPublicController],
  providers: [PromotionProjectionService, PromotionQuoteService, PromotionReviewService, PromotionLedgerViewService, PromotionFraudSignals, SponsoredDiscountService, KiorlyPromotionReservationClient, { provide: PROMOTION_RESERVATION_CLIENT, useExisting: KiorlyPromotionReservationClient }, { provide: SPONSORED_DISCOUNT_PORT, useExisting: SponsoredDiscountService }],
  exports: [PromotionProjectionService, PromotionQuoteService, PromotionReviewService, SponsoredDiscountService, PROMOTION_RESERVATION_CLIENT, SPONSORED_DISCOUNT_PORT],
})
export class SponsoredPromotionsModule {}
