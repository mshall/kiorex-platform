import { Module } from '@nestjs/common';
import { CohortDataService } from './cohort-data.service';
import { CohortRollupJob } from './cohort-rollup.job';
import { CohortService } from './cohort.service';
import { CohortsController } from './cohorts.controller';

/** GRW-P3-C cohorts and LTV. Registered in app.module; depends on the global Prisma, ControlPlane and Growth (config) modules only. */
@Module({ controllers: [CohortsController], providers: [CohortDataService, CohortService, CohortRollupJob], exports: [CohortService] })
export class CohortsModule {}
