import { Global, Module } from '@nestjs/common';
import { GrowthAdminController } from './admin/growth-admin.controller';
import { GrowthAdminService } from './admin/growth-admin.service';
import { GrowthConfigAdminController } from './admin/growth-config-admin.controller';
import { GROWTH_OVERVIEW_SOURCE, InternalOverviewSource } from './admin/growth-overview.source';
import { AttributionPolicyResolver } from './attribution/policy';
import { AttributionService } from './attribution/attribution.service';
import { GrowthConfigController } from './config/growth-config.controller';
import { GrowthConfigService } from './config/growth-config.service';
import { ConsentWiring } from './consent/consent-wiring';
import { VisitorConsentController } from './consent/visitor-consent.controller';
import { VisitorConsentService } from './consent/visitor-consent.service';
import { SubjectDeletedConsumer } from './erasure/subject-deleted.consumer';
import { EvidenceController } from './evidence/evidence.controller';
import { EvidenceService } from './evidence/evidence.service';
import { GrowthEventsController } from './events/growth-events.controller';
import { GrowthEventsService } from './events/growth-events.service';
import { GrowthAnalyticsOpsController, GrowthAnalyticsProviderController } from './analytics/growth-analytics.controller';
import { GrowthExportService } from './analytics/export.service';
import { GrowthMetricsService } from './analytics/metrics.service';
import { GrowthRevenueService } from './analytics/revenue.service';
import { GrowthRollupJob } from './analytics/rollup.job';
import { GrowthRollupService } from './analytics/rollup.service';
import { GrowthSpendService } from './analytics/spend.service';
import { BOOKING_GROWTH, GROWTH_FACTS, GROWTH_REVENUE, LINK_REGISTRY } from './growth-ports-public';
import { BookingGrowthService } from './booking/booking-growth.service';
import { LinkRegistryService } from './links/link-registry.service';
import { FraudSignalService } from './fraud/touch-rules';
import { GrowthLimiter } from './growth-limiter';
import { GrowthMaintenanceService } from './maintenance/growth-maintenance.service';
import { RetentionJob } from './retention/retention.job';
import { SlugService } from './slugs/slug.service';
import { TouchController } from './touch/touch.controller';
import { TouchService } from './touch/touch.service';

/**
 * Growth core (GRW-P1-B attribution and GRW-P1-I consent wiring). Depends on PrismaModule, OutboxModule, ControlPlaneModule and PatientModule (all global)
 * and reaches them only through their *-public façades. Maker-checker config controllers (create, approve, rollback) are package K.
 */
@Global() // callers (booking, webhooks, patient, channels) inject the growth PORTS by token without importing this module (no load-order cycle)
@Module({
  controllers: [TouchController, GrowthEventsController, VisitorConsentController, EvidenceController, GrowthConfigController, GrowthConfigAdminController, GrowthAdminController, GrowthAnalyticsOpsController, GrowthAnalyticsProviderController],
  providers: [
    GrowthMaintenanceService, GrowthConfigService, AttributionPolicyResolver, GrowthLimiter, FraudSignalService, TouchService, GrowthEventsService, VisitorConsentService,
    GrowthAdminService, InternalOverviewSource, { provide: GROWTH_OVERVIEW_SOURCE, useExisting: InternalOverviewSource },
    AttributionService, EvidenceService, LinkRegistryService, BookingGrowthService, GrowthRevenueService, GrowthRollupService, GrowthRollupJob, GrowthMetricsService, GrowthExportService, GrowthSpendService, SlugService,
    { provide: BOOKING_GROWTH, useExisting: BookingGrowthService }, { provide: GROWTH_REVENUE, useExisting: GrowthRevenueService }, { provide: LINK_REGISTRY, useExisting: LinkRegistryService }, { provide: GROWTH_FACTS, useExisting: GrowthEventsService }, RetentionJob, SubjectDeletedConsumer, ConsentWiring,
  ],
  exports: [GROWTH_FACTS, BOOKING_GROWTH, GROWTH_REVENUE, LINK_REGISTRY, LinkRegistryService, BookingGrowthService, GrowthRevenueService, GrowthRollupService, GrowthMetricsService, GrowthSpendService, GrowthMaintenanceService, GrowthConfigService, AttributionService, GrowthEventsService, SlugService, FraudSignalService, AttributionPolicyResolver],
})
export class GrowthModule {}
