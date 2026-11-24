import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser, OpsOnly, Public, type AuthUser } from '../common/auth';
import { ApiError } from '../common/errors';
import { PartnerLeadsService } from './partner-leads.service';

const MAX_BODY = 4096;
class LeadPatchBody { @IsOptional() @IsString() @MaxLength(20) status?: string; @IsOptional() @IsString() @MaxLength(80) assignee?: string | null }
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
  @Public() @Post('leads') @HttpCode(200) @ApiOperation({ summary: 'Submit a "Talk to us" lead (HMAC-signed with ts.rawBody; idempotent per (kind, orgRef))' })
  lead(@Req() req: { rawBody?: Buffer; ip?: string }, @Headers('x-kiorly-signature') sig?: string, @Headers('x-kiorly-timestamp') ts?: string) { return this.svc.submitLead(this.raw(req), { signature: sig, timestamp: ts, ip: req.ip }); }
  @Public() @Post('funnel') @HttpCode(200) @ApiOperation({ summary: 'Record a privacy-safe funnel marker (kind + org id + stage), signed like a lead' })
  funnel(@Req() req: { rawBody?: Buffer; ip?: string }, @Headers('x-kiorly-signature') sig?: string, @Headers('x-kiorly-timestamp') ts?: string) { return this.svc.markFunnel(this.raw(req), { signature: sig, timestamp: ts, ip: req.ip }); }
}

/** Ops console: Partner leads and the onboarding funnel. */
@ApiTags('ops-onboarding')
@OpsOnly()
@Controller('admin/partner-leads')
export class PartnerLeadsOpsController {
  constructor(private readonly svc: PartnerLeadsService) {}
  @Get() @ApiOperation({ summary: 'OP: partner leads (newest first), status derived from the onboarding request' }) @ApiOkResponse() list(@Query('status') status?: string, @Query('kind') kind?: string) { return this.svc.list({ status, kind }); }
  @Get('funnel') @ApiOperation({ summary: 'OP: interested -> started -> submitted -> live (distinct organisations) with conversion' }) @ApiOkResponse() funnel(@Query('days') days?: string, @Query('kind') kind?: string) { return this.svc.funnel(Number(days ?? 30), kind); }
  @Patch(':id') @ApiOperation({ summary: 'OP: set the lead status and/or assignee' }) @ApiOkResponse() patch(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: LeadPatchBody) { return this.svc.update(u.sub, id, b); }
  @Post(':id/notes') @HttpCode(200) @ApiOperation({ summary: 'OP: add a note to the lead' }) @ApiOkResponse() note(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: LeadNoteBody) { return this.svc.addNote(u.sub, id, b.text); }
}
