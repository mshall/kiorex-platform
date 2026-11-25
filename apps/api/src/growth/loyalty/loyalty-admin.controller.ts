import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { AuthUser, CurrentUser, Roles } from '../../common/auth';
import { RequiresFlag } from '../../control-plane/control-plane-public';
import { rolesFor } from '../admin/growth-access';
import { LOYALTY_FLAG } from '../growth-flags';
import { LoyaltyAdminService } from './loyalty-admin.service';
import { MAX_MINOR, PartnershipOfferService } from './partnership-offer.service';

const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;
const num = (v?: string) => (v === undefined || v === '' ? undefined : Number(v));
const KINDS = ['CODE_DISCOUNT', 'CO_PROMO', 'CARD_OFFER'] as const;

class ProgramBody {
  @IsOptional() @IsString() @Matches(/^[a-z0-9][a-z0-9-]{1,47}$/) key?: string;
  @IsOptional() @IsString() @MaxLength(80) partnerRef?: string;
  @IsOptional() @IsIn([...KINDS]) kind?: (typeof KINDS)[number];
  @IsOptional() @IsString() @MaxLength(120) nameAr?: string;
  @IsOptional() @IsString() @MaxLength(120) nameEn?: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(200) legalTextRef?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_MINOR) budgetMinor?: number;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_MINOR) perRedemptionMinor?: number;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(40) startsAt?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(40) endsAt?: string | null;
  @IsOptional() @IsIn(['PLATFORM_MARKETING', 'PARTNER_FUNDED']) fundingMode?: 'PLATFORM_MARKETING' | 'PARTNER_FUNDED';
}
class LinkBody { @IsString() @MaxLength(64) campaignId!: string }
class CodeBody {
  @IsString() @MaxLength(80) label!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(100000) maxRedemptions!: number;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(40) expiresAt?: string | null;
}
class PreviewQuery { @Type(() => Number) @IsInt() @Min(0) @Max(100000) completed!: number }

/**
 * Ops console API of loyalty and partnerships (GRW-P4-D). Reads: every Growth ops role. Writes: super admin (a second person activates a program). The points RULES are edited in the maker-checker config console
 * (kind LOYALTY_RULES); nothing here changes a rule, a balance or a person. Money-relevant acts (activate, issue a code) need the launch-locked flag `growth.loyalty`; drafting, linking and every read work with it OFF.
 */
@ApiTags('growth-loyalty')
@Roles(...rolesFor('read'))
@Controller('admin/growth/loyalty')
export class LoyaltyAdminController {
  constructor(private readonly admin: LoyaltyAdminService, private readonly programs: PartnershipOfferService) {}

  @Get('summary') @ApiOperation({ summary: 'GRW-P4-D loyalty overview: tiers, points flow and partnership totals (aggregate, k >= 10)' }) @ApiOkResponse(OBJ)
  summary() { return this.admin.summary(); }
  @Get('rules') @ApiOperation({ summary: 'GRW-P4-D the active LOYALTY_RULES (tiers, points, expiry, conversion) and whether they are still the zero defaults' }) @ApiOkResponse(OBJ)
  rules() { return this.admin.rules(); }
  @Get('tiers/preview') @ApiOperation({ summary: 'GRW-P4-D which tier N completed bookings give under the active rules' }) @ApiOkResponse(OBJ)
  preview(@Query() q: PreviewQuery) { return this.admin.previewTier(q.completed); }

  @Get('partnerships') @ApiOperation({ summary: 'GRW-P4-D partnership programs with budget use' }) @ApiOkResponse(OBJ)
  list(@Query('status') status?: string, @Query('take') take?: string) { return this.programs.list({ status, take: num(take) }); }
  @Get('partnerships/:id') @ApiOperation({ summary: 'GRW-P4-D one program' }) @ApiOkResponse(OBJ)
  get(@Param('id') id: string) { return this.programs.get(id); }
  @Get('partnerships/:id/codes') @ApiOperation({ summary: 'GRW-P4-D the codes of a program (counts, never the plain code)' }) @ApiOkResponse(OBJ)
  codes(@Param('id') id: string) { return this.programs.codes(id); }

  @Roles(...rolesFor('manageLoyalty')) @Post('partnerships') @ApiOperation({ summary: 'GRW-P4-D draft a partnership program (amounts default to 0)' }) @ApiOkResponse(OBJ)
  create(@CurrentUser() u: AuthUser, @Body() b: ProgramBody) { return this.programs.create({ sub: u.sub, roles: u.roles }, b); }
  @Roles(...rolesFor('manageLoyalty')) @Put('partnerships/:id') @ApiOperation({ summary: 'GRW-P4-D edit a draft program' }) @ApiOkResponse(OBJ)
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: ProgramBody) { return this.programs.update({ sub: u.sub, roles: u.roles }, id, b); }
  @Roles(...rolesFor('manageLoyalty')) @Post('partnerships/:id/campaign') @HttpCode(200) @ApiOperation({ summary: 'GRW-P4-D link the PARTNER-channel campaign whose approval governs the program' }) @ApiOkResponse(OBJ)
  link(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: LinkBody) { return this.programs.linkCampaign({ sub: u.sub, roles: u.roles }, id, b.campaignId); }
  @Roles(...rolesFor('manageLoyalty')) @RequiresFlag(LOYALTY_FLAG) @Post('partnerships/:id/activate') @HttpCode(200) @ApiOperation({ summary: 'GRW-P4-D activate (a second person; terms complete; campaign approved)' }) @ApiOkResponse(OBJ)
  activate(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.programs.activate({ sub: u.sub, roles: u.roles }, id); }
  @Roles(...rolesFor('manageLoyalty')) @Post('partnerships/:id/pause') @HttpCode(200) @ApiOperation({ summary: 'GRW-P4-D pause' }) @ApiOkResponse(OBJ)
  pause(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.programs.pause({ sub: u.sub, roles: u.roles }, id); }
  @Roles(...rolesFor('manageLoyalty')) @Post('partnerships/:id/end') @HttpCode(200) @ApiOperation({ summary: 'GRW-P4-D end the program (final)' }) @ApiOkResponse(OBJ)
  end(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.programs.end({ sub: u.sub, roles: u.roles }, id); }
  @Roles(...rolesFor('manageLoyalty')) @RequiresFlag(LOYALTY_FLAG) @Post('partnerships/:id/codes') @ApiOperation({ summary: 'GRW-P4-D issue a code (the plain code is returned once)' }) @ApiOkResponse(OBJ)
  code(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: CodeBody) { return this.programs.createCode({ sub: u.sub, roles: u.roles }, id, b); }
  @Roles(...rolesFor('manageLoyalty')) @Post('partnerships/:id/codes/:codeId/revoke') @HttpCode(200) @ApiOperation({ summary: 'GRW-P4-D revoke a code' }) @ApiOkResponse(OBJ)
  revoke(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('codeId') codeId: string) { return this.programs.revokeCode({ sub: u.sub, roles: u.roles }, id, codeId); }
}
