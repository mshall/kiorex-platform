import { Global, Module } from '@nestjs/common';
import { LabClient } from './lab.client';
import { LabController } from './lab.controller';
import { LabService } from './lab.service';

@Global()
@Module({ controllers: [LabController], providers: [LabClient, LabService], exports: [LabService] })
export class LabModule {}
