import { Module } from '@nestjs/common';
import { KiorlyMarketsController } from './kiorly-markets.controller';
import { KiorlyMarketsService } from './kiorly-markets.service';

@Module({ controllers: [KiorlyMarketsController], providers: [KiorlyMarketsService] })
export class KiorlyMarketsModule {}
