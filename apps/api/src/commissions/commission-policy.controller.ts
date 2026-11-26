import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { COMMISSION_ACCESS, canCommission, commissionRolesFor, type CommissionCapability } from './commission-access';
import { COMMISSION_POLICY_KINDS } from './commission-policy';
import { CommissionPolicyService } from './commission-policy.service';
import { CommissionRateService } from './commission-rate.service';

const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;
class PolicyProposeBody { @IsIn([...COMMISSION_POLICY_KINDS]) kind!: string; @IsObject() payload!: Record<string, unknown>; @IsString() @MaxLength(300) reason!: string; @IsOptional() @IsString() @MaxLength(40) effectiveFrom?: string }
class PolicyDecideBody { @IsBoolean() approve!: boolean; @IsOptional() @IsString() @MaxLength(300) note?: string }

/**
 * COM-3 ops console API: the commission policy page per market (funds-flow counsel sign-off, provider-facing disclosure texts, status of every real-mode gate, history).
 * finance and super admin read; ONLY a super admin proposes; a DIFFERENT super admin approves (enforced by the config service and the database).
 */
@ApiTags('ops')
@Controller('admin/commissions/policy')
export class CommissionPolicyController {
  constructor(private readonly policy: CommissionPolicyService, private readonly rates: CommissionRateService) {}
  private need(u: AuthUser, cap: CommissionCapability) { if (!canCommission(u.roles, cap)) throw new ForbiddenException({ code: 'COMMISSION_ROLE_REQUIRED', message: `Requires one of: ${COMMISSION_ACCESS[cap].join(', ')}` }); }

  @ApiOkResponse(OBJ) @ApiOperation({ summary: 'Markets that have a commission policy record or are known to the platform' }) @Roles(...commissionRolesFor('read')) @Get()
  async markets() { return { markets: await this.policy.markets() }; }

  @ApiOkResponse(OBJ) @ApiOperation({ summary: 'One market: counsel sign-off in force and pending, disclosure texts, every real-mode gate with its reason, history of both records' }) @Roles(...commissionRolesFor('read')) @Get(':market')
  state(@Param('market') market: string) { return this.policy.state(market); }

  @ApiOkResponse(OBJ) @ApiOperation({ summary: 'Propose a new counsel sign-off or disclosure version for a market (maker). A different super admin must approve.' }) @Roles(...commissionRolesFor('proposeConfig')) @Post(':market/propose') @HttpCode(200)
  propose(@CurrentUser() u: AuthUser, @Param('market') market: string, @Body() b: PolicyProposeBody) {
    this.need(u, 'proposeConfig');
    return this.policy.propose({ sub: u.sub, roles: u.roles }, { kind: b.kind, market, payload: b.payload, reason: b.reason, effectiveFrom: b.effectiveFrom });
  }

  @ApiOkResponse(OBJ) @ApiOperation({ summary: 'Approve or reject a proposal (checker: never its author). An approved change in force is pushed to the products.' }) @Roles(...commissionRolesFor('approveConfig')) @Post('versions/:id/decide') @HttpCode(200)
  async decide(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: PolicyDecideBody) {
    this.need(u, 'approveConfig');
    const row = await this.policy.decide({ sub: u.sub, roles: u.roles }, { id, approve: b.approve, note: b.note });
    if (b.approve && (!row.effectiveFrom || row.effectiveFrom.getTime() <= Date.now())) await this.rates.resync(undefined, u.sub); // reaches the organisations' read-only views now; a dated one is queued by the 15-minute job
    return row;
  }
}
