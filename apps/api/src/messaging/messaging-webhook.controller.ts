import { Controller, HttpCode, Post, Param, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/auth';
import { ApiError } from '../common/errors';
import { MessagingHub } from './messaging.hub';

export class MessagingWebhookAckDto { @ApiProperty() applied!: number; @ApiProperty() ignored!: number }

/**
 * Provider delivery-status webhook, one URL per channel: POST /api/v1/messaging/webhooks/{sms|email|whatsapp}.
 * Body is the provider-neutral `{ events: [{ id, status, error? }] }` (a vendor mapping may translate its own format);
 * signed with <KIND>_WEBHOOK_SECRET (X-Webhook-Timestamp + X-Webhook-Signature). See Docs/PROVIDERS.md.
 */
@ApiTags('webhooks')
@Controller('messaging/webhooks')
export class MessagingWebhookController {
  constructor(private readonly hub: MessagingHub) {}

  @ApiOkResponse({ type: MessagingWebhookAckDto })
  @Public() @Post(':channel') @HttpCode(200)
  @ApiOperation({ summary: 'Provider delivery-status webhook (HMAC verified, idempotent, forward-only status)' })
  async status(@Param('channel') channel: string, @Req() req: { rawBody?: Buffer; headers: Record<string, unknown> }) {
    if (!req.rawBody) throw new ApiError(400, 'RAW_BODY_REQUIRED', 'raw body unavailable');
    return this.hub.handleStatusWebhook(channel, req.rawBody.toString('utf8'), req.headers);
  }
}
