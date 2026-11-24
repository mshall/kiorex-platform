import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, Roles } from '../../common/auth';
import { rolesFor } from '../admin/growth-access';
import { RecommendationService, type Actor } from './recommendation.service';

const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;
const ARR = { schema: { type: 'array', items: { type: 'object', additionalProperties: true } } } as const;
const actor = (u: AuthUser): Actor => ({ sub: u.sub, kind: 'USER', roles: u.roles });
const mk = (m?: string) => (m && /^[A-Z]{2}$/.test(m) ? m : undefined);

/**
 * Recommendations admin API (GRW-P3-E). Reads: every Growth ops role. Generate, decide and feedback: super admin, behind `growth.ai_recommendations` (403 FEATURE_DISABLED when OFF,
 * reads keep working). There is no endpoint that applies a recommendation: approval creates a DRAFT for the normal maker-checker path.
 */
@ApiTags('growth-recommendations')
@Roles(...rolesFor('read'))
@Controller('admin/growth/recommendations')
export class RecommendationsAdminController {
  constructor(private readonly svc: RecommendationService) {}

  @Get('catalog') @ApiOperation({ summary: 'GRW-P3-E the closed vocabulary of recommendation kinds, the policy numbers and the model mode' }) @ApiOkResponse(OBJ)
  catalog() { return this.svc.catalog(); }
  @Get() @ApiOperation({ summary: 'GRW-P3-E list recommendations (market, status, kind filters); expired ones are marked EXPIRED first' }) @ApiOkResponse(ARR)
  list(@Query('market') market?: string, @Query('status') status?: string, @Query('kind') kind?: string, @Query('take') take?: string) { return this.svc.list({ market: mk(market), status, kind, take: take ? Number(take) || undefined : undefined }); }
  @Get(':id') @ApiOperation({ summary: 'GRW-P3-E one recommendation with its evidence references and rationale in both languages' }) @ApiOkResponse(OBJ)
  get(@Param('id') id: string) { return this.svc.get(id); }

  @Roles(...rolesFor('manageCampaigns')) @Post('run') @HttpCode(200) @ApiOperation({ summary: 'GRW-P3-E build proposals from the aggregates now (idempotent per open fingerprint; also what the daily job does)' }) @ApiOkResponse(OBJ)
  async run(@CurrentUser() u: AuthUser, @Body() b: { market?: string }) { const m = mk(b?.market) ?? 'EG'; await this.svc.assertOn(m); return this.svc.generate(actor(u), m); }
  @Roles(...rolesFor('manageCampaigns')) @Post(':id/decision') @HttpCode(200) @ApiOperation({ summary: 'GRW-P3-E APPROVE (creates at most a DRAFT) or REJECT (reason required) a PROPOSED recommendation' }) @ApiOkResponse(OBJ)
  decide(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: { decision?: string; note?: string }) { return this.svc.decide(actor(u), id, b?.decision, b?.note); }
  @Roles(...rolesFor('manageCampaigns')) @Post(':id/feedback') @HttpCode(200) @ApiOperation({ summary: 'GRW-P3-E reviewer feedback (USEFUL or NOT_USEFUL), stored for evaluation' }) @ApiOkResponse(OBJ)
  feedback(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: { value?: string }) { return this.svc.feedback(actor(u), id, b?.value); }
}
