import { Global, Module } from '@nestjs/common';
import { AssistantAdminController } from './assistant-admin.controller';
import { AssistantLinkController } from './assistant-link.controller';
import { AssistantAudit } from './assistant.audit';
import { AssistantPolicyService } from './assistant.config';
import { ConfirmationStore } from './assistant.confirm';
import { AssistantCostService } from './assistant.cost.service';
import { AssistantEscalationService } from './assistant.escalation.service';
import { AssistantLinkService } from './assistant.link.service';
import { AssistantModelFactory } from './assistant.model.factory';
import { AssistantOrchestrator } from './assistant.orchestrator';
import { AssistantRateLimit } from './assistant.rate-limit';
import { AssistantRetentionJob } from './assistant.retention.job';
import { AssistantRouter } from './assistant.router';
import { AssistantSessionService } from './assistant.session.service';
import { AssistantTools } from './assistant.tools';

/**
 * GRW-P2-D WhatsApp AI booking assistant (mock model by default; no vendor call exists without a human finishing the go-live items). Global so `channels/whatsapp-booking.service.ts` can inject the router
 * without importing this folder's internals (the module-boundary rule: other contexts see only `assistant-public.ts`).
 */
@Global()
@Module({
  controllers: [AssistantAdminController, AssistantLinkController],
  providers: [AssistantAudit, AssistantPolicyService, ConfirmationStore, AssistantCostService, AssistantEscalationService, AssistantLinkService, AssistantModelFactory, AssistantOrchestrator, AssistantRateLimit, AssistantRetentionJob, AssistantRouter, AssistantSessionService, AssistantTools],
  exports: [AssistantRouter, AssistantModelFactory, AssistantOrchestrator, AssistantRetentionJob, AssistantEscalationService, AssistantCostService, AssistantPolicyService, AssistantLinkService],
})
export class AssistantModule {}
