import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, Roles } from '../../common/auth';
import { RequiresFlag } from '../../control-plane/control-plane-public';
import { rolesFor } from '../admin/growth-access';
import { GROWTH_FLAG } from '../growth-flags';
import { ExperimentEvaluatorJob } from './experiment-evaluator.job';
import { ExperimentService, type Actor } from './experiment.service';
import { EXPERIMENT_POLICY, METRICS } from './experiment.types';
import { SURFACES } from './surfaces';

const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;
const ARR = { schema: { type: 'array', items: { type: 'object', additionalProperties: true } } } as const;
const actor = (u: AuthUser): Actor => ({ sub: u.sub, kind: 'USER' });

/**
 * Experiments admin API (GRW-P3-A). Reads: every Growth ops role. Writes: super admin (two-person rule: the author cannot approve), behind the flag `growth.experiments`
 * (403 FEATURE_DISABLED when OFF, reads keep working). STOP and ARCHIVE are never flag-gated: ending an experiment must always be possible. Ship-winner records a proposal only.
 */
@ApiTags('growth-experiments')
@Roles(...rolesFor('read'))
@Controller('admin/growth/experiments')
export class ExperimentsAdminController {
  constructor(private readonly svc: ExperimentService, private readonly job: ExperimentEvaluatorJob) {}

  @Get() @ApiOperation({ summary: 'GRW-P3-A list experiments (status, surface, market filters)' }) @ApiOkResponse(ARR)
  list(@Query('market') market?: string, @Query('status') status?: string, @Query('surface') surface?: string, @Query('take') take?: string) { return this.svc.list({ market: market && /^[A-Z]{2}$/.test(market) ? market : undefined, status, surface, take: take ? Number(take) : undefined }); }

  @Get('catalog') @ApiOperation({ summary: 'GRW-P3-A the closed allowlist of surfaces, the metric registry and the policy defaults' }) @ApiOkResponse(OBJ)
  catalog() { return { surfaces: SURFACES, metrics: METRICS, policy: EXPERIMENT_POLICY }; }

  @Roles(...rolesFor('manageExperiments')) @RequiresFlag(GROWTH_FLAG.EXPERIMENTS) @Post() @ApiOperation({ summary: 'GRW-P3-A create an experiment (DRAFT); 422 EXPERIMENT_SURFACE_FORBIDDEN outside the allowlist' }) @ApiOkResponse(OBJ)
  create(@CurrentUser() u: AuthUser, @Body() b: unknown) { return this.svc.create(actor(u), b); }

  @Get(':id') @ApiOperation({ summary: 'GRW-P3-A one experiment with its history and the latest result (redacted while SRM or a blocker stands)' }) @ApiOkResponse(OBJ)
  get(@Param('id') id: string) { return this.svc.get(id); }
  @Get(':id/history') @ApiOperation({ summary: 'GRW-P3-A append-only history: config diffs, state changes, stop reasons' }) @ApiOkResponse(ARR)
  history(@Param('id') id: string) { return this.svc.history(id); }
  @Get(':id/results') @ApiOperation({ summary: 'GRW-P3-A result snapshots, newest first' }) @ApiOkResponse(ARR)
  results(@Param('id') id: string) { return this.svc.results(id); }

  @Roles(...rolesFor('manageExperiments')) @RequiresFlag(GROWTH_FLAG.EXPERIMENTS) @Patch(':id') @ApiOperation({ summary: 'GRW-P3-A edit a DRAFT (the design is frozen once submitted)' }) @ApiOkResponse(OBJ)
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: unknown) { return this.svc.update(actor(u), id, b); }
  @Roles(...rolesFor('manageExperiments')) @RequiresFlag(GROWTH_FLAG.EXPERIMENTS) @Post(':id/submit') @HttpCode(200) @ApiOperation({ summary: 'GRW-P3-A submit for approval' }) @ApiOkResponse(OBJ)
  submit(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.submit(actor(u), id); }
  @Roles(...rolesFor('manageExperiments')) @RequiresFlag(GROWTH_FLAG.EXPERIMENTS) @Post(':id/approve') @HttpCode(200) @ApiOperation({ summary: 'GRW-P3-A a DIFFERENT super admin approves and starts the experiment' }) @ApiOkResponse(OBJ)
  approve(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.approveAndStart(actor(u), id); }
  @Roles(...rolesFor('manageExperiments')) @Post(':id/stop') @HttpCode(200) @ApiOperation({ summary: 'GRW-P3-A stop with a reason; every unit returns to control at once (never flag-gated)' }) @ApiOkResponse(OBJ)
  stop(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: { reason?: string }) { return this.svc.stop(actor(u), id, b?.reason ?? ''); }
  @Roles(...rolesFor('manageExperiments')) @Post(':id/archive') @HttpCode(200) @ApiOperation({ summary: 'GRW-P3-A archive a stopped or concluded experiment' }) @ApiOkResponse(OBJ)
  archive(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.archive(actor(u), id); }
  @Roles(...rolesFor('manageExperiments')) @RequiresFlag(GROWTH_FLAG.EXPERIMENTS) @Post(':id/ship-winner') @HttpCode(200) @ApiOperation({ summary: 'GRW-P3-A record a ship-winner PROPOSAL (never applied automatically; a human uses the existing maker-checker)' }) @ApiOkResponse(OBJ)
  ship(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.shipWinner(actor(u), id); }
  @Roles(...rolesFor('manageExperiments')) @Post('evaluator/run') @HttpCode(200) @ApiOperation({ summary: 'GRW-P3-A run the hourly evaluator once (idempotent; also what the job does)' }) @ApiOkResponse(OBJ)
  run() { return this.job.runOnce(); }
}
