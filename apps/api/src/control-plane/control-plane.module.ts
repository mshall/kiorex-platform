import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ControlPlaneController } from './control-plane.controller';
import { FlagGuard } from './flag.guard';
import { FlagsService } from './flags.service';
import { ProductKeyGuard } from './product-key.guard';

@Global()
@Module({ controllers: [ControlPlaneController], providers: [FlagsService, ProductKeyGuard, { provide: APP_GUARD, useClass: FlagGuard }], exports: [FlagsService] })
export class ControlPlaneModule {}
