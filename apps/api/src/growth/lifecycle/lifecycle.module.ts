import { Module } from '@nestjs/common';
import { JourneyRunnerService } from './journey-runner.service';
import { LifecycleAdminController } from './lifecycle-admin.controller';
import { LifecyclePolicyService } from './lifecycle-policy.service';
import { LifecyclePreferencesController } from './lifecycle-preferences.controller';
import { LifecycleStateService } from './lifecycle-state.service';
import { LifecycleTriggersService } from './lifecycle-triggers.service';
import { LifecycleJob } from './lifecycle.job';
import { LifecycleService } from './lifecycle.service';
import { SendGateService } from './send-gate.service';

/** GRW-P2-E patient lifecycle CRM: stages, eight journeys, the send gate, suppression admin, preference additions. Depends on the global Prisma, Growth (config), ControlPlane (flags), Patient and Engagement modules. */
@Module({
  controllers: [LifecycleAdminController, LifecyclePreferencesController],
  providers: [LifecyclePolicyService, LifecycleStateService, SendGateService, JourneyRunnerService, LifecycleTriggersService, LifecycleJob, LifecycleService],
  exports: [LifecycleService, LifecycleStateService, LifecyclePolicyService, JourneyRunnerService, SendGateService],
})
export class LifecycleModule {}
