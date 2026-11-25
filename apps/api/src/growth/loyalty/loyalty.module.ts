import { Global, Module } from '@nestjs/common';
import { LOYALTY_PORT } from '../growth-ports-public';
import { LoyaltyAdminController } from './loyalty-admin.controller';
import { LoyaltyAdminService } from './loyalty-admin.service';
import { LoyaltyEventsService } from './loyalty-events.service';
import { LoyaltyPublicController } from './loyalty-public.controller';
import { LoyaltyRedemptionAdapter } from './loyalty-redemption.adapter';
import { LoyaltyJob } from './loyalty.job';
import { LoyaltyService } from './loyalty.service';
import { PartnershipOfferService } from './partnership-offer.service';

/**
 * GRW-P4-D loyalty points and partnership programs (Kiorex side). Global so the booking hook and the rewards port reach it through the `LOYALTY_PORT` token without importing this folder (no load-order cycle).
 * Needs RewardsModule (global) for the issuance service the adapter uses; reads campaigns only through the database rules.
 */
@Global()
@Module({
  controllers: [LoyaltyAdminController, LoyaltyPublicController],
  providers: [LoyaltyEventsService, LoyaltyRedemptionAdapter, LoyaltyService, LoyaltyAdminService, PartnershipOfferService, LoyaltyJob, { provide: LOYALTY_PORT, useExisting: LoyaltyService }],
  exports: [LoyaltyService, PartnershipOfferService, LoyaltyAdminService, LoyaltyJob, LOYALTY_PORT],
})
export class LoyaltyModule {}
