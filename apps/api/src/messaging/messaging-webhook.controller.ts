import { Controller, Get, HttpCode, Post, Param, Query, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/auth';
import { ApiError } from '../common/errors';
import { MessagingHub } from './messaging.hub';
import { PrismaService } from '../prisma/prisma.service';
import { providerEnv } from '../common/providers/env';
import { messagingKindOf, messagingMapping } from '../common/providers/real-adapters';
import { verifyUnsubscribeToken } from './unsubscribe';

export class MessagingWebhookAckDto { @ApiProperty() applied!: number; @ApiProperty() ignored!: number; @ApiProperty({ required: false }) suppressed?: number }
export class UnsubscribeResultDto { @ApiProperty() unsubscribed!: boolean }

/**
 * Provider delivery-status webhook, one URL per channel: POST /api/v1/messaging/webhooks/{sms|email|whatsapp} (and `/{channel}/{provider}` for a secondary provider).
 * Body is the provider-neutral `{ events: [{ id, status, error? }] }` or the vendor's own format (Meta, SES via SNS, Twilio, the configured SMS aggregator);
 * signed per vendor (see Docs/INTEGRATION_RUNBOOK_MESSAGING.md). Always 200 after a valid signature so the vendor does not redeliver forever.
 */
@ApiTags('webhooks')
@Controller('messaging/webhooks')
export class MessagingWebhookController {
  constructor(private readonly hub: MessagingHub) {}

  /** Vendor subscription handshake (Meta: hub.mode / hub.verify_token / hub.challenge -> echo the challenge). */
  @Public() @Get(':channel')
  @ApiOperation({ summary: 'Provider webhook verification handshake (Meta WhatsApp hub.challenge)' })
  @ApiOkResponse({ description: 'The hub.challenge echoed back as plain text (real mode only; otherwise 403 INVALID_VERIFY_TOKEN)', content: { 'text/plain': { schema: { type: 'string', example: '1158201444' } } } })
  async handshake(@Param('channel') channel: string, @Query() q: Record<string, unknown>) {
    const kind = messagingKindOf(channel.toUpperCase());
    const challenge = kind && providerEnv(kind).mode === 'real' ? messagingMapping(kind).verifyChallenge?.(q, await this.hub.whatsappVerifyToken()) : null;
    if (challenge === null || challenge === undefined) throw new ApiError(403, 'INVALID_VERIFY_TOKEN', 'Verification rejected');
    return challenge;
  }

  @ApiOkResponse({ type: MessagingWebhookAckDto })
  @Public() @Post(':channel') @HttpCode(200)
  @ApiOperation({ summary: 'Provider delivery-status webhook (HMAC verified, idempotent, forward-only status)' })
  async status(@Param('channel') channel: string, @Query() q: Record<string, unknown>, @Req() req: { rawBody?: Buffer; headers: Record<string, unknown> }) {
    if (!req.rawBody) throw new ApiError(400, 'RAW_BODY_REQUIRED', 'raw body unavailable');
    return this.hub.handleStatusWebhook(channel, req.rawBody.toString('utf8'), req.headers, q);
  }

  @ApiOkResponse({ type: MessagingWebhookAckDto })
  @Public() @Post(':channel/:provider') @HttpCode(200)
  @ApiOperation({ summary: 'Delivery-status webhook of a SECONDARY provider of the channel (failover chain), verified with that provider\'s own secret' })
  async statusFor(@Param('channel') channel: string, @Param('provider') provider: string, @Query() q: Record<string, unknown>, @Req() req: { rawBody?: Buffer; headers: Record<string, unknown> }) {
    if (!req.rawBody) throw new ApiError(400, 'RAW_BODY_REQUIRED', 'raw body unavailable');
    return this.hub.handleStatusWebhook(channel, req.rawBody.toString('utf8'), req.headers, q, provider);
  }
}

/** RFC 8058 one-click unsubscribe target of the List-Unsubscribe header on marketing e-mail. GET never changes anything (link scanners prefetch); POST unsubscribes. */
@ApiTags('webhooks')
@Controller('messaging/unsubscribe')
export class UnsubscribeController {
  constructor(private readonly hub: MessagingHub, private readonly prisma: PrismaService) {}

  @Public() @Get(':token') @ApiOperation({ summary: 'Check an unsubscribe link (does not unsubscribe; POST does)' }) @ApiOkResponse({ type: UnsubscribeResultDto })
  check(@Param('token') token: string) {
    if (!verifyUnsubscribeToken(token)) throw new ApiError(404, 'NOT_FOUND', 'Not found');
    return { unsubscribed: false };
  }

  @Public() @Post(':token') @HttpCode(200) @ApiOperation({ summary: 'One-click unsubscribe from marketing e-mail (RFC 8058): adds the address to the suppression list' }) @ApiOkResponse({ type: UnsubscribeResultDto })
  async unsubscribe(@Param('token') token: string) {
    const c = verifyUnsubscribeToken(token);
    if (!c) throw new ApiError(404, 'NOT_FOUND', 'Not found');
    await this.hub.suppressHash(c.ah, 'EMAIL', 'STOP', 'one-click-unsubscribe', c.market);
    return { unsubscribed: true };
  }
}
