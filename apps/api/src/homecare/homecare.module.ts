import { Global, Module } from '@nestjs/common';
import { CarePlanService } from './care-plan.service';
import { FamilyShareService } from './family-share.service';
import { HomeCareController, SafetyConsoleController } from './homecare.controller';
import { SafetyService } from './safety.service';

@Global()
@Module({ controllers: [HomeCareController, SafetyConsoleController], providers: [FamilyShareService, SafetyService, CarePlanService], exports: [FamilyShareService, SafetyService, CarePlanService] })
export class HomeCareModule {}
