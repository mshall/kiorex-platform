import { Module } from '@nestjs/common';
import { MarketOnboardingController } from './market-onboarding.controller';
import { MarketOnboardingService } from './market-onboarding.service';

/** GRW-P3-G market onboarding wizard. Registered in app.module; depends on the global Prisma, ControlPlane, Market and Growth (config) modules. */
@Module({ controllers: [MarketOnboardingController], providers: [MarketOnboardingService], exports: [MarketOnboardingService] })
export class MarketOnboardingModule {}
