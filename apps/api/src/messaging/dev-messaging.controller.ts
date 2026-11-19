import { Body, Controller, Delete, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Public } from '../common/auth';
import { cfg } from '../common/config';
import { notFound } from '../common/errors';
import { MessagingHub } from './messaging.hub';
import { MSG_CHANNELS, MsgChannel } from './messaging.types';

export class DevInboundBody {
  @IsIn([...MSG_CHANNELS]) channel!: MsgChannel;
  /** Sender address: E.164 phone for WHATSAPP/SMS. */
  @IsString() @MaxLength(64) from!: string;
  @IsOptional() @IsString() @MaxLength(1000) text?: string;
  @IsOptional() @IsString() @MaxLength(200) buttonPayload?: string;
}

/**
 * DEV INBOX (MESSAGING_MODE=mock, NODE_ENV != production only; 404 otherwise). Simulates patient replies and exposes the
 * provider-side outbox so UI/QA can drive flows without Meta/SMS/email providers.
 */
@ApiTags('dev')
@Public()
@Controller('dev/messaging')
export class DevMessagingController {
  constructor(private readonly hub: MessagingHub) {}
  private guard() { if (!cfg().devRoutesEnabled) throw notFound('NOT_FOUND', 'Not found'); }

  @Post('inbound') @HttpCode(200) @ApiOperation({ summary: 'DEV: simulate a patient reply on a channel (drives the WhatsApp booking state machine)' })
  async inbound(@Body() b: DevInboundBody) {
    this.guard();
    const row = await this.hub.receive({ channel: b.channel, from: b.from, text: b.text, buttonPayload: b.buttonPayload });
    const replies = await this.hub.list({ channel: b.channel, direction: 'OUT', to: b.from, since: row.createdAt, limit: 20 });
    return { inboundId: row.id, replies: replies.reverse() };
  }

  @Get('outbox') @ApiOperation({ summary: 'DEV: messages the platform "sent" (all channels), newest first' })
  async outbox(@Query('channel') channel?: string, @Query('to') to?: string, @Query('direction') direction?: string, @Query('limit') limit?: string) {
    this.guard();
    return { items: await this.hub.list({ channel, to, direction: direction ?? 'OUT', limit: limit ? Number(limit) : 50 }) };
  }

  @Post('delivery-tick') @HttpCode(200) @ApiOperation({ summary: 'DEV: advance SENT -> DELIVERED for all mock messages' })
  async tick() { this.guard(); return this.hub.simulateDeliveries(); }

  @Delete('outbox') @ApiOperation({ summary: 'DEV: clear the dev inbox' })
  async clear(@Query('channel') channel?: string) { this.guard(); return { deleted: (await this.hub.clear(channel)).count }; }
}
