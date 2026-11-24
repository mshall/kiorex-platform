import { Module } from '@nestjs/common';
import { LifecycleModule } from '../lifecycle/lifecycle-public';
import { AutomationAdminController } from './automation-admin.controller';
import { AutomationHooksService } from './automation-hooks.service';
import { AutomationTriggersService } from './automation-triggers.service';
import { AutomationJob } from './automation.job';
import { JourneyDefinitionService } from './journey-definition.service';

/** GRW-P3-E marketing automation: the constrained journey builder (definitions, validator, compiler, dry run) on top of the P2-E runner. Needs the global Prisma, ControlPlane and Experiments modules. */
@Module({
  imports: [LifecycleModule],
  controllers: [AutomationAdminController],
  providers: [JourneyDefinitionService, AutomationHooksService, AutomationTriggersService, AutomationJob],
  exports: [JourneyDefinitionService, AutomationTriggersService, AutomationJob],
})
export class AutomationModule {}
