import { Module } from '@nestjs/common';
import { IntegrationsStubController } from './integrations-stub.controller';

/** GRW-P2-X1 stub. GRW-P2-F (W6) fills this folder. */
@Module({ controllers: [IntegrationsStubController] })
export class IntegrationsModule {}
