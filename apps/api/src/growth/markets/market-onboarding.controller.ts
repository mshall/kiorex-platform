import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser, Roles } from '../../common/auth';
import { RequiresFlag } from '../../control-plane/control-plane-public';
import { rolesFor } from '../admin/growth-access';
import { MarketOnboardingService } from './market-onboarding.service';

export const MARKET_ONBOARDING_FLAG = 'growth.market_onboarding';
const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;
class CreatePlanDto { @IsString() @Length(2, 2) cc!: string }
class CsvDto { @IsOptional() @IsString() @MaxLength(6_000_000) csv?: string; @IsOptional() @IsString() @MaxLength(8_000_000) csvBase64?: string; @IsOptional() @IsIn(['utf-8', 'windows-1256']) encoding?: string }
const actor = (u: AuthUser) => ({ sub: u.sub, roles: u.roles });
const csv = (b: CsvDto) => ({ text: b.csv, base64: b.csvBase64, encoding: b.encoding });

/**
 * Market onboarding wizard API (GRW-P3-G). Reads: every Growth ops role. Writes: super admin only (the maker side); the checker side is the existing configuration approval by a second super admin.
 * Nothing here makes a market live. OFF (`growth.market_onboarding`) answers 403 FEATURE_DISABLED.
 */
@ApiTags('growth-market-onboarding')
@Roles(...rolesFor('read'))
@RequiresFlag(MARKET_ONBOARDING_FLAG)
@Controller('admin/growth/market-onboarding')
export class MarketOnboardingController {
  constructor(private readonly svc: MarketOnboardingService) {}
  @Get('catalogue') @ApiOperation({ summary: 'GRW-P3-G steps, data cells and the markets the code fallback already covers' }) @ApiOkResponse(OBJ) catalogue() { return this.svc.catalogue(); }
  @Get('plans') @ApiOperation({ summary: 'GRW-P3-G onboarding plans' }) @ApiOkResponse(OBJ) list() { return this.svc.list(); }
  @Get('plans/:cc') @ApiOperation({ summary: 'GRW-P3-G one plan with its answers' }) @ApiOkResponse(OBJ) get(@Param('cc') cc: string) { return this.svc.get(cc); }
  @Get('plans/:cc/readiness') @ApiOperation({ summary: 'GRW-P3-G readiness checklist (DONE, TODO, AWAITING_CHECKER, NEEDS_HUMAN)' }) @ApiOkResponse(OBJ) readiness(@Param('cc') cc: string) { return this.svc.readiness(cc); }
  @Get('plans/:cc/geography') @ApiOperation({ summary: 'GRW-P3-G imported cities and districts' }) @ApiOkResponse(OBJ) geography(@Param('cc') cc: string, @Query('level') level?: string) { return this.svc.geography(cc, level); }
  @Post('geography/preview') @HttpCode(200) @ApiOperation({ summary: 'GRW-P3-G validate a geography CSV without writing (errors per line, counts, first rows)' }) @ApiOkResponse(OBJ) preview(@Body() b: CsvDto) { return this.svc.previewGeography(csv(b)); }

  @Roles(...rolesFor('manage')) @Post('plans') @ApiOperation({ summary: 'GRW-P3-G start a plan for a new market (refuses EG, SA, AE and duplicates)' }) @ApiOkResponse(OBJ) create(@CurrentUser() u: AuthUser, @Body() b: CreatePlanDto) { return this.svc.create(actor(u), b.cc); }
  @Roles(...rolesFor('manage')) @Put('plans/:cc/steps/:step') @ApiOperation({ summary: 'GRW-P3-G answer one step (validated; references and booleans only, legal texts stay human)' }) @ApiOkResponse(OBJ) step(@CurrentUser() u: AuthUser, @Param('cc') cc: string, @Param('step') step: string, @Body() body: Record<string, unknown>) { return this.svc.setStep(actor(u), cc, step, body); }
  @Roles(...rolesFor('manage')) @Post('plans/:cc/geography') @HttpCode(200) @ApiOperation({ summary: 'GRW-P3-G import the geography CSV (all or nothing; replaces the market geography)' }) @ApiOkResponse(OBJ) importGeo(@CurrentUser() u: AuthUser, @Param('cc') cc: string, @Body() b: CsvDto) { return this.svc.importGeography(actor(u), cc, csv(b)); }
  @Roles(...rolesFor('manage')) @Post('plans/:cc/publish') @HttpCode(200) @ApiOperation({ summary: 'GRW-P3-G draft and submit the three config versions and register the launch-locked live flag (a second super admin approves)' }) @ApiOkResponse(OBJ) publish(@CurrentUser() u: AuthUser, @Param('cc') cc: string) { return this.svc.publish(actor(u), cc); }
  @Roles(...rolesFor('manage')) @Post('plans/:cc/cancel') @HttpCode(200) @ApiOperation({ summary: 'GRW-P3-G cancel an unpublished plan' }) @ApiOkResponse(OBJ) cancel(@CurrentUser() u: AuthUser, @Param('cc') cc: string) { return this.svc.cancel(actor(u), cc); }
}
