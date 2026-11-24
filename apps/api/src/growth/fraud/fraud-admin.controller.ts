import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AuthUser, CurrentUser, Roles } from '../../common/auth';
import { rolesFor } from '../admin/growth-access';
import { FraudCaseService } from './case.service';
import { FraudCalibrationService, FraudJob } from './calibration.job';
import { FraudConfigService } from './fraud-config.service';
import { FraudReviewQueueService } from './review-queue.service';
import { FRAUD_RULE_IDS } from './signals';

const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;
class FraudAssignBody { @IsString() @MaxLength(80) assignTo!: string }
class FraudDecisionBody {
  @IsIn(['CONFIRM', 'DISMISS']) decision!: 'CONFIRM' | 'DISMISS';
  @IsOptional() @IsString() @MaxLength(300) note?: string;
  @IsOptional() @IsBoolean() reverseRewards?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(730) suspendDays?: number;
}
class FraudAppealBody { @IsString() @MaxLength(300) note!: string }
class FraudAppealDecisionBody { @IsIn(['CONFIRM', 'DISMISS']) decision!: 'CONFIRM' | 'DISMISS'; @IsString() @MaxLength(300) note!: string }
class FraudBulkBody { @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsString({ each: true }) ids!: string[]; @IsString() @MaxLength(300) reason!: string }
class FraudIdentityBody { @IsString() @MaxLength(200) reason!: string }

/**
 * Fraud v2 ops API (GRW-P3-D). Reading needs any growth read role; a decision needs the reviewer role; money-moving confirmations need a second person (enforced in the service); an identity lookup needs
 * the DPO role (super admin alone is not enough) and is audited. Evidence is hashed identifiers and check rows only.
 */
@ApiTags('growth-fraud')
@Roles(...rolesFor('read'))
@Controller('admin/growth/fraud')
export class FraudAdminController {
  constructor(private readonly queue: FraudReviewQueueService, private readonly cases: FraudCaseService, private readonly cal: FraudCalibrationService, private readonly cfg: FraudConfigService, private readonly job: FraudJob) {}

  @Get('cases') @ApiOperation({ summary: 'GRW-P3-D review queue' }) @ApiOkResponse(OBJ)
  list(@Query('status') status?: string, @Query('kind') kind?: string, @Query('band') band?: string, @Query('breached') breached?: string, @Query('take') take?: string) {
    return this.queue.list({ status, kind, band, breached: breached === 'true', take: Number(take) || 50 }).then((rows) => ({ rows }));
  }
  @Get('cases/summary') @ApiOperation({ summary: 'GRW-P3-D open cases by kind, band and mode, and SLA breaches' }) @ApiOkResponse(OBJ)
  summary() { return this.queue.summary(); }
  @Get('cases/:id') @ApiOperation({ summary: 'GRW-P3-D evidence viewer: signals, check rows, decision log (hashed references only)' }) @ApiOkResponse(OBJ)
  one(@Param('id') id: string) { return this.cases.evidence(id); }

  @Roles(...rolesFor('reviewFraud')) @Post('cases/bulk-dismiss') @HttpCode(200) @ApiOperation({ summary: 'GRW-P3-D bulk dismiss LOW and MEDIUM cases with a reason' }) @ApiOkResponse(OBJ)
  async bulk(@CurrentUser() u: AuthUser, @Body() b: FraudBulkBody) { return this.queue.bulkDismiss(b.ids, u.sub, b.reason, await this.cfg.get()); }
  @Roles(...rolesFor('reviewFraud')) @Post('cases/:id/assign') @HttpCode(200) @ApiOperation({ summary: 'GRW-P3-D assign a case' }) @ApiOkResponse(OBJ)
  assign(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: FraudAssignBody) { return this.cases.assign(id, u.sub, b.assignTo); }
  @Roles(...rolesFor('reviewFraud')) @Post('cases/:id/decision') @HttpCode(200) @ApiOperation({ summary: 'GRW-P3-D CONFIRM (reversing reward value needs a second person) or DISMISS' }) @ApiOkResponse(OBJ)
  async decide(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: FraudDecisionBody) { return this.cases.decide(id, u.sub, b, await this.cfg.get()); }
  @Roles(...rolesFor('reviewFraud')) @Post('cases/:id/appeal') @HttpCode(200) @ApiOperation({ summary: 'GRW-P3-D file an appeal for a confirmed case (support, inside the appeal window)' }) @ApiOkResponse(OBJ)
  async appeal(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: FraudAppealBody) { return this.cases.appeal(id, u.sub, b.note, await this.cfg.get()); }
  @Roles(...rolesFor('reviewFraud')) @Post('cases/:id/appeal-decision') @HttpCode(200) @ApiOperation({ summary: 'GRW-P3-D decide an appeal (a different reviewer)' }) @ApiOkResponse(OBJ)
  appealDecision(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: FraudAppealDecisionBody) { return this.cases.redecide(id, u.sub, b); }
  @Roles('dpo') @Post('cases/:id/identity') @HttpCode(200) @ApiOperation({ summary: 'GRW-P3-D account references of a case (DPO role, audited)' }) @ApiOkResponse(OBJ)
  identity(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: FraudIdentityBody) { return this.cases.identity(id, u.sub, b.reason); }

  @Get('rules') @ApiOperation({ summary: 'GRW-P3-D rules, weights, enforce switches and thresholds (read-only; change through the FRAUD_RULES configuration)' }) @ApiOkResponse(OBJ)
  async rules() { const c = await this.cfg.get(); return { ruleIds: FRAUD_RULE_IDS, config: c, editable: false, source: c.version === null ? 'PROPOSED_DEFAULT' : 'ACTIVE' }; }
  @Get('shadow-report') @ApiOperation({ summary: 'GRW-P3-D precision and volume by rule' }) @ApiOkResponse(OBJ)
  shadow(@Query('days') days?: string) { return this.cal.report(Math.min(Math.max(Number(days) || 90, 1), 365)); }
  @Get('fairness') @ApiOperation({ summary: 'GRW-P3-D weekly HOLD rate by language and city (aggregate, k >= 10)' }) @ApiOkResponse(OBJ)
  fairness(@Query('weekStart') weekStart?: string) {
    const d = weekStart && !Number.isNaN(Date.parse(weekStart)) ? new Date(weekStart) : new Date(Date.now() - 7 * 86_400_000);
    return this.cal.fairness(d);
  }
  @Roles(...rolesFor('manage')) @Post('jobs/run') @HttpCode(200) @ApiOperation({ summary: 'GRW-P3-D run the hourly job now (SLA sweep, housekeeping, calibration counts)' }) @ApiOkResponse(OBJ)
  run() { return this.job.run(); }
  @Roles(...rolesFor('manage')) @Post('calibration/propose') @HttpCode(200) @ApiOperation({ summary: 'GRW-P3-D propose weight changes as a draft (never applied)' }) @ApiOkResponse(OBJ)
  propose() { return this.cal.propose(); }
}
