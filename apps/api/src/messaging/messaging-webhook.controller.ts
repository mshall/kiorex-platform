import { Controller, Get, HttpCode, Post, Param, Query, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/auth';
import { ApiError } from '../common/errors';
import { MessagingHub } from './messaging.hub';
import { providerEnv } from '../common/providers/env';
import { messagingKindOf, messagingMapping } from '../common/providers/real-adapters';

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

  /** Vendor subscription handshake (Meta: hub.mode / hub.verify_token / hub.challenge -> echo the challenge). */
  @Public() @Get(':channel')
  @ApiOperation({ summary: 'Provider webhook verification handshake (Meta WhatsApp hub.challenge)' })
  @ApiOkResponse({ description: 'The hub.challenge echoed back as plain text (real mode only; otherwise 403 INVALID_VERIFY_TOKEN)', content: { 'text/plain': { schema: { type: 'string', example: '1158201444' } } } })
  handshake(@Param('channel') channel: string, @Query() q: Record<string, unknown>) {
    const kind = messagingKindOf(channel.toUpperCase());
    const challenge = kind && providerEnv(kind).mode === 'real' ? messagingMapping(kind).verifyChallenge?.(q, process.env.WHATSAPP_VERIFY_TOKEN ?? '') : null;
    if (challenge === null || challenge === undefined) throw new ApiError(403, 'INVALID_VERIFY_TOKEN', 'Verification rejected');
    return challenge;
  }

  @ApiOkResponse({ type: MessagingWebhookAckDto })
  @Public() @Post(':channel') @HttpCode(200)
  @ApiOperation({ summary: 'Provider delivery-status webhook (HMAC verified, idempotent, forward-only status)' })
  async status(@Param('channel') channel: string, @Req() req: { rawBody?: Buffer; headers: Record<string, unknown> }) {
    if (!req.rawBody) throw new ApiError(400, 'RAW_BODY_REQUIRED', 'raw body unavailable');
    return this.hub.handleStatusWebhook(channel, req.rawBody.toString('utf8'), req.headers);
  }
}
