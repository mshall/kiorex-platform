import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth';
import { rolesFor } from '../admin/growth-access';
import { LandingEditService } from './landing-edit.service';

const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;
const actor = (u: AuthUser) => ({ sub: u.sub, roles: u.roles });

export class CreateLandingEditDto {
  @IsString() @Matches(/^[a-z-]+:[a-z0-9-]{1,80}(?:\/[a-z0-9-]{1,80}){0,2}$/) pageKey!: string;
  @IsIn(['ar', 'en']) locale!: string;
  @IsString() @MinLength(1) @MaxLength(120) title!: string;
  @IsString() @MinLength(1) @MaxLength(320) description!: string;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}
export class UpdateLandingEditDto {
  @IsOptional() @IsString() @MaxLength(120) title?: string;
  @IsOptional() @IsString() @MaxLength(320) description?: string;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}
export class LandingEditNoteDto { @IsString() @MinLength(10) @MaxLength(300) reason!: string }

/** G-18 ops API of the landing page editor: read for growth readers, maker side and checker side for super admins (see LandingEditService). */
@ApiTags('growth-seo-automation')
@Roles(...rolesFor('read'))
@Controller('admin/growth/landing-edits')
export class LandingEditController {
  constructor(private readonly svc: LandingEditService) {}

  @Get() @ApiOperation({ summary: 'G-18 landing page edits (newest first)' }) @ApiOkResponse(OBJ)
  list(@Query('status') status?: string, @Query('pageKey') pageKey?: string, @Query('take') take?: string) { return this.svc.list({ status, pageKey, take: take ? Number(take) : undefined }); }
  @Roles(...rolesFor('writeConfig')) @Post() @ApiOperation({ summary: 'G-18 draft an edit of a listing page title and description (maker)' }) @ApiOkResponse(OBJ)
  create(@CurrentUser() u: AuthUser, @Body() b: CreateLandingEditDto) { return this.svc.createDraft(actor(u), b); }
  @Roles(...rolesFor('writeConfig')) @Patch(':id') @ApiOperation({ summary: 'G-18 change a draft (its author only)' }) @ApiOkResponse(OBJ)
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: UpdateLandingEditDto) { return this.svc.updateDraft(actor(u), id, b); }
  @Roles(...rolesFor('writeConfig')) @Post(':id/submit') @HttpCode(200) @ApiOperation({ summary: 'G-18 submit a draft: the content quality gate runs and a blocking failure refuses it (422 LANDING_EDIT_QUALITY)' }) @ApiOkResponse(OBJ)
  submit(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.submit(actor(u), id); }
  @Roles(...rolesFor('approveConfig')) @Post(':id/approve') @HttpCode(200) @ApiOperation({ summary: 'G-18 approve (checker, never the author); the gate runs again; supersedes the active edit of that page and locale' }) @ApiOkResponse(OBJ)
  approve(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.approve(actor(u), id); }
  @Roles(...rolesFor('approveConfig')) @Post(':id/reject') @HttpCode(200) @ApiOperation({ summary: 'G-18 reject a submitted edit (checker, never the author)' }) @ApiOkResponse(OBJ)
  reject(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: LandingEditNoteDto) { return this.svc.reject(actor(u), id, b.reason); }
  @Roles(...rolesFor('approveConfig')) @Post(':id/withdraw') @HttpCode(200) @ApiOperation({ summary: 'G-18 withdraw an edit: an active edit stops applying at once and the generated text returns' }) @ApiOkResponse(OBJ)
  withdraw(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: LandingEditNoteDto) { return this.svc.withdraw(actor(u), id, b.reason); }
}
