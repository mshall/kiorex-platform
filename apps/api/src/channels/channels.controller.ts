import { Body, Controller, Get, Headers, HttpCode, Post, Query, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { createHmac } from 'node:crypto';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Public } from '../common/auth';
import { cfg } from '../common/config';
import { safeEqual } from '../common/crypto';
import { ApiError, notFound } from '../common/errors';
import { RequiresFlag } from '../control-plane/control-plane-public';
import { MessagingHub } from '../messaging/messaging-public';
import { WhatsAppBookingService } from './whatsapp-booking.service';

export class WhatsappInboundBody {
  @ApiProperty({ description: 'Sender E.164 phone, e.g. +201000000001' }) @IsString() @MaxLength(32) from!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) text?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) buttonPayload?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) providerMessageId?: string;
}
export class WhatsappInboundResultDto { @ApiProperty() inboundId!: string }
export class ConversationDto {
  @ApiProperty() phone!: string;
  @ApiProperty({ enum: ['IDLE', 'CHOOSE_SPECIALTY', 'CHOOSE_DOCTOR', 'CHOOSE_SLOT', 'OFFER_WAITLIST', 'CONFIRM'] }) state!: string;
  @ApiProperty() locale!: string;
}

@ApiTags('channels')
@Controller()
export class ChannelsController {
  constructor(private readonly hub: MessagingHub, private readonly wa: WhatsAppBookingService) {}

  /**
   * Provider-agnostic inbound for the WhatsApp channel. The real Meta Cloud API payload mapping (and its X-Hub-Signature-256
   * scheme) is the go-live pass (NEEDS_HUMAN #5); this normalised form is signed with WHATSAPP_WEBHOOK_SECRET:
   * `X-Kiorex-Signature: sha256=hex(HMAC(secret, rawBody))`. Flag kiorex.whatsapp_booking OFF => 403 FEATURE_DISABLED.
   */
  @Public() @Post('channels/whatsapp/booking-intents') @HttpCode(200) @RequiresFlag('kiorex.whatsapp_booking')
  @ApiOperation({ summary: 'KXM-BK-11 WhatsApp inbound (normalised, HMAC-signed). Server-to-server; the booking conversation runs from here' })
  @ApiOkResponse({ type: WhatsappInboundResultDto })
  async inbound(@Req() req: { rawBody?: Buffer }, @Body() b: WhatsappInboundBody, @Headers('x-kiorex-signature') sig?: string) {
    const raw = req.rawBody?.toString('utf8') ?? '';
    const expect = 'sha256=' + createHmac('sha256', cfg().whatsappWebhookSecret).update(raw).digest('hex');
    if (!sig || !safeEqual(sig, expect)) throw new ApiError(401, 'INVALID_SIGNATURE', 'Signature rejected');
    const row = await this.hub.receive({ channel: 'WHATSAPP', from: b.from, text: b.text, buttonPayload: b.buttonPayload, providerRef: b.providerMessageId });
    return { inboundId: row.id };
  }

  @Public() @Get('dev/channels/whatsapp/conversation') @ApiOperation({ summary: 'DEV: current WhatsApp conversation state for a phone' })
  @ApiOkResponse({ type: ConversationDto })
  async conversation(@Query('phone') phone: string) {
    if (!cfg().devRoutesEnabled) throw notFound('NOT_FOUND', 'Not found');
    const c = await this.wa.conversation(phone);
    if (!c) throw notFound('CONVERSATION_NOT_FOUND', 'No conversation');
    return { phone: c.phone, state: c.state, locale: c.locale };
  }
}
