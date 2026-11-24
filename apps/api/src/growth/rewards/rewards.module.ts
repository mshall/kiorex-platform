import { Module } from '@nestjs/common';
import { RewardsStubController } from './rewards-stub.controller';

/** GRW-P2-X1 stub. GRW-P2-B2 (W6) fills this folder. */
@Module({ controllers: [RewardsStubController] })
export class RewardsModule {}
