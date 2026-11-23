import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AuthUser, CurrentUser, OpsOnly, SuperAdminOnly } from '../common/auth';
import { OnboardingImportService } from './onboarding-import.service';
import type { TaskAction } from './lib/analyzer';

const ACTIONS = ['MAP_TABLE', 'MAP_COLUMN', 'EDIT_VALUE', 'SKIP_ROW', 'MERGE', 'KEEP_BOTH', 'ASSIGN_PATIENT', 'ASSIGN_FILE', 'SKIP_FILE', 'ACCEPT_REPAIR', 'CHOOSE_DATE_FORMAT', 'IGNORE'];
class OnbCreateBatchBody { @IsString() @MinLength(1) @MaxLength(80) orgId!: string; @IsString() @MinLength(1) @MaxLength(160) orgName!: string; @IsOptional() @IsString() @MaxLength(160) label?: string }
class OnbUploadBody { @IsString() @MaxLength(200) name!: string; @IsString() contentBase64!: string }
class OnbResolveBody { @IsIn(ACTIONS) action!: TaskAction; @IsOptional() @IsObject() params?: Record<string, any>; @IsOptional() @IsString() @MaxLength(500) reason?: string }
class OnbResolveManyBody extends OnbResolveBody { @IsArray() ids!: string[] }
class OnbApproveBody { @IsString() reportHash!: string }
class OnbReasonBody { @IsString() @MaxLength(500) reason!: string }
void IsBoolean;

/** Organization onboarding / data import. ops_admin prepares and resolves; ONLY super_admin approves/commits/rolls back; approver ≠ requester ≠ creator (two-person rule). */
@ApiTags('ops-onboarding')
@OpsOnly()
@Controller('admin/onboarding/imports')
export class OnboardingImportController {
  constructor(private readonly svc: OnboardingImportService) {}

  @Post() @ApiOperation({ summary: 'Create an import batch for a target organization' })
  create(@CurrentUser() u: AuthUser, @Body() b: OnbCreateBatchBody) { return this.svc.create(u, b); }
  @Get() list() { return this.svc.list(); }
  @Get(':id') get(@Param('id') id: string) { return this.svc.get(id); }

  @Post(':id/files') @HttpCode(201) @ApiOperation({ summary: 'Upload one file into quarantine: JSON {name, contentBase64} or application/octet-stream with ?name=' })
  upload(@CurrentUser() u: AuthUser, @Param('id') id: string, @Req() req: { body: unknown }, @Query('name') qname?: string) {
    if (Buffer.isBuffer(req.body)) { if (!qname) throw new BadRequestException({ code: 'NAME_REQUIRED', message: 'NAME_REQUIRED' }); return this.svc.addFile(u, id, qname, req.body.toString('base64')); }
    const b = req.body as OnbUploadBody; if (!b || typeof b.name !== 'string' || typeof b.contentBase64 !== 'string') throw new BadRequestException({ code: 'BAD_UPLOAD', message: 'BAD_UPLOAD' });
    return this.svc.addFile(u, id, b.name, b.contentBase64);
  }
  @Post(':id/rescan') @HttpCode(200) rescan(@Param('id') id: string) { return this.svc.reanalyze(id).then((a) => ({ ok: true, stats: a?.stats ?? null })); }

  @Get(':id/tasks') tasks(@Param('id') id: string, @Query('status') status?: string, @Query('severity') severity?: string, @Query('type') type?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) { return this.svc.tasks(id, { status, severity, type, page: page ? +page : 1, pageSize: pageSize ? +pageSize : 50 }); }
  @Post(':id/tasks/resolve-many') @HttpCode(200) resolveMany(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: OnbResolveManyBody) { return this.svc.resolveMany(u, id, b.ids, b); }
  @Post(':id/tasks/:taskId/resolve') @HttpCode(200) resolve(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('taskId') taskId: string, @Body() b: OnbResolveBody) { return this.svc.resolve(u, id, taskId, b); }
  @Get(':id/patients') patients(@Param('id') id: string, @Query('q') q?: string) { return this.svc.patientsLookup(id, q ?? ''); }

  @Get(':id/dry-run') dryRun(@Param('id') id: string) { return this.svc.dryRun(id); }
  @Post(':id/request-commit') @HttpCode(200) request(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.requestCommit(u, id); }
  @SuperAdminOnly() @Post(':id/approve') @HttpCode(200) approve(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: OnbApproveBody) { return this.svc.approve(u, id, b.reportHash); }
  @SuperAdminOnly() @Post(':id/reject') @HttpCode(200) reject(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: OnbReasonBody) { return this.svc.reject(u, id, b.reason); }
  @SuperAdminOnly() @Post(':id/commit') @HttpCode(200) commit(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.commit(u, id); }
  @SuperAdminOnly() @Post(':id/rollback') @HttpCode(200) rollback(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: OnbReasonBody) { return this.svc.rollback(u, id, b.reason); }
  @SuperAdminOnly() @Post(':id/purge-staging') @HttpCode(200) purge(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.purgeStaging(u, id); }
  @Get(':id/audit') audit(@Param('id') id: string) { return this.svc.auditTrail(id); }
}
