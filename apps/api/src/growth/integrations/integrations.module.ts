import { Module } from '@nestjs/common';
import { ChannelPerformanceService } from '../analytics/channel-performance.service';
import { ExternalMetricsService } from '../analytics/external-metrics.service';
import { IntegrationService } from './integration.service';
import { IntegrationsAdminController } from './integrations-admin.controller';
import { IntegrationPullJob } from './jobs/pull.job';
import { PushConversionsJob } from './jobs/push-conversions.job';

/** GRW-P2-F: read-only marketing integrations (mock first), the PHI-safe conversion gate and the channel performance analytics. */
@Module({
  controllers: [IntegrationsAdminController],
  providers: [IntegrationService, IntegrationPullJob, PushConversionsJob, ExternalMetricsService, ChannelPerformanceService],
  exports: [IntegrationService, ChannelPerformanceService],
})
export class IntegrationsModule {}
