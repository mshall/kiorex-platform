import { Global, Module } from '@nestjs/common';
import { AppLinksController } from './app-links.controller';
import { BootstrapController } from './bootstrap.controller';
import { BootstrapService } from './bootstrap.service';
import { LinkLandingController } from './link-landing.controller';
import { MarketController } from './market.controller';
import { MarketService } from './market.service';

@Global()
@Module({ controllers: [MarketController, BootstrapController, AppLinksController, LinkLandingController], providers: [MarketService, BootstrapService], exports: [MarketService] })
export class MarketModule {}
