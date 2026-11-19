import { Global, Module } from '@nestjs/common';
import { PharmacyClient } from './pharmacy.client';
import { PharmacyController } from './pharmacy.controller';
import { PharmacyService } from './pharmacy.service';

@Global()
@Module({ controllers: [PharmacyController], providers: [PharmacyClient, PharmacyService], exports: [PharmacyService] })
export class PharmacyModule {}
