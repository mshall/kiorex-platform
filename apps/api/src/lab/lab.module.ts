import { Global, Module } from '@nestjs/common';
import { LabClient } from './lab.client';
import { LabController } from './lab.controller';
import { LabService } from './lab.service';
import { NurseLabClient } from './nurse-lab.client';
import { NurseLabRelayService } from './nurse-lab-relay.service';

@Global()
@Module({ controllers: [LabController], providers: [LabClient, LabService, NurseLabClient, NurseLabRelayService], exports: [LabService, NurseLabRelayService] })
export class LabModule {}
