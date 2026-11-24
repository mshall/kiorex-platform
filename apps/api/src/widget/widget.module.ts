import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { EmbedHandlers } from './embed.controller';
import { WidgetAssets } from './widget-assets';
import { WidgetAuditService } from './widget-audit.service';
import { WidgetLimiter } from './widget-limiter';
import { WidgetMounter } from './widget-mounter';
import { WidgetPolicyService } from './widget-policy.service';
import { WidgetRegistrationService } from './widget-registration.service';
import { WidgetRequestGuard } from './widget.guard';
import { WidgetController } from './widget.controller';

/**
 * Booking widget host (GRW-P1-G, ADR-044): the embed document and SDK served from the dedicated widget host (a role of the API image), the widget session and config API,
 * the registration projection of the Clinic allow-list, per-request origin enforcement and rate limits. Depends on the global Prisma, ControlPlane, Catalog and Growth modules
 * through their public façades. The booking calls themselves are the existing, unchanged booking endpoints.
 */
@Module({
  controllers: [WidgetController],
  providers: [WidgetLimiter, WidgetAuditService, WidgetRegistrationService, WidgetPolicyService, WidgetAssets, EmbedHandlers, WidgetMounter, { provide: APP_GUARD, useClass: WidgetRequestGuard }],
  exports: [WidgetRegistrationService],
})
export class WidgetModule {}
