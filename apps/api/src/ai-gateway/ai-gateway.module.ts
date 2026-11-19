import { Global, Module } from '@nestjs/common';
import { AiGatewayController } from './ai-gateway.controller';
import { AiGatewayService } from './ai-gateway.service';

@Global()
@Module({ controllers: [AiGatewayController], providers: [AiGatewayService], exports: [AiGatewayService] })
export class AiGatewayModule {}
