import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Roles } from '../../common/auth';
import { RequiresFlag } from '../../control-plane/control-plane-public';
import { DEFAULT_MARKET } from '../../market/market-core-public';
import { rolesFor } from '../admin/growth-access';
import { growthError } from '../growth-errors';
import { BASES, CohortService } from './cohort.service';
import { CohortRollupJob } from './cohort-rollup.job';
import type { CohortBasis, CohortDimension } from './cohort-builder';

export const COHORTS_FLAG = 'growth.cohorts_ltv';
const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;
class CohortRollupBody { @IsOptional() @IsInt() @Min(1) @Max(60) months?: number }
const market = (m?: string) => (m && /^[A-Z]{2}$/.test(m) ? m : DEFAULT_MARKET);
const basisOf = (b?: string): CohortBasis | undefined => { if (!b) return undefined; if (!(BASES as readonly string[]).includes(b)) throw growthError('GROWTH_INVALID_REQUEST', 'basis must be FIRST_COMPLETED or REGISTRATION'); return b as CohortBasis; };
const dimOf = (d?: string): CohortDimension | undefined => { if (!d) return undefined; if (!['ALL', 'SOURCE', 'CAMPAIGN', 'PLATFORM'].includes(d)) throw growthError('GROWTH_INVALID_REQUEST', 'dimension must be ALL, SOURCE, CAMPAIGN or PLATFORM'); return d as CohortDimension; };
const VALUE = /^[A-Za-z0-9_-]{1,64}$/;
const valueOf = (v?: string) => { if (v === undefined || v === '') return undefined; if (!VALUE.test(v)) throw growthError('GROWTH_INVALID_REQUEST', 'value has an invalid format'); return v; };

/**
 * Cohort analytics and LTV (GRW-P3-C). Aggregates only, k >= 10 masked, no person data in any response. Reads: every Growth ops role. Recompute: super admin. OFF (`growth.cohorts_ltv`)
 * answers 403 FEATURE_DISABLED and hides nothing stored.
 */
@ApiTags('growth-cohorts')
@Roles(...rolesFor('read'))
@RequiresFlag(COHORTS_FLAG)
@Controller('admin/growth/cohorts')
export class CohortsController {
  constructor(private readonly cohorts: CohortService, private readonly job: CohortRollupJob) {}
  @Get() @ApiOperation({ summary: 'GRW-P3-C cohort table (acquisition month by first completed booking or registration; retained, bookings, revenue, reward cost; "<10" masked)' }) @ApiOkResponse(OBJ)
  table(@Query('market') m?: string, @Query('basis') basis?: string, @Query('dimension') dimension?: string, @Query('value') value?: string) { return this.cohorts.table({ market: market(m), basis: basisOf(basis), dimension: dimOf(dimension), value: valueOf(value) }); }
  @Get('retention') @ApiOperation({ summary: 'GRW-P3-C retention curves and heatmap by months since acquisition' }) @ApiOkResponse(OBJ)
  retention(@Query('market') m?: string, @Query('basis') basis?: string, @Query('dimension') dimension?: string, @Query('value') value?: string) { return this.cohorts.retention({ market: market(m), basis: basisOf(basis), dimension: dimOf(dimension), value: valueOf(value) }); }
  @Get('ltv') @ApiOperation({ summary: 'GRW-P3-C LTV estimates with bootstrap intervals (labelled ESTIMATE, with n and horizon)' }) @ApiOkResponse(OBJ)
  ltv(@Query('market') m?: string, @Query('basis') basis?: string) { return this.cohorts.ltv({ market: market(m), basis: basisOf(basis) }); }
  @Get('payback') @ApiOperation({ summary: 'GRW-P3-C blended CAC, payback month per cohort and LTV:CAC with interval' }) @ApiOkResponse(OBJ)
  payback(@Query('market') m?: string, @Query('months') months?: string) { return this.cohorts.payback({ market: market(m), months: months ? Number(months) : undefined }); }
  @Get('values') @ApiOperation({ summary: 'GRW-P3-C the sources, campaigns or platforms that have a stored cohort' }) @ApiOkResponse(OBJ)
  async values(@Query('market') m?: string, @Query('dimension') dimension?: string) { const d = dimOf(dimension) ?? 'SOURCE'; if (d === 'ALL') return { values: [] }; return { values: await this.cohorts.values(market(m), 'FIRST_COMPLETED', d) }; }
  @Get('reconcile') @ApiOperation({ summary: 'GRW-P3-C independent recount of acquired patients and revenue against the stored cells' }) @ApiOkResponse(OBJ)
  reconcile(@Query('market') m?: string) { return this.cohorts.reconcile(market(m)); }
  @Roles(...rolesFor('manage')) @Post('rollup') @HttpCode(200) @ApiOperation({ summary: 'GRW-P3-C recompute cohorts and LTV for the last N months (idempotent)' }) @ApiOkResponse(OBJ)
  rollup(@Body() b: CohortRollupBody, @Query('market') m?: string) { return this.job.runOnce(market(m), b.months ?? 24); }
}
