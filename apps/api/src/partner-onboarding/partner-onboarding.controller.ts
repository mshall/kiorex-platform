import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser, OpsOnly, Public, SuperAdminOnly } from '../common/auth';
import { ApiError } from '../common/errors';
import { PartnerOnboardingService } from './partner-onboarding.service';

class NoteBody { @IsOptional() @IsString() @MaxLength(200) note?: string }
class LicenceBody { @IsString() @MaxLength(80) reference!: string }
class FeesBody { @IsIn(['STANDARD', 'ORG_OVERRIDE']) mode!: 'STANDARD' | 'ORG_OVERRIDE'; @IsOptional() @IsString() @MaxLength(200) note?: string }
class ReasonBody { @IsString() @MaxLength(300) reason!: string }

/** Partner products (standalone organisations) ask to join the marketplace and poll their own status. Signed intake, no PHI, secrets never echoed. */
@ApiTags('partner-connections')
@Controller('partners/v1/connection-requests')
export class PartnerConnectionPublicController {
  constructor(private readonly svc: PartnerOnboardingService) {}
  @Public() @Post() @HttpCode(200) @ApiOperation({ summary: 'Submit / re-submit a connection request (HMAC-signed with ts.rawBody); idempotent per (kind, orgRef)' })
  intake(@Req() req: { rawBody?: Buffer }, @Headers('x-kiorly-signature') sig?: string, @Headers('x-kiorly-timestamp') ts?: string) {
    if (!req.rawBody) throw new ApiError(400, 'RAW_BODY_REQUIRED', 'raw body unavailable');
    return this.svc.intake(req.rawBody.toString('utf8'), { signature: sig, timestamp: ts });
  }
  @Public() @Get(':id') @ApiOperation({ summary: 'Partner polls its own status with the status token returned at creation' })
  status(@Param('id') id: string, @Headers('x-connection-token') token?: string) { return this.svc.partnerStatus(id, token); }
}

/** Ops console: Partner onboarding queue. ops_admin prepares; ONLY super_admin approves, and never the requester or the licence verifier. */
@ApiTags('ops-onboarding')
@OpsOnly()
@Controller('admin/onboarding/partners')
export class PartnerOnboardingController {
  constructor(private readonly svc: PartnerOnboardingService) {}
  @Get() list(@Query('status') status?: string, @Query('kind') kind?: string) { return this.svc.list({ status, kind }); }
  @Get(':id') get(@Param('id') id: string) { return this.svc.get(id); }
  @Get(':id/audit') audit(@Param('id') id: string) { return this.svc.auditTrail(id); }
  @Post(':id/run-checks') @HttpCode(200) run(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.runChecks(u.sub, id); }
  @Post(':id/steps/review_documents') @HttpCode(200) docs(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: NoteBody) { return this.svc.reviewDocuments(u.sub, id, b.note); }
  @Post(':id/steps/verify_licence') @HttpCode(200) lic(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: LicenceBody) { return this.svc.verifyLicence(u.sub, id, b.reference); }
  @Post(':id/steps/fees') @HttpCode(200) fees(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: FeesBody) { return this.svc.confirmFees(u.sub, id, b.mode, b.note); }
  @Post(':id/request-changes') @HttpCode(200) changes(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: ReasonBody) { return this.svc.requestChanges(u.sub, id, b.reason); }
  @Post(':id/reject') @HttpCode(200) reject(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: ReasonBody) { return this.svc.reject(u.sub, id, b.reason); }
  @Post(':id/request-approval') @HttpCode(200) request(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.requestApproval(u.sub, id); }
  @SuperAdminOnly() @Post(':id/approve') @HttpCode(200) approve(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.approve(u.sub, id); }
  @Post(':id/go-live') @HttpCode(200) live(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.goLive(u.sub, id); }
  @Post(':id/pause') @HttpCode(200) pause(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: ReasonBody) { return this.svc.pause(u.sub, id, b.reason); }
  @Post(':id/resume') @HttpCode(200) resume(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.resume(u.sub, id); }
  @Post(':id/apply-rotation') @HttpCode(200) rotate(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.applyRotation(u.sub, id); }
}
