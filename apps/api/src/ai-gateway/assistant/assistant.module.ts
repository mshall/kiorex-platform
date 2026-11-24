import { Module } from '@nestjs/common';
import { AssistantStubController } from './assistant-stub.controller';

/** GRW-P2-X1 stub. GRW-P2-D (W6, lane A3) fills this folder; nobody else edits `ai-gateway/*` and `channels/*` in W6. */
@Module({ controllers: [AssistantStubController] })
export class AssistantModule {}
