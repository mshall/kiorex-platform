import { Module } from '@nestjs/common';
import { ReferralStubController } from './referral-stub.controller';

/** GRW-P2-X1 stub. GRW-P2-B1 (W6) fills this folder. */
@Module({ controllers: [ReferralStubController] })
export class ReferralModule {}
