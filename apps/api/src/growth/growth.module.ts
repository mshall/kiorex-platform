import { Module } from '@nestjs/common';
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
@Module({
  controllers: [TouchController, GrowthEventsController, VisitorConsentController, EvidenceController, GrowthConfigController],
  providers: [
    GrowthMaintenanceService, GrowthConfigService, AttributionPolicyResolver, GrowthLimiter, FraudSignalService, TouchService, GrowthEventsService, VisitorConsentService,
    AttributionService, EvidenceService, SlugService, RetentionJob, SubjectDeletedConsumer, ConsentWiring,
  ],
  exports: [GrowthMaintenanceService, GrowthConfigService, AttributionService, GrowthEventsService, SlugService, FraudSignalService, AttributionPolicyResolver],
})
export class GrowthModule {}
