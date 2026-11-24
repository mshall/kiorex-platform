import { Module } from '@nestjs/common';
import { AttributionModelsController } from './attribution-models.controller';
import { ModelDataService } from './model-data.service';
import { ModelReportService } from './model-report.service';
import { ModelRollupJob } from './model-rollup.job';

/** GRW-P3-B reporting attribution models. Registered in app.module; depends on the global Prisma and ControlPlane modules only. */
@Module({ controllers: [AttributionModelsController], providers: [ModelDataService, ModelReportService, ModelRollupJob], exports: [ModelReportService] })
export class AttributionModelsModule {}
