import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthSessionService } from '../auth/auth-public';
import { AuthUser, CurrentUser } from '../common/auth';
import { RequiresFlag } from '../control-plane/control-plane-public';
import { PatientService } from './patient.service';
import { AuthSessionDto, ConsentRecordDto, ConsentSetResultDto, ConsentStateDto, DataExportDto, DeletionResultDto, DependantDto, KiorlyLinkDto, PatientProfileDto } from './patient.dto';
import { OkDto } from '../common/dto';

class ProfileBody {
  @IsOptional() @IsString() @MaxLength(120) nameEn?: string;
  @IsOptional() @IsString() @MaxLength(120) nameAr?: string;
  @IsOptional() @IsDateString() dateOfBirth?: string;
  @IsOptional() @IsIn(['MALE', 'FEMALE']) gender?: string;
  @IsOptional() @IsString() nationalId?: string | null;
  @IsOptional() @IsIn(['ar', 'en']) preferredLocale?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(2) market?: string;
}
class DependantBody {
  @IsString() @MaxLength(120) nameEn!: string;
  @IsOptional() @IsString() @MaxLength(120) nameAr?: string;
  @IsDateString() dateOfBirth!: string;
  @IsOptional() @IsIn(['MALE', 'FEMALE']) gender?: string;
  @IsIn(['CHILD', 'PARENT', 'SPOUSE', 'OTHER']) relationship!: string;
  @IsOptional() @IsString() evidence?: string;
}
class DependantPatch {
  @IsOptional() @IsString() nameEn?: string;
  @IsOptional() @IsString() nameAr?: string;
  @IsOptional() @IsIn(['MALE', 'FEMALE']) gender?: string;
  @IsOptional() @IsString() relationship?: string;
}
class ConsentBody { @IsBoolean() granted!: boolean }
class DeleteBody { @IsBoolean() confirm!: boolean; @IsOptional() @IsBoolean() includeExport?: boolean }

@ApiTags('patient')
@Controller('me')
export class PatientController {
  constructor(private readonly svc: PatientService, private readonly sessions: AuthSessionService) {}

  @ApiOkResponse({ type: PatientProfileDto })

  @Get('profile') @ApiOperation({ summary: 'KXM-AC-02 profile (national ID masked)' })
  profile(@CurrentUser() u: AuthUser) { return this.svc.getProfile(u); }
  @ApiOkResponse({ type: PatientProfileDto })
  @Put('profile') @ApiOperation({ summary: 'KXM-AC-02 update profile; national ID encrypted at rest' })
  update(@CurrentUser() u: AuthUser, @Body() b: ProfileBody) { return this.svc.updateProfile(u, b); }

  @ApiOkResponse({ type: DependantDto, isArray: true })

  @Get('dependants') @ApiOperation({ summary: 'KXM-AC-03 list family members' })
  deps(@CurrentUser() u: AuthUser) { return this.svc.listDependants(u.sub); }
  @ApiCreatedResponse({ type: DependantDto })
  @Post('dependants') @RequiresFlag('kiorex.family_accounts') @ApiOperation({ summary: 'KXM-AC-03 add dependant (flag kiorex.family_accounts)' })
  addDep(@CurrentUser() u: AuthUser, @Body() b: DependantBody) { return this.svc.addDependant(u, b); }
  @ApiOkResponse({ type: DependantDto })
  @Patch('dependants/:id') patchDep(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: DependantPatch) { return this.svc.updateDependant(u.sub, id, b); }
  @ApiOkResponse({ type: OkDto })
  @Delete('dependants/:id') delDep(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.removeDependant(u.sub, id); }

  @ApiOkResponse({ type: ConsentStateDto, isArray: true })

  @Get('consents') @ApiOperation({ summary: 'KXM-AC-04 consent centre — current state' })
  consents(@CurrentUser() u: AuthUser) { return this.svc.consents(u.sub); }
  @ApiOkResponse({ type: ConsentRecordDto, isArray: true })
  @Get('consents/history') consentHistory(@CurrentUser() u: AuthUser) { return this.svc.consentHistory(u.sub); }
  @ApiOkResponse({ type: ConsentSetResultDto })
  @Put('consents/:purpose') @ApiOperation({ summary: 'KXM-AC-04 grant or withdraw a consent' })
  setConsent(@CurrentUser() u: AuthUser, @Param('purpose') purpose: string, @Body() b: ConsentBody) { return this.svc.setConsent(u.sub, purpose, b.granted); }

  @ApiOkResponse({ type: AuthSessionDto, isArray: true })

  @Get('sessions') @ApiOperation({ summary: 'KXM-AC-05 device/session list' })
  sessionsList(@CurrentUser() u: AuthUser) { return this.sessions.list(u.sub, u.sid); }
  @ApiOkResponse({ type: OkDto })
  @Delete('sessions/:id') @ApiOperation({ summary: 'KXM-AC-05 remote sign-out' })
  revoke(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.sessions.revoke(u.sub, id); }

  @ApiOkResponse({ type: KiorlyLinkDto, isArray: true })

  @Get('kiorly-links') @ApiOperation({ summary: 'KXM-AC-07 Kiorly record links (never auto-merged)' })
  links(@CurrentUser() u: AuthUser) { return this.svc.links(u.sub); }

  @ApiOkResponse({ type: DataExportDto })

  @Post('export') @HttpCode(200) @ApiOperation({ summary: 'KXM-AC-06 data export' })
  export(@CurrentUser() u: AuthUser) { return this.svc.requestExport(u.sub); }
  @ApiOkResponse({ type: DeletionResultDto })
  @Post('deletion') @HttpCode(200) @ApiOperation({ summary: 'KXM-AC-06 in-app account deletion with optional export' })
  async deletion(@CurrentUser() u: AuthUser, @Body() b: DeleteBody) {
    if (!b.confirm) return { ok: false, deleted: false, code: 'CONFIRMATION_REQUIRED' };
    return this.svc.requestDeletion(u.sub, { includeExport: b.includeExport });
  }
}
