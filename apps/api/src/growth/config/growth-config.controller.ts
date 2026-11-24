import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { OpsOnly } from '../../common/auth';
import { growthError } from '../growth-errors';
import { GrowthConfigService } from './growth-config.service';

const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;

/** Internal read of the resolved growth configuration (ops only). The maker-checker controllers (create, approve, rollback) belong to package K. */
@ApiTags('growth')
@OpsOnly()
@Controller('growth/config')
export class GrowthConfigController {
  constructor(private readonly svc: GrowthConfigService) {}
  @Get('resolve') @ApiOperation({ summary: 'GRW-P1-B resolved growth config for a kind and market (ACTIVE version, else PROPOSED_DEFAULT)' }) @ApiOkResponse(OBJ)
  @ApiQuery({ name: 'kind', required: true }) @ApiQuery({ name: 'market', required: false }) @ApiQuery({ name: 'at', required: false })
  async resolve(@Query('kind') kind: string, @Query('market') market?: string, @Query('at') at?: string) {
    if (!kind) throw growthError('GROWTH_INVALID_REQUEST', 'kind is required');
    const when = at ? new Date(at) : undefined;
    if (when && Number.isNaN(when.getTime())) throw growthError('GROWTH_INVALID_REQUEST', 'at must be an ISO date-time');
    const r = await this.svc.resolve(kind, { market: market && /^[A-Z]{2}$/.test(market) ? market : undefined, at: when });
    return { kind: r.kind, scope: r.scope, scopeId: r.scopeId, version: r.version, versionId: r.versionId, source: r.source, effectiveFrom: r.effectiveFrom?.toISOString() ?? null, payload: r.payload };
  }
}
