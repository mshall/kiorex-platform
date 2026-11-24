import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, Roles } from '../../common/auth';
import { RequiresFlag } from '../../control-plane/control-plane-public';
import { rolesFor } from '../admin/growth-access';
import { GrowthSpendService } from '../analytics/spend.service';
import { GROWTH_FLAG } from '../growth-flags';
import { AddCreativeDto, CampaignSpendDto, CreateCampaignDto, DecideApprovalDto, RequestApprovalDto, TransitionDto, UpdateCampaignDto } from './campaign-dto';
import { CampaignApprovalService } from './campaign-approval.service';
import { CampaignReportService } from './campaign-report.service';
import { CampaignSchedulerService } from './campaign-scheduler.service';
import { CampaignService, type Actor } from './campaign.service';
import { CampaignBudgetService } from './campaign-budget.service';

const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;
const ARR = { schema: { type: 'array', items: { type: 'object', additionalProperties: true } } } as const;
const user = (u: AuthUser): Actor => ({ sub: u.sub, kind: 'USER' });

/**
 * Campaign management API (GRW-P2-A). Reads: every ops role of the Growth module. Writes: super admin (the same two-person rule as every growth configuration): the creator of an
 * approval request can never decide it. Every write needs the flag `growth.campaigns` ON (403 FEATURE_DISABLED otherwise; reads keep working so nothing is hidden) and is audited.
 * No endpoint here, or anywhere behind it, reaches an external ad platform (AD-1).
 */
@ApiTags('growth-campaigns')
@Roles(...rolesFor('read'))
@Controller('admin/growth/campaigns')
export class CampaignsAdminController {
  constructor(private readonly svc: CampaignService, private readonly approvals: CampaignApprovalService, private readonly report: CampaignReportService, private readonly scheduler: CampaignSchedulerService, private readonly spend: GrowthSpendService, private readonly budget: CampaignBudgetService) {}

  @Get() @ApiOperation({ summary: 'GRW-P2-A list campaigns (filters: status, q, objective, promotional=1)' }) @ApiOkResponse(ARR)
  list(@Query('market') market?: string, @Query('status') status?: string, @Query('q') q?: string, @Query('objective') objective?: string, @Query('promotional') promotional?: string, @Query('take') take?: string) {
    return this.svc.list({ market: market && /^[A-Z]{2}$/.test(market) ? market : undefined, status, q: q?.slice(0, 60), objective, promotional: promotional === '1' || promotional === 'true', take: take ? Number(take) : undefined });
  }
  @Roles(...rolesFor('manageCampaigns')) @RequiresFlag(GROWTH_FLAG.CAMPAIGNS) @Post() @ApiOperation({ summary: 'GRW-P2-A create a campaign plan (DRAFT)' }) @ApiOkResponse(OBJ)
  create(@CurrentUser() u: AuthUser, @Body() b: CreateCampaignDto) { return this.svc.create(user(u), b); }

  @Get('approvals') @ApiOperation({ summary: 'GRW-P2-A approval requests (status=pending|decided)' }) @ApiOkResponse(ARR)
  listApprovals(@Query('status') status?: string, @Query('campaignId') campaignId?: string, @Query('take') take?: string) { return this.approvals.list({ status: status === 'pending' || status === 'decided' ? status : undefined, campaignId, take: take ? Number(take) : undefined }); }
  @Get('approvals/:id') @ApiOperation({ summary: 'GRW-P2-A one approval with the campaign it covers' }) @ApiOkResponse(OBJ)
  getApproval(@Param('id') id: string) { return this.approvals.get(id); }
  @Roles(...rolesFor('manageCampaigns')) @RequiresFlag(GROWTH_FLAG.CAMPAIGNS) @Post('approvals/:id/decide') @HttpCode(200) @ApiOperation({ summary: 'GRW-P2-A approve or reject (never the requester)' }) @ApiOkResponse(OBJ)
  decide(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: DecideApprovalDto) { return this.approvals.decide(user(u), id, b); }
  @Roles(...rolesFor('manageCampaigns')) @RequiresFlag(GROWTH_FLAG.CAMPAIGNS) @Post('scheduler/run') @HttpCode(200) @ApiOperation({ summary: 'GRW-P2-A run the 1-minute scheduler once (idempotent; also what the job does)' }) @ApiOkResponse(OBJ)
  runScheduler() { return this.scheduler.runOnce(); }

  @Get(':id') @ApiOperation({ summary: 'GRW-P2-A one campaign with tracking links, approval state, budget and the transitions possible now' }) @ApiOkResponse(OBJ)
  get(@Param('id') id: string) { return this.svc.get(id); }
  @Roles(...rolesFor('manageCampaigns')) @RequiresFlag(GROWTH_FLAG.CAMPAIGNS) @Patch(':id') @ApiOperation({ summary: 'GRW-P2-A edit (optimistic version; money-relevant edits invalidate an approval)' }) @ApiOkResponse(OBJ)
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: UpdateCampaignDto) { return this.svc.update(user(u), id, b); }
  @Roles(...rolesFor('manageCampaigns')) @RequiresFlag(GROWTH_FLAG.CAMPAIGNS) @Post(':id/transition') @HttpCode(200) @ApiOperation({ summary: 'GRW-P2-A move to another state (409 CAMPAIGN_INVALID_TRANSITION when not allowed)' }) @ApiOkResponse(OBJ)
  transition(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: TransitionDto) {
    return this.svc.transition(user(u), id, b.to, { reasonCode: b.reasonCode, reason: b.reason, pauseReason: b.to === 'PAUSED' ? 'MANUAL' : undefined });
  }
  @Roles(...rolesFor('manageCampaigns')) @RequiresFlag(GROWTH_FLAG.CAMPAIGNS) @Post(':id/approvals') @ApiOperation({ summary: 'GRW-P2-A ask a second person to approve activation, a budget increase or reactivation' }) @ApiOkResponse(OBJ)
  requestApproval(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: RequestApprovalDto) { return this.approvals.request(user(u), id, b); }
  @Get(':id/report') @ApiOperation({ summary: 'GRW-P2-A performance: funnel, spend, utilisation, CPA, CAC, ROAS by day and source (k >= 10); external numbers only from read-only adapters' }) @ApiOkResponse(OBJ)
  getReport(@Param('id') id: string, @Query('from') from?: string, @Query('to') to?: string) { return this.report.report(id, { from, to }); }
  @Get(':id/history') @ApiOperation({ summary: 'GRW-P2-A every state change with actor and reason' }) @ApiOkResponse(ARR)
  history(@Param('id') id: string) { return this.svc.history(id); }
  @Get(':id/creatives') @ApiOperation({ summary: 'GRW-P2-A creative asset references' }) @ApiOkResponse(ARR)
  creatives(@Param('id') id: string) { return this.svc.creatives(id); }
  @Roles(...rolesFor('manageCampaigns')) @RequiresFlag(GROWTH_FLAG.CAMPAIGNS) @Post(':id/creatives') @ApiOperation({ summary: 'GRW-P2-A add a creative REFERENCE (object-store key under the campaign prefix or an allowlisted https URL)' }) @ApiOkResponse(OBJ)
  addCreative(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: AddCreativeDto) { return this.svc.addCreative(user(u), id, b); }
  @Get(':id/spend') @ApiOperation({ summary: 'GRW-P2-A spend lines booked against the campaign, with the daily utilisation' }) @ApiOkResponse(OBJ)
  async spendOf(@Param('id') id: string) { await this.svc.must(id); return { entries: await this.spend.list({ campaignId: id }), daily: await this.budget.daily(id) }; }
  @Roles(...rolesFor('manageCampaigns')) @RequiresFlag(GROWTH_FLAG.CAMPAIGNS) @Post(':id/spend') @ApiOperation({ summary: 'GRW-P2-A enter a spend line for the campaign (PENDING until a different person approves it on the Finance page)' }) @ApiOkResponse(OBJ)
  addSpend(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: CampaignSpendDto) { return this.spend.create(u.sub, { day: b.day, amountMinor: b.amountMinor, note: b.note, campaignId: id }); }
}
