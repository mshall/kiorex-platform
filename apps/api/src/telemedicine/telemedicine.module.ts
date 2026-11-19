import { Module } from '@nestjs/common';
import { TelemedicineController } from './telemedicine.controller';
import { TelemedicineService } from './telemedicine.service';
import { VIDEO, videoAdapter } from './video';

@Module({ controllers: [TelemedicineController], providers: [TelemedicineService, { provide: VIDEO, useFactory: videoAdapter }], exports: [TelemedicineService] })
export class TelemedicineModule {}
