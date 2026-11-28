import { Module } from '@nestjs/common';
import { SitePlansAdminController, SitePlansPublicController } from './site-plans.controller';
import { SitePlansService } from './site-plans.service';
import { PlanPriceProposalService } from './plan-price-proposals.service';
import { ProductPlansClient } from './product-plans.client';

@Module({ controllers: [SitePlansPublicController, SitePlansAdminController], providers: [SitePlansService, PlanPriceProposalService, ProductPlansClient] })
export class SitePlansModule {}
