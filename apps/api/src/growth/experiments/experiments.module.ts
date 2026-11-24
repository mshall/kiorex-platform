import { Global, Module } from '@nestjs/common';
import { ExperimentEvaluatorJob } from './experiment-evaluator.job';
import { ExperimentRollupService } from './experiment-rollup.service';
import { ExperimentService } from './experiment.service';
import { ExperimentsAdminController } from './experiments-admin.controller';
import { ExperimentsPublicController } from './experiments-public.controller';
import { ExposureService } from './exposure.service';
import { SsrVariantService } from './ssr-variant.service';

/** GRW-P3-A experimentation and A/B testing. Registered in app.module by the W7 schema owner. */
@Global()
@Module({
  controllers: [ExperimentsAdminController, ExperimentsPublicController],
  providers: [ExperimentService, ExposureService, SsrVariantService, ExperimentRollupService, ExperimentEvaluatorJob],
  exports: [ExperimentService, ExposureService, SsrVariantService, ExperimentEvaluatorJob],
})
export class ExperimentsModule {}
