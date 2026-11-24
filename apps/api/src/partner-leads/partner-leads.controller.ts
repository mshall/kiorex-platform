import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { IsArray, IsBoolean } from 'class-validator';
import { CurrentUser, OpsOnly, Public, type AuthUser } from '../common/auth';
import { ApiError, forbidden } from '../common/errors';
import { LeadAlertsService } from './lead-alerts.service';
import { PartnerLeadsService } from './partner-leads.service';

const MAX_BODY = 4096;
const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;
const ARR = { schema: { type: 'array', items: { type: 'object', additionalProperties: true } } } as const;
class LeadPatchBody { @IsOptional() @IsString() @MaxLength(20) status?: string; @IsOptional() @IsString() @MaxLength(80) assignee?: string | null }
class AlertConfigBody { @IsOptional() @IsBoolean() enabled?: boolean; @IsOptional() @IsArray() @IsString({ each: true }) channels?: string[] }
class AlertRecipientBody { @IsOptional() @IsBoolean() leadAlerts?: boolean; @IsOptional() @IsArray() @IsString({ each: true }) channels?: string[] }
class LeadNoteBody { @IsString() @MaxLength(1000) text!: string }

/** Low-privilege signed endpoints for partner products that have no enrolment code yet: a lead ("Talk to us") and a privacy-safe funnel marker. No PHI, uniform 401, rate limited. */
@ApiTags('partner-leads')
@Controller('partners/v1')
export class PartnerLeadsPublicController {
  constructor(private readonly svc: PartnerLeadsService) {}
  private raw(req: { rawBody?: Buffer }) {
    if (!req.rawBody) throw new ApiError(400, 'RAW_BODY_REQUIRED', 'raw body unavailable');
    if (req.rawBody.length > MAX_BODY) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
    return req.rawBody.toString('utf8');
  }
  @Public() @Post('leads') @HttpCode(200) @ApiOkResponse(OBJ) @ApiOperation({ summary: 'Submit a "Talk to us" lead (HMAC-signed with ts.rawBody; idempotent per (kind, orgRef))' })
  lead(@Req() req: { rawBody?: Buffer; ip?: string }, @Headers('x-kiorly-signature') sig?: string, @Headers('x-kiorly-timestamp') ts?: string) { return this.svc.submitLead(this.raw(req), { signature: sig, timestamp: ts, ip: req.ip }); }
  @Public() @Post('funnel') @HttpCode(200) @ApiOkResponse(OBJ) @ApiOperation({ summary: 'Record a privacy-safe funnel marker (kind + org id + stage), signed like a lead' })
  funnel(@Req() req: { rawBody?: Buffer; ip?: string }, @Headers('x-kiorly-signature') sig?: string, @Headers('x-kiorly-timestamp') ts?: string) { return this.svc.markFunnel(this.raw(req), { signature: sig, timestamp: ts, ip: req.ip }); }
}

/** Ops console: Partner leads and the onboarding funnel. */
@ApiTags('ops-onboarding')
@OpsOnly()
@Controller('admin/partner-leads')
export class PartnerLeadsOpsController {
  constructor(private readonly svc: PartnerLeadsService, private readonly alerts: LeadAlertsService) {}
  @Get() @ApiOperation({ summary: 'OP: partner leads (newest first), status derived from the onboarding request' }) @ApiOkResponse(ARR) async list(@CurrentUser() u: AuthUser, @Query('status') status?: string, @Query('kind') kind?: string) { await this.alerts.touch(u).catch(() => undefined); return this.svc.list({ status, kind }); }
  @Get('funnel') @ApiOperation({ summary: 'OP: interested -> started -> submitted -> live (distinct organisations) with conversion' }) @ApiOkResponse(OBJ) funnel(@Query('days') days?: string, @Query('kind') kind?: string) { return this.svc.funnel(Number(days ?? 30), kind); }
  @Get('unread') @ApiOperation({ summary: 'OP: new leads this team member has not seen yet (nav badge)' }) @ApiOkResponse(OBJ) async unread(@CurrentUser() u: AuthUser) { await this.alerts.touch(u).catch(() => undefined); return this.alerts.unread(u.sub); }
  @Post('seen') @HttpCode(200) @ApiOperation({ summary: 'OP: mark all current leads as seen (clears the badge)' }) @ApiOkResponse(OBJ) seen(@CurrentUser() u: AuthUser) { return this.alerts.markSeen(u); }
  @Get('alerts') @ApiOperation({ summary: 'OP: lead alert settings (switch, channels) and the team members who get them' }) @ApiOkResponse(OBJ) async alertSettings(@CurrentUser() u: AuthUser) { await this.alerts.touch(u, true).catch(() => undefined); return this.alerts.settings(); }
  @Patch('alerts') @ApiOperation({ summary: 'OP (super admin): switch lead alerts on/off and choose the channels' }) @ApiOkResponse(OBJ) setAlerts(@CurrentUser() u: AuthUser, @Body() b: AlertConfigBody) { if (!u.roles.includes('super_admin')) throw forbidden('FORBIDDEN_ROLE', 'Insufficient role', { required: ['super_admin'] }); return this.alerts.setConfig(u.sub, b); }
  @Patch('alerts/recipients/:sub') @ApiOperation({ summary: 'OP: a team member opts in/out of lead alerts and picks their channels (own row; super admin any row)' }) @ApiOkResponse(OBJ) setRecipient(@CurrentUser() u: AuthUser, @Param('sub') sub: string, @Body() b: AlertRecipientBody) { if (u.sub !== sub && !u.roles.includes('super_admin')) throw forbidden('FORBIDDEN_ROLE', 'Insufficient role', { required: ['super_admin'] }); return this.alerts.setRecipient(u.sub, sub, b); }
  @Patch(':id') @ApiOperation({ summary: 'OP: set the lead status and/or assignee' }) @ApiOkResponse(OBJ) patch(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: LeadPatchBody) { return this.svc.update(u.sub, id, b); }
  @Post(':id/notes') @HttpCode(200) @ApiOperation({ summary: 'OP: add a note to the lead' }) @ApiOkResponse(OBJ) note(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: LeadNoteBody) { return this.svc.addNote(u.sub, id, b.text); }
}
