import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { COMMISSION_ACCESS, canCommission, commissionRolesFor, type CommissionCapability } from './commission-access';
import { CommissionRateService } from './commission-rate.service';

const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;
class RateDefaultBody { @IsIn(['CLINIC', 'PHARMACY', 'LAB']) product!: string; @IsObject() spec!: Record<string, unknown>; @IsOptional() @IsString() @MaxLength(40) effectiveFrom?: string; @IsOptional() @IsString() @MaxLength(300) note?: string }
class RateOrgBody { @IsIn(['CLINIC', 'PHARMACY', 'LAB']) product!: string; @IsIn(['RATE', 'INHERIT']) kind!: string; @IsOptional() @IsObject() spec?: Record<string, unknown>; @IsOptional() @IsString() @MaxLength(40) effectiveFrom?: string; @IsString() @MaxLength(300) reason!: string }
class RateDecideBody { @IsBoolean() approve!: boolean; @IsOptional() @IsString() @MaxLength(300) note?: string }
class RateResyncBody { @IsOptional() @IsIn(['CLINIC', 'PHARMACY', 'LAB']) product?: string }

/** COM-2 ops console API: default commission rate per organisation type, per-organisation override / inherit, history. Same roles as the commission console (`commission-access.ts`): finance reads, super admins propose and decide. */
@ApiTags('ops')
@Controller('admin/commissions/rates')
export class CommissionRatesController {
  constructor(private readonly rates: CommissionRateService) {}
  private need(u: AuthUser, cap: CommissionCapability) { if (!canCommission(u.roles, cap)) throw new ForbiddenException({ code: 'COMMISSION_ROLE_REQUIRED', message: `Requires one of: ${COMMISSION_ACCESS[cap].join(', ')}` }); }

  @ApiOkResponse(OBJ) @ApiOperation({ summary: 'Default rate per organisation type: effective, pending, upcoming, history. An unset default says NOT_SET (no charge).' }) @Roles(...commissionRolesFor('read')) @Get('defaults')
  defaults() { return this.rates.listDefaults(); }

  @ApiOkResponse(OBJ) @Roles(...commissionRolesFor('proposeRate')) @Post('defaults') @HttpCode(200)
  proposeDefault(@CurrentUser() u: AuthUser, @Body() b: RateDefaultBody) { return this.rates.proposeDefault({ product: b.product, spec: b.spec, effectiveFrom: b.effectiveFrom, note: b.note, actor: u.sub }); }

  @ApiOkResponse(OBJ) @ApiOperation({ summary: 'One organisation: default, override, effective rate, inherit state, upcoming, pending and history' }) @Roles(...commissionRolesFor('read')) @Get('orgs/:orgRef')
  org(@Param('orgRef') orgRef: string, @Query('product') product?: string) { return this.rates.orgView(orgRef, product); }

  @ApiOkResponse(OBJ) @Roles(...commissionRolesFor('proposeRate')) @Post('orgs/:orgRef') @HttpCode(200)
  proposeOrg(@CurrentUser() u: AuthUser, @Param('orgRef') orgRef: string, @Body() b: RateOrgBody) { return this.rates.proposeOrg({ orgRef, product: b.product, kind: b.kind, spec: b.spec, effectiveFrom: b.effectiveFrom, reason: b.reason, actor: u.sub }); }

  @ApiOkResponse(OBJ) @Roles(...commissionRolesFor('approveRate')) @Post(':id/decide') @HttpCode(200)
  decide(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: RateDecideBody) { return this.rates.decide({ id, approve: b.approve, note: b.note, actor: u.sub }); }

  @ApiOkResponse(OBJ) @ApiOperation({ summary: 'Re-send every linked organisation its current rate view over the partner channel' }) @Roles(...commissionRolesFor('operate')) @Post('resync') @HttpCode(200)
  resync(@CurrentUser() u: AuthUser, @Body() b: RateResyncBody) { return this.rates.resync(b.product, u.sub); }
}
