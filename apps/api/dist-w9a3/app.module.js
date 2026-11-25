"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const address_public_1 = require("./address/address-public");
const homecare_public_1 = require("./homecare/homecare-public");
const ai_gateway_public_1 = require("./ai-gateway/ai-gateway-public");
const auth_public_1 = require("./auth/auth-public");
const booking_public_1 = require("./booking/booking-public");
const catalog_public_1 = require("./catalog/catalog-public");
const control_plane_public_1 = require("./control-plane/control-plane-public");
const engagement_public_1 = require("./engagement/engagement-public");
const health_module_1 = require("./health/health.module");
const growth_public_1 = require("./growth/growth-public");
const corporate_public_1 = require("./growth/corporate-public");
const public_site_public_1 = require("./public-site/public-site-public");
const widget_public_1 = require("./widget/widget-public");
const analytics_public_1 = require("./analytics/analytics-public");
const market_public_1 = require("./market/market-public");
const policy_public_1 = require("./policy/policy-public");
const messaging_public_1 = require("./messaging/messaging-public");
const kiorly_public_1 = require("./kiorly/kiorly-public");
const ops_module_1 = require("./ops/ops.module");
const onboarding_import_public_1 = require("./onboarding-import/onboarding-import-public");
const partners_public_1 = require("./partners/partners-public");
const partner_onboarding_public_1 = require("./partner-onboarding/partner-onboarding-public");
const partner_leads_public_1 = require("./partner-leads/partner-leads-public");
const outbox_public_1 = require("./outbox/outbox-public");
const lab_public_1 = require("./lab/lab-public");
const pharmacy_public_1 = require("./pharmacy/pharmacy-public");
const channels_public_1 = require("./channels/channels-public");
const waitlist_public_1 = require("./waitlist/waitlist-public");
const records_public_1 = require("./records/records-public");
const patient_public_1 = require("./patient/patient-public");
const pay_public_1 = require("./pay/pay-public");
const telemedicine_public_1 = require("./telemedicine/telemedicine-public");
const prisma_module_1 = require("./prisma/prisma.module");
const trust_public_1 = require("./trust/trust-public");
const webhooks_module_1 = require("./webhooks/webhooks.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule, outbox_public_1.OutboxModule, messaging_public_1.MessagingModule, market_public_1.MarketModule, policy_public_1.PolicyModule, analytics_public_1.AnalyticsModule, auth_public_1.AuthModule, control_plane_public_1.ControlPlaneModule, kiorly_public_1.KiorlyModule, patient_public_1.PatientModule, address_public_1.AddressModule, catalog_public_1.CatalogModule, engagement_public_1.EngagementModule, pay_public_1.PayModule, booking_public_1.BookingModule, trust_public_1.TrustModule, ai_gateway_public_1.AiGatewayModule, webhooks_module_1.WebhooksModule, ops_module_1.OpsModule, onboarding_import_public_1.OnboardingImportModule, partner_onboarding_public_1.PartnerOnboardingModule, partner_leads_public_1.PartnerLeadsModule, records_public_1.RecordsModule, waitlist_public_1.WaitlistModule, channels_public_1.ChannelsModule, pharmacy_public_1.PharmacyModule, lab_public_1.LabModule, partners_public_1.PartnersModule, telemedicine_public_1.TelemedicineModule, homecare_public_1.HomeCareModule, growth_public_1.GrowthModule, growth_public_1.CampaignsModule, growth_public_1.ReferralModule, growth_public_1.RewardsModule, growth_public_1.LifecycleModule, growth_public_1.IntegrationsModule, growth_public_1.AttributionModelsModule, growth_public_1.ExperimentsModule, growth_public_1.SponsoredPromotionsModule, growth_public_1.FraudModule, growth_public_1.SeoAutomationModule, growth_public_1.AutomationModule, growth_public_1.RecommendationsModule, growth_public_1.CohortsModule, growth_public_1.MarketOnboardingModule, corporate_public_1.CorporateModule, ai_gateway_public_1.AssistantModule, public_site_public_1.PublicSiteModule, widget_public_1.WidgetModule, health_module_1.HealthModule],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map