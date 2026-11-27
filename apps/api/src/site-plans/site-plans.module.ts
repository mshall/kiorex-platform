import { Module } from '@nestjs/common';
import { SitePlansAdminController, SitePlansPublicController } from './site-plans.controller';
import { SitePlansService } from './site-plans.service';

@Module({ controllers: [SitePlansPublicController, SitePlansAdminController], providers: [SitePlansService] })
export class SitePlansModule {}
