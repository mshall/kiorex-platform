import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AuthUser, CurrentUser, OpsOnly, Public, SuperAdminOnly } from '../common/auth';
import { INTAKE_MAX_BODY_BYTES } from '@kiorex/contracts';
import { ApiError } from '../common/errors';
import { PartnerEnrolmentService } from './partner-enrolment.service';
import { PartnerOnboardingService } from './partner-onboarding.service';
import { VerificationUpdateService } from './verification-update.consumer';
import { EnrolmentCreatedDto, EnrolmentViewDto, IntakeResultDto, PartnerAuditLineDto, PartnerConnectionDto, PartnerConnectionRowDto, PartnerPublicStatusDto } from './partner-onboarding.dto';

class VerificationDecisionBody { @IsIn(['APPROVED', 'REJECTED', 'NEEDS_INFO']) decision!: string; @IsOptional() @IsString() @MaxLength(300) note?: string }
class PartnerNoteBody { @IsOptional() @IsString() @MaxLength(200) note?: string }
class LicenceBody { @IsString() @MaxLength(80) reference!: string }
class FeesBody { @IsIn(['STANDARD', 'ORG_OVERRIDE']) mode!: 'STANDARD' | 'ORG_OVERRIDE'; @IsOptional() @IsString() @MaxLength(200) note?: string }
class PartnerReasonBody { @IsString() @MaxLength(300) reason!: string }
class EnrolmentBody {
  @IsIn(['CLINIC', 'NURSE', 'PHARMACY', 'LAB']) kind!: string; @IsString() @MaxLength(120) label!: string;
  @IsOptional() @IsString() @MaxLength(80) orgRef?: string; @IsOptional() @IsInt() @Min(1) @Max(336) ttlHours?: number;
}

/** Ops console: one-time enrolment codes that let a partner product submit its first connection request (shown once, single use, expiring, revocable, audited). */
@ApiTags('ops-onboarding')
@OpsOnly()
@Controller('admin/onboarding/enrolments')
export class PartnerEnrolmentController {
  constructor(private readonly svc: PartnerEnrolmentService) {}
  @Get() @ApiOperation({ summary: 'OP: enrolment codes (never the code itself)' }) @ApiOkResponse({ type: EnrolmentViewDto, isArray: true }) list(@Query('kind') kind?: string, @Query('status') status?: string) { return this.svc.list({ kind, status }); }
  @Post() @HttpCode(201) @ApiOperation({ summary: 'OP: create a one-time enrolment code; the code is in this response only' }) @ApiCreatedResponse({ type: EnrolmentCreatedDto }) create(@CurrentUser() u: AuthUser, @Body() b: EnrolmentBody) { return this.svc.create(u.sub, b); }
  @Delete(':id') @HttpCode(200) @ApiOperation({ summary: 'OP: revoke an unused enrolment code' }) @ApiOkResponse({ type: EnrolmentViewDto }) revoke(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.revoke(u.sub, id); }
}

/** Partner products (standalone organisations) ask to join the marketplace and poll their own status. Signed intake, no PHI, secrets never echoed. */
@ApiTags('partner-connections')
@Controller('partners/v1/connection-requests')
export class PartnerConnectionPublicController {
  constructor(private readonly svc: PartnerOnboardingService) {}
  @Public() @Post() @HttpCode(200) @ApiOperation({ summary: 'Submit / re-submit a connection request (HMAC-signed with ts.rawBody); idempotent per (kind, orgRef)' }) @ApiOkResponse({ type: IntakeResultDto })
  intake(@Req() req: { rawBody?: Buffer; ip?: string }, @Headers('x-kiorly-signature') sig?: string, @Headers('x-kiorly-timestamp') ts?: string, @Headers('x-kiorex-enrolment') enrolment?: string) {
    if (!req.rawBody) throw new ApiError(400, 'RAW_BODY_REQUIRED', 'raw body unavailable');
    if (req.rawBody.length > INTAKE_MAX_BODY_BYTES) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
    return this.svc.intake(req.rawBody.toString('utf8'), { signature: sig, timestamp: ts, enrolment, ip: req.ip });
  }
  @Public() @Get(':id') @ApiOperation({ summary: 'Partner polls its own status with the status token returned at creation' }) @ApiOkResponse({ type: PartnerPublicStatusDto })
  status(@Req() req: { ip?: string }, @Param('id') id: string, @Headers('x-connection-token') token?: string) { return this.svc.partnerStatus(id, token, req.ip); }
}

/** Ops console: Partner onboarding queue. ops_admin prepares; ONLY super_admin approves, and never the requester or the licence verifier. */
@ApiTags('ops-onboarding')
@OpsOnly()
@Controller('admin/onboarding/partners')
export class PartnerOnboardingController {
  constructor(private readonly svc: PartnerOnboardingService) {}
  @Get() @ApiOperation({ summary: 'OP: connection requests (queue)' }) @ApiOkResponse({ type: PartnerConnectionRowDto, isArray: true }) list(@Query('status') status?: string, @Query('kind') kind?: string) { return this.svc.list({ status, kind }); }
  @Get(':id') @ApiOperation({ summary: 'OP: one connection request with its computed steps and go-live blockers' }) @ApiOkResponse({ type: PartnerConnectionDto }) get(@Param('id') id: string) { return this.svc.get(id); }
  @Get(':id/audit') @ApiOperation({ summary: 'OP: audit trail of the request' }) @ApiOkResponse({ type: PartnerAuditLineDto, isArray: true }) audit(@Param('id') id: string) { return this.svc.auditTrail(id); }
  @Post(':id/run-checks') @HttpCode(200) @ApiOperation({ summary: 'OP: run the automatic checks now' }) @ApiOkResponse({ type: PartnerConnectionDto }) run(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.runChecks(u.sub, id); }
  @Post(':id/steps/review_documents') @HttpCode(200) @ApiOperation({ summary: 'OP: mark the documents reviewed' }) @ApiOkResponse({ type: PartnerConnectionDto }) docs(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: PartnerNoteBody) { return this.svc.reviewDocuments(u.sub, id, b.note); }
  @Post(':id/steps/verify_licence') @HttpCode(200) @ApiOperation({ summary: 'OP: record the licence verification reference' }) @ApiOkResponse({ type: PartnerConnectionDto }) lic(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: LicenceBody) { return this.svc.verifyLicence(u.sub, id, b.reference); }
  @Post(':id/steps/fees') @HttpCode(200) @ApiOperation({ summary: 'OP: confirm the fee mode (standard or org override)' }) @ApiOkResponse({ type: PartnerConnectionDto }) fees(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: FeesBody) { return this.svc.confirmFees(u.sub, id, b.mode, b.note); }
  @Post(':id/request-changes') @HttpCode(200) @ApiOperation({ summary: 'OP: send the request back to the partner with a reason' }) @ApiOkResponse({ type: PartnerConnectionDto }) changes(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: PartnerReasonBody) { return this.svc.requestChanges(u.sub, id, b.reason); }
  @Post(':id/reject') @HttpCode(200) @ApiOperation({ summary: 'OP: reject the request with a reason' }) @ApiOkResponse({ type: PartnerConnectionDto }) reject(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: PartnerReasonBody) { return this.svc.reject(u.sub, id, b.reason); }
  @Post(':id/request-approval') @HttpCode(200) @ApiOperation({ summary: 'OP: ask a super admin to approve (two-person rule)' }) @ApiOkResponse({ type: PartnerConnectionDto }) request(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.requestApproval(u.sub, id); }
  @SuperAdminOnly() @Post(':id/approve') @HttpCode(200) @ApiOperation({ summary: 'SA: approve (never the requester or the licence verifier)' }) @ApiOkResponse({ type: PartnerConnectionDto }) approve(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.approve(u.sub, id); }
  @Post(':id/go-live') @HttpCode(200) @ApiOperation({ summary: 'OP: register the partner and switch it live (idempotent)' }) @ApiOkResponse({ type: PartnerConnectionDto }) live(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.goLive(u.sub, id); }
  @Post(':id/pause') @HttpCode(200) @ApiOperation({ summary: 'OP: pause a live partner with a reason' }) @ApiOkResponse({ type: PartnerConnectionDto }) pause(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: PartnerReasonBody) { return this.svc.pause(u.sub, id, b.reason); }
  @Post(':id/resume') @HttpCode(200) @ApiOperation({ summary: 'OP: resume a paused partner' }) @ApiOkResponse({ type: PartnerConnectionDto }) resume(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.resume(u.sub, id); }
  @Post(':id/apply-rotation') @HttpCode(200) @ApiOperation({ summary: 'OP: apply a pending credential rotation after a passing handshake' }) @ApiOkResponse({ type: PartnerConnectionDto }) rotate(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.applyRotation(u.sub, id); }
}


/** GRW-P2-C: provider verification update requests (a Clinic or Nurse provider asks Kiorex ops to change a verified public profile field). Ops only; the requested value is read live from the Clinic. */
@ApiTags('ops-onboarding')
@OpsOnly()
@Controller('admin/onboarding/verification-updates')
export class VerificationUpdateController {
  constructor(private readonly svc: VerificationUpdateService) {}
  @Get() @ApiOperation({ summary: 'OP: provider verification update requests (open first)' }) list(@Query('status') status?: string) { return this.svc.list({ status }); }
  @Get(':ref') @ApiOperation({ summary: 'OP: one request with the requested value and evidence references read live from the Clinic' }) get(@Param('ref') ref: string) { return this.svc.detail(ref); }
  @Post(':ref/decide') @HttpCode(200) @ApiOperation({ summary: 'OP: approve, reject or ask for more information; the decision is delivered to the Clinic (ProviderVerificationDecided)' }) decide(@CurrentUser() u: AuthUser, @Param('ref') ref: string, @Body() b: VerificationDecisionBody) { return this.svc.decide(u.sub, ref, b.decision, b.note); }
}
