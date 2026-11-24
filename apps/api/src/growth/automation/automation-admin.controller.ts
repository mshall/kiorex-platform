import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, Roles } from '../../common/auth';
import { RequiresFlag } from '../../control-plane/control-plane-public';
import { rolesFor } from '../admin/growth-access';
import { AUTOMATION_FLAG } from './automation-flags';
import { AutomationJob } from './automation.job';
import { JourneyDefinitionService, type Actor } from './journey-definition.service';

const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;
const ARR = { schema: { type: 'array', items: { type: 'object', additionalProperties: true } } } as const;
const actor = (u: AuthUser): Actor => ({ sub: u.sub, kind: 'USER' });
const num = (v: unknown, d: number) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

/**
 * Marketing automation admin API (GRW-P3-E). Reads: every Growth ops role. Writes: super admin, behind `growth.automation_journeys` (403 FEATURE_DISABLED when OFF; reads, retire and
 * the kill switch keep working: stopping a journey must always be possible). Publishing is maker-checker (the approver is not the author). No endpoint sends a message.
 */
@ApiTags('growth-automation')
@Roles(...rolesFor('read'))
@Controller('admin/growth/automation')
export class AutomationAdminController {
  constructor(private readonly svc: JourneyDefinitionService, private readonly job: AutomationJob) {}

  @Get('catalog') @ApiOperation({ summary: 'GRW-P3-E the closed vocabulary of the builder: node types, trigger events, templates with their class, channels, attributes and the policy numbers' }) @ApiOkResponse(OBJ)
  catalog() { return this.svc.catalog(); }
  @Get('status') @ApiOperation({ summary: 'GRW-P3-E banner facts: automation switch and the marketing licence flag status' }) @ApiOkResponse(OBJ)
  status(@Query('market') market?: string) { return this.svc.status(market && /^[A-Z]{2}$/.test(market) ? market : undefined); }
  @Post('validate') @HttpCode(200) @ApiOperation({ summary: 'GRW-P3-E validate and compile an unsaved graph (the builder calls it on every change); writes nothing' }) @ApiOkResponse(OBJ)
  validate(@Body() b: { graph?: unknown; market?: string }) { return this.svc.preview(b?.graph, { market: b?.market && /^[A-Z]{2}$/.test(b.market) ? b.market : undefined }); }
  @Post('dry-run') @HttpCode(200) @ApiOperation({ summary: 'GRW-P3-E dry run of an unsaved graph on a synthetic cohort: volumes and gate decisions, nobody is read or sent anything' }) @ApiOkResponse(OBJ)
  dryRun(@Body() b: { graph?: unknown; market?: string; size?: number; seed?: number }) { return this.svc.dryRunGraph(b?.graph, b?.market && /^[A-Z]{2}$/.test(b.market) ? b.market : 'EG', { size: b?.size === undefined ? undefined : num(b.size, 1000), seed: b?.seed === undefined ? undefined : num(b.seed, 1) }); }

  @Get('journeys') @ApiOperation({ summary: 'GRW-P3-E list journey definitions' }) @ApiOkResponse(ARR)
  list(@Query('market') market?: string, @Query('status') status?: string, @Query('take') take?: string) { return this.svc.list({ market: market && /^[A-Z]{2}$/.test(market) ? market : undefined, status, take: take ? num(take, 100) : undefined }); }
  @Get('journeys/:id') @ApiOperation({ summary: 'GRW-P3-E one definition with its compiled steps, counts per day and active enrolments (counts only)' }) @ApiOkResponse(OBJ)
  get(@Param('id') id: string) { return this.svc.get(id); }
  @Post('journeys/:id/dry-run') @HttpCode(200) @ApiOperation({ summary: 'GRW-P3-E dry run of a saved journey' }) @ApiOkResponse(OBJ)
  dryRunSaved(@Param('id') id: string, @Body() b: { size?: number; seed?: number }) { return this.svc.dryRunSaved(id, { size: b?.size === undefined ? undefined : num(b.size, 1000), seed: b?.seed === undefined ? undefined : num(b.seed, 1) }); }

  @Roles(...rolesFor('manageCampaigns')) @RequiresFlag(AUTOMATION_FLAG) @Post('journeys') @ApiOperation({ summary: 'GRW-P3-E create a draft; 422 JOURNEY_INVALID lists every error with a code and a path' }) @ApiOkResponse(OBJ)
  create(@CurrentUser() u: AuthUser, @Body() b: { key?: unknown; name?: unknown; graph?: unknown; market?: unknown }) { return this.svc.create(actor(u), b ?? {}); }
  @Roles(...rolesFor('manageCampaigns')) @RequiresFlag(AUTOMATION_FLAG) @Patch('journeys/:id') @ApiOperation({ summary: 'GRW-P3-E edit a draft (a published journey is immutable)' }) @ApiOkResponse(OBJ)
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: { name?: unknown; graph?: unknown }) { return this.svc.update(actor(u), id, b ?? {}); }
  @Roles(...rolesFor('manageCampaigns')) @RequiresFlag(AUTOMATION_FLAG) @Post('journeys/:id/submit') @HttpCode(200) @ApiOperation({ summary: 'GRW-P3-E submit a draft for approval' }) @ApiOkResponse(OBJ)
  submit(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.submit(actor(u), id); }
  @Roles(...rolesFor('manageCampaigns')) @RequiresFlag(AUTOMATION_FLAG) @Post('journeys/:id/approve') @HttpCode(200) @ApiOperation({ summary: 'GRW-P3-E a DIFFERENT super admin approves and publishes (two-person rule); the previous version of the key is retired' }) @ApiOkResponse(OBJ)
  approve(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.approve(actor(u), id); }
  @Roles(...rolesFor('manageCampaigns')) @RequiresFlag(AUTOMATION_FLAG) @Post('journeys/:id/reject') @HttpCode(200) @ApiOperation({ summary: 'GRW-P3-E a different super admin sends a pending journey back to draft' }) @ApiOkResponse(OBJ)
  reject(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: { reason?: string }) { return this.svc.reject(actor(u), id, b?.reason ?? ''); }
  @Roles(...rolesFor('manageCampaigns')) @Post('journeys/:id/retire') @HttpCode(200) @ApiOperation({ summary: 'GRW-P3-E retire a published journey (running enrolments end with RETIRED; never flag-gated)' }) @ApiOkResponse(OBJ)
  retire(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.retire(actor(u), id); }
  @Roles(...rolesFor('manageCampaigns')) @Post('journeys/:id/kill') @HttpCode(200) @ApiOperation({ summary: 'GRW-P3-E per-journey kill switch: the next evaluation of every enrolment ends it with KILLED (never flag-gated, one person suffices)' }) @ApiOkResponse(OBJ)
  kill(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: { reason?: string }) { return this.svc.kill(actor(u), id, b?.reason ?? ''); }
  @Roles(...rolesFor('manageCampaigns')) @Post('scan') @HttpCode(200) @ApiOperation({ summary: 'GRW-P3-E run the trigger scan once (idempotent; also what the job does)' }) @ApiOkResponse(OBJ)
  scan() { return this.job.runOnce(); }
}
