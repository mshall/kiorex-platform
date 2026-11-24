import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Roles } from '../../common/auth';
import { RequiresFlag } from '../../control-plane/control-plane-public';
import { rolesFor } from '../admin/growth-access';
import { GROWTH_FLAG } from '../growth-flags';
import { ModelReportService } from './model-report.service';
import { ModelRollupJob } from './model-rollup.job';

const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;
class RollupBody { @IsOptional() @IsInt() @Min(1) @Max(120) days?: number }
const market = (m?: string) => (m && /^[A-Z]{2}$/.test(m) ? m : 'EG');

/**
 * Reporting attribution models (GRW-P3-B). Reads: every Growth ops role (k >= 10 masked, no person data). A manual recompute is super admin and needs `growth.attribution` ON.
 * Nothing here can change a commission decision: the service has no write path to the decision tables.
 */
@ApiTags('growth-attribution-models')
@Roles(...rolesFor('read'))
@Controller('admin/growth/attribution-models')
export class AttributionModelsController {
  constructor(private readonly reports: ModelReportService, private readonly job: ModelRollupJob) {}
  @Get() @ApiOperation({ summary: 'GRW-P3-B model comparison (all models reconcile to the same total; POSITION_BASED is the default report)' }) @ApiOkResponse(OBJ)
  compare(@Query('market') m?: string, @Query('from') from?: string, @Query('to') to?: string) { return this.reports.compare({ market: market(m), from, to }); }
  @Get('paths') @ApiOperation({ summary: 'GRW-P3-B common conversion paths (hashed ordered source kinds; only paths shared by 10 or more conversions)' }) @ApiOkResponse(OBJ)
  paths(@Query('market') m?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('take') take?: string) { return this.reports.paths({ market: market(m), from, to, take: take ? Number(take) : undefined }); }
  @Get('lift') @ApiOperation({ summary: 'GRW-P3-B experiment-based lift (holdout against exposed) for a P3-A experiment' }) @ApiOkResponse(OBJ)
  lift(@Query('experimentKey') key: string, @Query('market') m?: string) { return this.reports.lift({ experimentKey: String(key ?? '').slice(0, 80), market: market(m) }); }
  @Roles(...rolesFor('manage')) @RequiresFlag(GROWTH_FLAG.ATTRIBUTION) @Post('rollup') @HttpCode(200) @ApiOperation({ summary: 'GRW-P3-B recompute the last N market days (idempotent)' }) @ApiOkResponse(OBJ)
  rollup(@Body() b: RollupBody, @Query('market') m?: string) { return this.job.runOnce(market(m), b.days ?? 3); }
}
