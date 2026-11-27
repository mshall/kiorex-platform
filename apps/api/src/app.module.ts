import { Module } from '@nestjs/common';
import { AddressModule } from './address/address-public';
import { HomeCareModule } from './homecare/homecare-public';
import { AiGatewayModule, AssistantModule } from './ai-gateway/ai-gateway-public';
import { AuthModule } from './auth/auth-public';
import { BookingModule } from './booking/booking-public';
import { CatalogModule } from './catalog/catalog-public';
import { ControlPlaneModule } from './control-plane/control-plane-public';
import { EngagementModule } from './engagement/engagement-public';
import { HealthModule } from './health/health.module';
import { CampaignsModule, ReferralModule, RewardsModule, LifecycleModule, IntegrationsModule, GrowthModule, AttributionModelsModule, ExperimentsModule, SponsoredPromotionsModule, FraudModule, SeoAutomationModule, AutomationModule, RecommendationsModule, CohortsModule, MarketOnboardingModule } from './growth/growth-public';
import { CorporateModule } from './growth/corporate-public';
import { LoyaltyModule } from './growth/loyalty-public';
import { PaymentSignalsModule } from './growth/payment-signals-public';
import { PublicSiteModule } from './public-site/public-site-public';
import { WidgetModule } from './widget/widget-public';
import { AnalyticsModule } from './analytics/analytics-public';
import { MarketModule } from './market/market-public';
import { KiorlyMarketsModule } from './kiorly-markets/kiorly-markets-public';
import { PolicyModule } from './policy/policy-public';
import { MessagingModule } from './messaging/messaging-public';
import { KiorlyModule } from './kiorly/kiorly-public';
import { OpsModule } from './ops/ops.module';
import { OnboardingImportModule } from './onboarding-import/onboarding-import-public';
import { PartnersModule } from './partners/partners-public';
import { PartnerOnboardingModule } from './partner-onboarding/partner-onboarding-public';
import { PartnerLeadsModule } from './partner-leads/partner-leads-public';
import { LeadsModule } from './leads/leads-public';
import { OutboxModule } from './outbox/outbox-public';
import { LabModule } from './lab/lab-public';
import { PharmacyModule } from './pharmacy/pharmacy-public';
import { ChannelsModule } from './channels/channels-public';
import { WaitlistModule } from './waitlist/waitlist-public';
import { RecordsModule } from './records/records-public';
import { PatientModule } from './patient/patient-public';
import { PayModule } from './pay/pay-public';
import { CommissionsModule } from './commissions/commissions-public';
import { TelemedicineModule } from './telemedicine/telemedicine-public';
import { PrismaModule } from './prisma/prisma.module';
import { TrustModule } from './trust/trust-public';
import { WebhooksModule } from './webhooks/webhooks.module';

/** Modular monolith: order matters for APP_GUARD (auth before flag guard). Modules reach each other only via *-public.ts. */
@Module({
  imports: [PrismaModule, OutboxModule, MessagingModule, MarketModule, KiorlyMarketsModule, PolicyModule, AnalyticsModule, AuthModule, ControlPlaneModule, KiorlyModule, PatientModule, AddressModule, CatalogModule, EngagementModule, PayModule, CommissionsModule, BookingModule, TrustModule, AiGatewayModule, WebhooksModule, OpsModule, OnboardingImportModule, PartnerOnboardingModule, PartnerLeadsModule, LeadsModule, RecordsModule, WaitlistModule, ChannelsModule, PharmacyModule, LabModule, PartnersModule, TelemedicineModule, HomeCareModule, GrowthModule, CampaignsModule, ReferralModule, RewardsModule, LifecycleModule, IntegrationsModule, AttributionModelsModule, ExperimentsModule, SponsoredPromotionsModule, FraudModule, SeoAutomationModule, AutomationModule, RecommendationsModule, CohortsModule, MarketOnboardingModule, CorporateModule, LoyaltyModule, PaymentSignalsModule, AssistantModule, PublicSiteModule, WidgetModule, HealthModule],
})
export class AppModule {}
