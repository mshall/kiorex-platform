import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { AuthUser, CurrentUser, Roles } from '../../common/auth';
import { RequiresFlag } from '../../control-plane/control-plane-public';
import { rolesFor } from '../admin/growth-access';
import { CORPORATE_FLAG } from '../growth-flags';
import { B2bReferralService } from './b2b-referral.service';
import { CorporateMemberService } from './corporate-member.service';
import { CorporateReportService } from './corporate-report.service';
import { CorporateService, MAX_MINOR } from './corporate.service';

const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;
const num = (v?: string) => (v === undefined || v === '' ? undefined : Number(v));

class CorporateCreateAccountBody {
  @IsString() @MaxLength(120) displayName!: string;
  @IsOptional() @IsIn(['SPONSOR_CREDIT', 'PLATFORM_PROMO']) fundingMode?: 'SPONSOR_CREDIT' | 'PLATFORM_PROMO';
  @IsOptional() @IsString() @MaxLength(120) legalNameRef?: string;
  @IsOptional() @IsString() @MaxLength(120) billingContactRef?: string;
  @IsOptional() @IsString() @MaxLength(40) leadId?: string;
}
class CorporateTermsBody {
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(120) contractRef?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsInt() @Min(0) @Max(MAX_MINOR) sponsorCeilingMinor?: number | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsInt() @Min(0) @Max(MAX_MINOR) perMemberCapMinor?: number | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsInt() @Min(0) @Max(MAX_MINOR) perVisitMaxMinor?: number | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsInt() @Min(1) @Max(10000) coverBp?: number | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(40) startsAt?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(40) endsAt?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(100, { each: true }) emailDomains?: string[];
  @IsOptional() @IsIn(['SPONSOR_CREDIT', 'PLATFORM_PROMO']) fundingMode?: 'SPONSOR_CREDIT' | 'PLATFORM_PROMO';
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(120) billingContactRef?: string | null;
}
class CorporateCodeBody {
  @IsString() @MaxLength(80) label!: string;
  @IsOptional() @IsIn(['OPEN', 'LIST']) kind?: 'OPEN' | 'LIST';
  @Type(() => Number) @IsInt() @Min(1) @Max(100000) maxRedemptions!: number;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsInt() @Min(1) @Max(MAX_MINOR) perMemberCapMinor?: number | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(40) expiresAt?: string | null;
}
class CorporateInvoiceNoteBody { @IsString() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) month!: string; @IsOptional() @IsString() @MaxLength(1000) notes?: string }
class CorporateHrBody { @IsArray() @ArrayMaxSize(100000) @IsString({ each: true }) @MaxLength(80, { each: true }) rows!: string[] }
class CorporateHrDecisionBody { @IsIn(['APPROVED', 'REJECTED']) decision!: 'APPROVED' | 'REJECTED' }
class CorporateLeadBody {
  @IsString() @MaxLength(120) companyName!: string;
  @IsOptional() @IsIn(['OUTBOUND', 'INBOUND']) source?: 'OUTBOUND' | 'INBOUND';
  @IsOptional() @IsString() @MaxLength(20) sizeBucket?: string;
  @IsOptional() @IsString() @MaxLength(80) contactRef?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
class CorporateLeadTransitionBody { @IsIn(['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST', 'DUPLICATE']) status!: string; @IsOptional() @IsString() @MaxLength(500) note?: string }
class CorporateAssignBody { @IsString() @MaxLength(80) ownerSub!: string }
class CorporateNotesBody { @IsString() @MaxLength(2000) notes!: string }

/**
 * Ops console API of the corporate programme (GRW-P4-C). Reads: every Growth ops role. Writes: super admin. Money-relevant acts (activate, issue a code, approve an HR list) need the launch-locked flag
 * `growth.corporate`; leads, accounts in LEAD state and every read work with the flag OFF (preparation and the pipeline are not benefits). Nothing here returns a member, a booking or a person:
 * the member table is reachable only as counts, the plain code only once at creation, and the HR list only as counts.
 */
@ApiTags('growth-corporate')
@Roles(...rolesFor('read'))
@Controller('admin/growth/corporate')
export class CorporateAdminController {
  constructor(private readonly accounts: CorporateService, private readonly members: CorporateMemberService, private readonly reports: CorporateReportService, private readonly leads: B2bReferralService) {}

  @Get('accounts') @ApiOperation({ summary: 'GRW-P4-C corporate accounts (company data and terms)' }) @ApiOkResponse(OBJ)
  list(@Query('status') status?: string, @Query('take') take?: string) { return this.accounts.list({ status, take: num(take) }); }
  @Roles(...rolesFor('manageCorporate')) @Post('accounts') @ApiOperation({ summary: 'GRW-P4-C open a corporate account (LEAD)' }) @ApiOkResponse(OBJ)
  create(@CurrentUser() u: AuthUser, @Body() b: CorporateCreateAccountBody) { return this.accounts.create({ sub: u.sub, roles: u.roles }, b); }
  @Get('accounts/:id') @ApiOperation({ summary: 'GRW-P4-C one account' }) @ApiOkResponse(OBJ)
  get(@Param('id') id: string) { return this.accounts.get(id); }
  @Roles(...rolesFor('manageCorporate')) @Put('accounts/:id/terms') @ApiOperation({ summary: 'GRW-P4-C edit the commercial terms (LEAD or PAUSED only); the editor cannot activate' }) @ApiOkResponse(OBJ)
  terms(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: CorporateTermsBody) { return this.accounts.updateTerms({ sub: u.sub, roles: u.roles }, id, b); }
  @Roles(...rolesFor('manageCorporate')) @RequiresFlag(CORPORATE_FLAG) @Post('accounts/:id/activate') @HttpCode(200) @ApiOperation({ summary: 'GRW-P4-C activate (a second person; terms complete)' }) @ApiOkResponse(OBJ)
  activate(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.accounts.activate({ sub: u.sub, roles: u.roles }, id); }
  @Roles(...rolesFor('manageCorporate')) @Post('accounts/:id/pause') @HttpCode(200) @ApiOperation({ summary: 'GRW-P4-C pause' }) @ApiOkResponse(OBJ)
  pause(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.accounts.pause({ sub: u.sub, roles: u.roles }, id); }
  @Roles(...rolesFor('manageCorporate')) @Post('accounts/:id/end') @HttpCode(200) @ApiOperation({ summary: 'GRW-P4-C end the programme (final)' }) @ApiOkResponse(OBJ)
  end(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.accounts.end({ sub: u.sub, roles: u.roles }, id); }

  @Get('accounts/:id/codes') @ApiOperation({ summary: 'GRW-P4-C codes: label, counters, state (never the code or its hash)' }) @ApiOkResponse(OBJ)
  codes(@Param('id') id: string) { return this.accounts.listCodes(id); }
  @Roles(...rolesFor('manageCorporate')) @RequiresFlag(CORPORATE_FLAG) @Post('accounts/:id/codes') @ApiOperation({ summary: 'GRW-P4-C create a code (the plain code is returned once)' }) @ApiOkResponse(OBJ)
  createCode(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: CorporateCodeBody) { return this.accounts.createCode({ sub: u.sub, roles: u.roles }, id, b); }
  @Roles(...rolesFor('manageCorporate')) @Post('accounts/:id/codes/:codeId/revoke') @HttpCode(200) @ApiOperation({ summary: 'GRW-P4-C revoke a code' }) @ApiOkResponse(OBJ)
  revoke(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('codeId') codeId: string) { return this.accounts.revokeCode({ sub: u.sub, roles: u.roles }, id, codeId); }

  @Get('accounts/:id/report') @ApiOperation({ summary: 'GRW-P4-C aggregate report (enrolment, utilisation, sponsored value), every cell masked below k' }) @ApiOkResponse(OBJ)
  report(@Param('id') id: string) { return this.reports.report(id); }
  @Roles(...rolesFor('readFinance')) @Get('accounts/:id/statement') @ApiOperation({ summary: 'GRW-P4-C invoice basis of one month (finance)' }) @ApiOkResponse(OBJ)
  statement(@Param('id') id: string, @Query('month') month: string) { return this.reports.monthlyStatement(id, /^\d{4}-(0[1-9]|1[0-2])$/.test(month ?? '') ? month : new Date().toISOString().slice(0, 7)); }
  @Get('accounts/:id/invoice-notes') @ApiOperation({ summary: 'GRW-P4-C manual invoice notes' }) @ApiOkResponse(OBJ)
  notes(@Param('id') id: string) { return this.accounts.invoiceNotes(id); }
  @Roles(...rolesFor('manageCorporate')) @Post('accounts/:id/invoice-notes') @ApiOperation({ summary: 'GRW-P4-C record the sponsor spend of a month for manual invoicing' }) @ApiOkResponse(OBJ)
  addNote(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: CorporateInvoiceNoteBody) { return this.accounts.invoiceNote({ sub: u.sub, roles: u.roles }, id, b); }

  @Get('accounts/:id/hr-lists') @ApiOperation({ summary: 'GRW-P4-C HR lists as counts only' }) @ApiOkResponse(OBJ)
  hr(@Param('id') id: string) { return this.members.hrBatches(id); }
  @Roles(...rolesFor('manageCorporate')) @RequiresFlag(CORPORATE_FLAG) @Post('accounts/:id/hr-lists') @ApiOperation({ summary: 'GRW-P4-C upload an HR list (phone or e-mail per row; only keyed hashes are stored; a second person approves)' }) @ApiOkResponse(OBJ)
  uploadHr(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: CorporateHrBody) { return this.members.uploadHrList({ sub: u.sub, roles: u.roles }, id, b.rows); }
  @Roles(...rolesFor('manageCorporate')) @RequiresFlag(CORPORATE_FLAG) @Post('hr-lists/:batchId/decision') @HttpCode(200) @ApiOperation({ summary: 'GRW-P4-C approve or reject an HR list (not the uploader)' }) @ApiOkResponse(OBJ)
  decideHr(@CurrentUser() u: AuthUser, @Param('batchId') batchId: string, @Body() b: CorporateHrDecisionBody) { return this.members.decideHrList({ sub: u.sub, roles: u.roles }, batchId, b.decision); }

  @Get('leads') @ApiOperation({ summary: 'GRW-P4-C enterprise leads and the pipeline counts' }) @ApiOkResponse(OBJ)
  leadList(@Query('status') status?: string, @Query('source') source?: string, @Query('take') take?: string) { return this.leads.list({ status, source, take: num(take) }); }
  @Roles(...rolesFor('manageCorporate')) @Post('leads') @ApiOperation({ summary: 'GRW-P4-C add an inbound or outbound lead (company data only)' }) @ApiOkResponse(OBJ)
  leadCreate(@CurrentUser() u: AuthUser, @Body() b: CorporateLeadBody) { return this.leads.create({ sub: u.sub, roles: u.roles }, b); }
  @Get('leads/:id') @ApiOperation({ summary: 'GRW-P4-C one lead with its history' }) @ApiOkResponse(OBJ)
  leadGet(@Param('id') id: string) { return this.leads.get(id); }
  @Roles(...rolesFor('manageCorporate')) @Post('leads/:id/transition') @HttpCode(200) @ApiOperation({ summary: 'GRW-P4-C move a lead through the pipeline' }) @ApiOkResponse(OBJ)
  leadTransition(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: CorporateLeadTransitionBody) { return this.leads.transition({ sub: u.sub, roles: u.roles }, id, b.status, b.note); }
  @Roles(...rolesFor('manageCorporate')) @Post('leads/:id/assign') @HttpCode(200) @ApiOperation({ summary: 'GRW-P4-C assign an owner' }) @ApiOkResponse(OBJ)
  leadAssign(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: CorporateAssignBody) { return this.leads.assign({ sub: u.sub, roles: u.roles }, id, b.ownerSub); }
  @Roles(...rolesFor('manageCorporate')) @Put('leads/:id/notes') @ApiOperation({ summary: 'GRW-P4-C replace the company notes' }) @ApiOkResponse(OBJ)
  leadNotes(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: CorporateNotesBody) { return this.leads.setNotes({ sub: u.sub, roles: u.roles }, id, b.notes); }
}
