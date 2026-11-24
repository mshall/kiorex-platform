import { Body, Controller, Get, Header, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { AuthUser, CurrentUser, OpsOnly, Public, SuperAdminOnly } from '../../common/auth';
import { badRequest } from '../../common/errors';
import { ipHashOf } from '../../common/privacy-hash';
import { PrismaService } from '../../prisma/prisma.service';
import { RequiresFlag } from '../../control-plane/control-plane-public';
import { GROWTH_FLAG } from '../growth-flags';
import { GrowthLimiter, growthLimits } from '../growth-limiter';
import { GrowthExportService } from './export.service';
import { FILTER_KEYS, GrowthMetricsService, parseFilters, type Audience } from './metrics.service';
import { authenticatePartnerOrg } from './partner-auth';
import { GrowthRollupJob } from './rollup.job';
import { GrowthSpendService } from './spend.service';

const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;
const BREAKDOWNS = FILTER_KEYS.filter((k) => k !== 'country');
const REPORTS = ['overview', 'funnel', 'channels', 'breakdown', 'cohorts'] as const;
const dimOf = (d: string) => { if (!(BREAKDOWNS as readonly string[]).includes(d)) throw badRequest('INVALID_DIMENSION', `dimension must be one of ${BREAKDOWNS.join(', ')}`); return d as (typeof BREAKDOWNS)[number]; };
const reportOf = (r: string) => { const n = r.replace(/\.csv$/, ''); if (!(REPORTS as readonly string[]).includes(n)) throw badRequest('INVALID_REPORT', `report must be one of ${REPORTS.join(', ')}`); return n as (typeof REPORTS)[number]; };

class SpendBody {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) day!: string;
  @IsInt() @Min(1) @Max(1_000_000_000) amountMinor!: number;
  @IsOptional() @IsString() @MaxLength(64) campaign?: string;
  @IsOptional() @IsString() @MaxLength(64) channel?: string;
  @IsOptional() @IsString() @MaxLength(32) sourceKind?: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}
class RollupBody { @IsOptional() @IsInt() @Min(1) @Max(400) days?: number }

/**
 * Ops reporting (GRW-P1-J). Roles: ops_admin and super_admin read; the maker-checker on spend needs two different ops users; a manual rollup is super admin only.
 * Every figure is k >= 10 masked by the service, so a screen, a chart and a CSV of the same query always agree.
 */
@ApiTags('growth')
@OpsOnly()
@Controller('ops/growth-analytics')
export class GrowthAnalyticsOpsController {
  private readonly ops: Audience = { kind: 'OPS' };
  constructor(private readonly metrics: GrowthMetricsService, private readonly exporter: GrowthExportService, private readonly spend: GrowthSpendService, private readonly job: GrowthRollupJob) {}

  @Get('overview') @ApiOperation({ summary: 'GRW-P1-J executive overview (k >= 10; GBV is never revenue)' }) @ApiOkResponse(OBJ)
  overview(@Query() q: Record<string, unknown>) { return this.metrics.overview(parseFilters(q), this.ops); }
  @Get('funnel') @ApiOperation({ summary: 'GRW-P1-J canonical funnel with step and cumulative conversion (k >= 10)' }) @ApiOkResponse(OBJ)
  funnel(@Query() q: Record<string, unknown>) { return this.metrics.funnel(parseFilters(q), this.ops); }
  @Get('channels') @ApiOperation({ summary: 'GRW-P1-J channel table: bookings, ANP, spend, CAC, ROAS, LTV to CAC (k >= 10)' }) @ApiOkResponse(OBJ)
  channels(@Query() q: Record<string, unknown>) { return this.metrics.channels(parseFilters(q), this.ops, q.by === 'campaign' ? ['sourceKind', 'campaign'] : ['sourceKind']); }
  @Get('breakdown/:dimension') @ApiOperation({ summary: 'GRW-P1-J breakdown by city, district, specialty, provider, doctor, branch, campaign, channel, platform, careType, sourceKind or origin (k >= 10)' }) @ApiOkResponse(OBJ)
  breakdown(@Param('dimension') d: string, @Query() q: Record<string, unknown>) { return this.metrics.breakdown(parseFilters(q), this.ops, dimOf(d)); }
  @Get('cohorts') @ApiOperation({ summary: 'GRW-P1-J acquisition cohort retention at 30, 90 and 180 days (closed windows only; k >= 10)' }) @ApiOkResponse(OBJ)
  cohorts(@Query() q: Record<string, unknown>) { const f = parseFilters(q); return this.metrics.cohorts({ market: f.market, origin: f.origin, months: q.months ? Number(q.months) : undefined }, this.ops); }
  @Get('unit-economics') @ApiOperation({ summary: 'GRW-P1-J LTV inputs and definitions' }) @ApiOkResponse(OBJ)
  unit() { return this.metrics.unitEconomics(); }
  @Get('export/:report') @Header('content-type', 'text/csv; charset=utf-8') @Header('content-disposition', 'attachment; filename="growth-report.csv"') @ApiOkResponse({ description: 'CSV text (cells under k = 10 are <10)', schema: { type: 'string' } }) @ApiOperation({ summary: 'GRW-P1-J CSV export with the same k >= 10 masking' })
  csv(@Param('report') r: string, @Query() q: Record<string, unknown>) { return this.exporter.csv(reportOf(r), parseFilters(q), this.ops, { dimension: typeof q.dimension === 'string' ? dimOf(q.dimension) : undefined }); }

  @Get('spend') @ApiOperation({ summary: 'GRW-P1-J spend entries (manual; maker-checker)' }) @ApiOkResponse(OBJ)
  listSpend(@Query('status') status?: string, @Query('from') from?: string, @Query('to') to?: string) { return this.spend.list({ status, from, to }); }
  @Post('spend') @ApiOperation({ summary: 'GRW-P1-J enter a spend line (PENDING until a different ops user approves it)' }) @ApiOkResponse(OBJ)
  createSpend(@CurrentUser() u: AuthUser, @Body() b: SpendBody) { return this.spend.create(u.sub, b); }
  @Post('spend/:id/approve') @HttpCode(200) @ApiOperation({ summary: 'GRW-P1-J approve a spend line (not the author)' }) @ApiOkResponse(OBJ)
  approve(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.spend.decide(u.sub, id, 'APPROVE'); }
  @Post('spend/:id/reject') @HttpCode(200) @ApiOperation({ summary: 'GRW-P1-J reject a spend line (not the author)' }) @ApiOkResponse(OBJ)
  reject(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.spend.decide(u.sub, id, 'REJECT'); }

  @SuperAdminOnly() @Post('rollup') @HttpCode(200) @ApiOperation({ summary: 'GRW-P1-J recompute the daily rollups for the last N days (idempotent)' }) @ApiOkResponse(OBJ)
  rollup(@Body() b: RollupBody) { return this.job.runOnce(b.days ?? 3); }
}

/**
 * Provider reporting (GRW-P1-J): a signed Kiorly Clinic request with `X-Kiorly-Org-Ref`. The organisation is a WHERE clause of every query (never a post-filter), so another
 * organisation's rows cannot appear; Kiorex's own money (revenue, spend, CAC, MER, ROAS, GBV) is not in the provider audience at all. k >= 10 applies here too.
 */
@ApiTags('growth')
@Controller('growth/v1/provider-analytics')
export class GrowthAnalyticsProviderController {
  constructor(private readonly metrics: GrowthMetricsService, private readonly exporter: GrowthExportService, private readonly prisma: PrismaService, private readonly limiter: GrowthLimiter) {}
  private async who(req: Parameters<typeof authenticatePartnerOrg>[0] & { ip?: string }): Promise<Audience> {
    await this.limiter.take('provider-analytics', ipHashOf(req.ip), growthLimits().evidencePerMin);
    return { kind: 'PROVIDER', orgId: await authenticatePartnerOrg(req, this.prisma, 'provider-analytics') };
  }
  @Public() @RequiresFlag(GROWTH_FLAG.ATTRIBUTION) @Get('overview') @ApiOperation({ summary: 'GRW-P1-J provider overview (own organisation, signed partner, k >= 10)' }) @ApiOkResponse(OBJ)
  async overview(@Req() req: never, @Query() q: Record<string, unknown>) { return this.metrics.overview(parseFilters(q), await this.who(req)); }
  @Public() @RequiresFlag(GROWTH_FLAG.ATTRIBUTION) @Get('funnel') @ApiOperation({ summary: 'GRW-P1-J provider booking funnel (own organisation)' }) @ApiOkResponse(OBJ)
  async funnel(@Req() req: never, @Query() q: Record<string, unknown>) { return this.metrics.funnel(parseFilters(q), await this.who(req)); }
  @Public() @RequiresFlag(GROWTH_FLAG.ATTRIBUTION) @Get('channels') @ApiOperation({ summary: 'GRW-P1-J provider channel table (own organisation)' }) @ApiOkResponse(OBJ)
  async channels(@Req() req: never, @Query() q: Record<string, unknown>) { return this.metrics.channels(parseFilters(q), await this.who(req)); }
  @Public() @RequiresFlag(GROWTH_FLAG.ATTRIBUTION) @Get('cohorts') @ApiOperation({ summary: 'GRW-P1-J provider cohort retention (own organisation)' }) @ApiOkResponse(OBJ)
  async cohorts(@Req() req: never, @Query() q: Record<string, unknown>) { const f = parseFilters(q); return this.metrics.cohorts({ market: f.market, origin: f.origin }, await this.who(req)); }
  @Public() @RequiresFlag(GROWTH_FLAG.ATTRIBUTION) @Get('export/:report') @Header('content-type', 'text/csv; charset=utf-8') @ApiOkResponse({ description: 'CSV text (cells under k = 10 are <10)', schema: { type: 'string' } }) @ApiOperation({ summary: 'GRW-P1-J provider CSV export (same masking)' })
  async csv(@Req() req: never, @Param('report') r: string, @Query() q: Record<string, unknown>) { return this.exporter.csv(reportOf(r), parseFilters(q), await this.who(req), { dimension: typeof q.dimension === 'string' ? dimOf(q.dimension) : undefined }); }
}
