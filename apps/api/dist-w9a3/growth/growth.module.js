"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GrowthModule = void 0;
const common_1 = require("@nestjs/common");
const growth_admin_controller_1 = require("./admin/growth-admin.controller");
const growth_admin_service_1 = require("./admin/growth-admin.service");
const growth_config_admin_controller_1 = require("./admin/growth-config-admin.controller");
const growth_overview_source_1 = require("./admin/growth-overview.source");
const policy_1 = require("./attribution/policy");
const attribution_service_1 = require("./attribution/attribution.service");
const growth_config_controller_1 = require("./config/growth-config.controller");
const growth_config_service_1 = require("./config/growth-config.service");
const consent_wiring_1 = require("./consent/consent-wiring");
const visitor_consent_controller_1 = require("./consent/visitor-consent.controller");
const visitor_consent_service_1 = require("./consent/visitor-consent.service");
const subject_deleted_consumer_1 = require("./erasure/subject-deleted.consumer");
const evidence_controller_1 = require("./evidence/evidence.controller");
const evidence_service_1 = require("./evidence/evidence.service");
const growth_events_controller_1 = require("./events/growth-events.controller");
const growth_events_service_1 = require("./events/growth-events.service");
const growth_analytics_controller_1 = require("./analytics/growth-analytics.controller");
const export_service_1 = require("./analytics/export.service");
const metrics_service_1 = require("./analytics/metrics.service");
const revenue_service_1 = require("./analytics/revenue.service");
const rollup_job_1 = require("./analytics/rollup.job");
const rollup_service_1 = require("./analytics/rollup.service");
const spend_service_1 = require("./analytics/spend.service");
const growth_ports_public_1 = require("./growth-ports-public");
const product_decision_service_1 = require("./products/product-decision.service");
const product_decision_admin_controller_1 = require("./products/product-decision-admin.controller");
const product_decision_job_1 = require("./products/product-decision.job");
const booking_growth_service_1 = require("./booking/booking-growth.service");
const cross_product_controller_1 = require("./cross-product/cross-product.controller");
const continuity_consumer_1 = require("./cross-product/continuity.consumer");
const continuity_funnel_service_1 = require("./cross-product/continuity-funnel.service");
const continuity_service_1 = require("./cross-product/continuity.service");
const link_registry_job_1 = require("./links/link-registry.job");
const link_registry_service_1 = require("./links/link-registry.service");
const touch_rules_1 = require("./fraud/touch-rules");
const growth_limiter_1 = require("./growth-limiter");
const growth_maintenance_service_1 = require("./maintenance/growth-maintenance.service");
const retention_job_1 = require("./retention/retention.job");
const slug_service_1 = require("./slugs/slug.service");
const touch_controller_1 = require("./touch/touch.controller");
const touch_service_1 = require("./touch/touch.service");
let GrowthModule = class GrowthModule {
};
exports.GrowthModule = GrowthModule;
exports.GrowthModule = GrowthModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        controllers: [touch_controller_1.TouchController, growth_events_controller_1.GrowthEventsController, visitor_consent_controller_1.VisitorConsentController, evidence_controller_1.EvidenceController, growth_config_controller_1.GrowthConfigController, growth_config_admin_controller_1.GrowthConfigAdminController, growth_admin_controller_1.GrowthAdminController, product_decision_admin_controller_1.ProductDecisionAdminController, cross_product_controller_1.CrossProductController, cross_product_controller_1.CrossProductAdminController, growth_analytics_controller_1.GrowthAnalyticsOpsController, growth_analytics_controller_1.GrowthAnalyticsProviderController],
        providers: [
            growth_maintenance_service_1.GrowthMaintenanceService, growth_config_service_1.GrowthConfigService, policy_1.AttributionPolicyResolver, growth_limiter_1.GrowthLimiter, touch_rules_1.FraudSignalService, touch_service_1.TouchService, growth_events_service_1.GrowthEventsService, visitor_consent_service_1.VisitorConsentService,
            growth_admin_service_1.GrowthAdminService, growth_overview_source_1.InternalOverviewSource, growth_overview_source_1.AnalyticsOverviewSource, { provide: growth_overview_source_1.GROWTH_OVERVIEW_SOURCE, useExisting: growth_overview_source_1.AnalyticsOverviewSource },
            attribution_service_1.AttributionService, evidence_service_1.EvidenceService, link_registry_service_1.LinkRegistryService, continuity_service_1.CrossProductService, continuity_funnel_service_1.CrossProductFunnelService, continuity_consumer_1.CrossProductConsumer, continuity_consumer_1.CrossProductJob, continuity_consumer_1.CrossProductErasure, { provide: growth_ports_public_1.CROSS_PRODUCT_EVENTS, useExisting: continuity_consumer_1.CrossProductConsumer }, product_decision_service_1.GrowthProductBookingService, product_decision_job_1.ProductDecisionRepairJob, { provide: growth_ports_public_1.PRODUCT_GROWTH, useExisting: product_decision_service_1.GrowthProductBookingService }, link_registry_job_1.LinkRegistryJob, booking_growth_service_1.BookingGrowthService, revenue_service_1.GrowthRevenueService, rollup_service_1.GrowthRollupService, rollup_job_1.GrowthRollupJob, metrics_service_1.GrowthMetricsService, export_service_1.GrowthExportService, spend_service_1.GrowthSpendService, slug_service_1.SlugService,
            { provide: growth_ports_public_1.BOOKING_GROWTH, useExisting: booking_growth_service_1.BookingGrowthService }, { provide: growth_ports_public_1.GROWTH_REVENUE, useExisting: revenue_service_1.GrowthRevenueService }, { provide: growth_ports_public_1.LINK_REGISTRY, useExisting: link_registry_service_1.LinkRegistryService }, { provide: growth_ports_public_1.GROWTH_FACTS, useExisting: growth_events_service_1.GrowthEventsService }, retention_job_1.RetentionJob, subject_deleted_consumer_1.SubjectDeletedConsumer, consent_wiring_1.ConsentWiring,
        ],
        exports: [growth_limiter_1.GrowthLimiter, growth_ports_public_1.PRODUCT_GROWTH, growth_ports_public_1.CROSS_PRODUCT_EVENTS, continuity_service_1.CrossProductService, product_decision_service_1.GrowthProductBookingService, growth_ports_public_1.GROWTH_FACTS, growth_ports_public_1.BOOKING_GROWTH, growth_ports_public_1.GROWTH_REVENUE, growth_ports_public_1.LINK_REGISTRY, link_registry_service_1.LinkRegistryService, booking_growth_service_1.BookingGrowthService, revenue_service_1.GrowthRevenueService, rollup_service_1.GrowthRollupService, metrics_service_1.GrowthMetricsService, spend_service_1.GrowthSpendService, growth_maintenance_service_1.GrowthMaintenanceService, growth_config_service_1.GrowthConfigService, attribution_service_1.AttributionService, growth_events_service_1.GrowthEventsService, slug_service_1.SlugService, touch_rules_1.FraudSignalService, policy_1.AttributionPolicyResolver],
    })
], GrowthModule);
//# sourceMappingURL=growth.module.js.map