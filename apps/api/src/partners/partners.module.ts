import { Global, Module } from '@nestjs/common';
import { PartnersController } from './partners.controller';
import { PartnerRegistry } from './partners.service';
import { PartnerRouting } from './partner-routing.service';

@Global()
@Module({ controllers: [PartnersController], providers: [PartnerRegistry, PartnerRouting], exports: [PartnerRegistry, PartnerRouting] })
export class PartnersModule {}
