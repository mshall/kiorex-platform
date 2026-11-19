import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, StreamableFile } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AuthUser, CurrentUser, Public } from '../common/auth';
import { RequiresFlag } from '../control-plane/control-plane-public';
import { FollowUpDto, OkDto, RecordSharingDto, RxVerifyResultDto, VaultDetailDto, VaultItemDto, PrescriptionItemDto, VaultListDto } from './records.dto';
import { RecordsService } from './records.service';

export class UploadBody {
  @IsString() @MaxLength(160) fileName!: string;
  /** application/pdf | image/jpeg | image/png */
  @IsString() mimeType!: string;
  /** File bytes, base64 (max VAULT_MAX_BYTES, 5 MB default). */
  @IsString() contentBase64!: string;
  @IsOptional() @IsString() @MaxLength(120) title?: string;
}
export class ShareBody { @IsBoolean() granted!: boolean }
export class FollowUpBody { @IsInt() @Min(1) @Max(730) afterDays!: number }
export class FollowUpCreateBody {
  @IsInt() @Min(1) @Max(730) afterDays!: number;
  @IsOptional() @IsString() recordId?: string;
}

@ApiTags('records')
@Controller()
export class VaultController {
  constructor(private readonly svc: RecordsService) {}

  @Get('me/vault') @ApiOperation({ summary: 'KXM-RC-01 patient vault: shared + uploaded records (always readable; readOnly=true when kiorex.record_vault is OFF)' })
  @ApiOkResponse({ type: VaultListDto })
  list(@CurrentUser() u: AuthUser, @Query('kind') kind?: string) { return this.svc.list(u.sub, kind); }

  @Post('me/vault/uploads') @HttpCode(201) @RequiresFlag('kiorex.record_vault')
  @ApiOperation({ summary: 'KXM-RC-01 upload a PDF/JPEG/PNG to the vault (flag kiorex.record_vault; JSON base64, stored encrypted via the storage adapter)' })
  @ApiCreatedResponse({ type: VaultItemDto })
  upload(@CurrentUser() u: AuthUser, @Body() b: UploadBody) { return this.svc.upload(u.sub, b); }

  @Get('me/vault/:id') @ApiOperation({ summary: 'KXM-RC-01 view a record (owner only; prescriptions include the verification QR payload)' })
  @ApiOkResponse({ type: VaultDetailDto })
  detail(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.detail(u.sub, id); }

  @ApiOkResponse({ description: 'The uploaded file (application/pdf, image/jpeg, image/png)', schema: { type: 'string', format: 'binary' } })

  @Get('me/vault/:id/content') @ApiOperation({ summary: 'Download an uploaded file (decrypted on the fly, owner only)' })
  async content(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const f = await this.svc.content(u.sub, id);
    return new StreamableFile(f.bytes, { type: f.mimeType, disposition: `attachment; filename="${encodeURIComponent(f.fileName)}"` });
  }

  @Delete('me/vault/:id') @ApiOperation({ summary: 'KXM-RC-01 revoke/delete a record from the vault (always allowed, even when the vault flag is OFF)' })
  @ApiOkResponse({ type: OkDto })
  remove(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.remove(u.sub, id); }

  @Get('me/record-sharing') @ApiOperation({ summary: 'KXM-RC-01 record-share consent per scope (VISIT_SUMMARY, PRESCRIPTIONS, LAB_RESULTS, SHARE_WITH_OTHER_CLINICS)' })
  @ApiOkResponse({ type: RecordSharingDto })
  sharing(@CurrentUser() u: AuthUser) { return this.svc.sharing(u.sub); }

  @Put('me/record-sharing/:scope') @ApiOperation({ summary: 'Grant (needs flags kiorex.record_vault + clinic.record_share_patient_app) or revoke (always allowed; deletes Kiorex copies and tells Kiorly)' })
  @ApiOkResponse({ type: RecordSharingDto })
  setSharing(@CurrentUser() u: AuthUser, @Param('scope') scope: string, @Body() b: ShareBody) { return this.svc.setSharing(u.sub, scope, b.granted); }

  @Get('me/prescriptions') @ApiOperation({ summary: 'KXM-RC-02 prescriptions with verification QR payloads' })
  @ApiOkResponse({ type: PrescriptionItemDto, isArray: true })
  prescriptions(@CurrentUser() u: AuthUser) { return this.svc.prescriptions(u.sub); }

  @Public() @Get('rx/verify') @ApiOperation({ summary: 'KXM-RC-02 pharmacist check of a prescription QR token: validity, issuing clinic id and signed date only (no patient data)' })
  @ApiOkResponse({ type: RxVerifyResultDto })
  verify(@Query('t') t: string) { return this.svc.verifyRx(t); }

  @Get('me/follow-ups') @ApiOperation({ summary: 'KXM-RC-03 follow-up reminders (doctor-specified or patient-set)' })
  @ApiOkResponse({ type: FollowUpDto, isArray: true })
  followUps(@CurrentUser() u: AuthUser) { return this.svc.followUps(u.sub); }

  @Post('me/follow-ups') @HttpCode(201) @ApiOperation({ summary: 'KXM-RC-03 set a follow-up reminder N days from now (optionally tied to a vault record)' })
  @ApiCreatedResponse({ type: FollowUpDto })
  async createFollowUp(@CurrentUser() u: AuthUser, @Body() b: FollowUpCreateBody) { return b.recordId ? this.svc.followUpForOwner(u.sub, b.recordId, b.afterDays) : this.svc.createFollowUp({ sub: u.sub, afterDays: b.afterDays, source: 'PATIENT' }); }

  @Delete('me/follow-ups/:id') @ApiOkResponse({ type: OkDto }) cancelFollowUp(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.cancelFollowUp(u.sub, id); }
}
