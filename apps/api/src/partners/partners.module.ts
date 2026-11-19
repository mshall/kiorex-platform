import { Global, Module } from '@nestjs/common';
import { PartnersController } from './partners.controller';
import { PartnerRegistry } from './partners.service';

@Global()
@Module({ controllers: [PartnersController], providers: [PartnerRegistry], exports: [PartnerRegistry] })
export class PartnersModule {}
