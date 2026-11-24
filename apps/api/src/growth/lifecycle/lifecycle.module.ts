import { Module } from '@nestjs/common';
import { LifecycleStubController } from './lifecycle-stub.controller';

/** GRW-P2-X1 stub. GRW-P2-E (W6) fills this folder. */
@Module({ controllers: [LifecycleStubController] })
export class LifecycleModule {}
