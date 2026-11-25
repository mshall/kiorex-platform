import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { AuthUser, CurrentUser, OpsOnly, SuperAdminOnly } from '../common/auth';
import { MessagingOpsService } from './messaging-ops.service';

const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;
export class ChannelTestSendBody { @IsString() @MinLength(3) @MaxLength(300) to!: string }
export class SubmitTemplatesBody {
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) keys?: string[];
  @IsOptional() @IsBoolean() confirm?: boolean;
}
export class EmailDomainBody { @IsString() @Matches(/^[a-z0-9.-]{3,253}$/i) domain!: string; @IsOptional() @IsArray() @ArrayMaxSize(5) @IsString({ each: true }) dkimTokens?: string[] }

/**
 * Ops console for the real messaging channels (MSG-REAL). Read-only views for ops; every action that touches a vendor or reveals a registration value is super admin only and audited.
 * Test send: only to an allow-listed internal address. Connection check: read-only vendor calls. Nothing here accepts, returns or logs a secret value.
 */
@ApiTags('ops')
@Controller('admin/messaging/channels')
export class MessagingOpsController {
  constructor(private readonly ops: MessagingOpsService) {}

  @OpsOnly() @Get() @ApiOperation({ summary: 'MSG-REAL channel status: mode, providers, config problems (names only), secretRef presence, webhook URLs, WhatsApp quality and tier, failover order, quiet hours' }) @ApiOkResponse(OBJ)
  status(@Query('market') market?: string) { return this.ops.status(market && /^[A-Z]{2}$/.test(market) ? market : 'EG'); }

  @OpsOnly() @Get('whatsapp/templates') @ApiOperation({ summary: 'MSG-REAL WhatsApp template registry with Meta name, language, category and review status (format=csv for the approval checklist)' }) @ApiOkResponse({ schema: { type: 'array', items: { type: 'object', additionalProperties: true } } })
  templates(@Query('format') format?: string) { return this.ops.templates(format === 'csv' ? 'csv' : 'json'); }

  @OpsOnly() @Get('whatsapp/templates/export') @ApiOperation({ summary: 'MSG-REAL submit-for-approval export: one Graph message_templates payload per template and language' }) @ApiOkResponse({ schema: { type: 'array', items: { type: 'object', additionalProperties: true } } })
  exportTemplates() { return this.ops.exportTemplates(); }

  @OpsOnly() @Get(':channel/webhook') @ApiOperation({ summary: 'MSG-REAL the callback URL and verify token to register in the Meta / SES / SMS console (the secret part is masked)' }) @ApiOkResponse(OBJ)
  webhook(@Param('channel') channel: string, @CurrentUser() u: AuthUser) { return this.ops.webhookInfo(channel, u.sub, false); }

  @SuperAdminOnly() @Post(':channel/webhook/reveal') @HttpCode(200) @ApiOperation({ summary: 'MSG-REAL reveal the verify token / SNS subscription URL for registration (super admin, audited)' }) @ApiOkResponse(OBJ)
  reveal(@Param('channel') channel: string, @CurrentUser() u: AuthUser) { return this.ops.webhookInfo(channel, u.sub, true); }

  @SuperAdminOnly() @Post(':channel/test-send') @HttpCode(200) @ApiOperation({ summary: 'MSG-REAL test send to an ALLOW-LISTED internal number / e-mail / device (mock mode: dev inbox only). 5 per hour' }) @ApiOkResponse(OBJ)
  testSend(@Param('channel') channel: string, @Body() b: ChannelTestSendBody, @CurrentUser() u: AuthUser) { return this.ops.testSend(channel, b.to, u.sub); }

  @SuperAdminOnly() @Post(':channel/connection-check') @HttpCode(200) @ApiOperation({ summary: 'MSG-REAL connection check: read-only vendor calls (account, profile, identity, token); mock mode makes no call' }) @ApiOkResponse(OBJ)
  connection(@Param('channel') channel: string, @CurrentUser() u: AuthUser) { return this.ops.connectionCheck(channel, u.sub); }

  @SuperAdminOnly() @Post('email/domain-check') @HttpCode(200) @ApiOperation({ summary: 'MSG-REAL SPF / DKIM / DMARC check of the sending domain against DNS' }) @ApiOkResponse(OBJ)
  domain(@Body() b: EmailDomainBody) { return this.ops.emailDomainCheck(b.domain, b.dkimTokens ?? []); }

  @SuperAdminOnly() @Post('whatsapp/templates/sync') @HttpCode(200) @ApiOperation({ summary: 'MSG-REAL pull template statuses and ids from Meta (read only)' }) @ApiOkResponse(OBJ)
  sync(@CurrentUser() u: AuthUser) { return this.ops.syncTemplates(u.sub); }

  @SuperAdminOnly() @Post('whatsapp/templates/submit') @HttpCode(200) @ApiOperation({ summary: 'MSG-REAL submit templates to Meta for approval (dry run unless confirm=true)' }) @ApiOkResponse(OBJ)
  submit(@Body() b: SubmitTemplatesBody, @CurrentUser() u: AuthUser) { return this.ops.submitTemplates(u.sub, { keys: b.keys, confirm: b.confirm === true }); }
}
