import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, Roles } from '../../common/auth';
import { badRequest } from '../../common/errors';
import { can, rolesFor } from '../admin/growth-access';
import { ChannelPerformanceService } from '../analytics/channel-performance.service';
import { growthError } from '../growth-errors';
import { IntegrationService, isKind } from './integration.service';

const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;
const marketOf = (m?: string) => (m && /^[A-Z]{2}$/.test(m) ? m : 'EG');

/**
 * Integration management and advanced acquisition analytics (GRW-P2-F). Reads: every Growth ops role. Pulls: super admin; a `real` pull needs a second super admin. Nothing here accepts or returns a secret:
 * configuration is edited through the INTEGRATION config kind (maker-checker) and only `secretRef` names exist.
 */
@ApiTags('growth-integrations')
@Roles(...rolesFor('read'))
@Controller('admin/growth')
export class IntegrationsAdminController {
  constructor(private readonly svc: IntegrationService, private readonly perf: ChannelPerformanceService) {}

  @Get('integration-status') @ApiOperation({ summary: 'GRW-P2-F status, mode, circuit, last run, secretRef presence (boolean) per integration' }) @ApiOkResponse(OBJ)
  status(@Query('market') market?: string) { return this.svc.status(marketOf(market)); }

  @Get('integration-runs') @ApiOperation({ summary: 'GRW-P2-F run history (kind filter)' }) @ApiOkResponse({ schema: { type: 'array', items: { type: 'object', additionalProperties: true } } })
  runs(@Query('market') market?: string, @Query('kind') kind?: string, @Query('take') take?: string) { return this.svc.runs(marketOf(market), kind, take ? Number(take) : 50); }

  @Roles(...rolesFor('manage')) @Post('integrations/:kind/test') @HttpCode(200) @ApiOperation({ summary: 'GRW-P2-F health check (mock: synthetic OK; real: secret resolves, no upstream call)' }) @ApiOkResponse(OBJ)
  async test(@Param('kind') kind: string, @Query('market') market?: string) {
    if (!isKind(kind)) throw growthError('GROWTH_INVALID_REQUEST', 'Unknown integration kind');
    const s = await this.svc.setting(kind, marketOf(market)); const h = await this.svc.adapter(kind, s).health();
    return { kind, mode: s.mode, ok: h.ok, detail: h.detail };
  }

  @Roles(...rolesFor('manage')) @Post('integrations/:kind/run') @HttpCode(200) @ApiOperation({ summary: 'GRW-P2-F pull now. Mock: direct. Real: needs { requestId } of a request made by another super admin' }) @ApiOkResponse(OBJ)
  async run(@CurrentUser() u: AuthUser, @Param('kind') kind: string, @Body() b: { market?: string; from?: string; to?: string; requestId?: string }) {
    if (!isKind(kind)) throw growthError('GROWTH_INVALID_REQUEST', 'Unknown integration kind');
    const market = marketOf(b?.market); const s = await this.svc.setting(kind, market);
    if (s.mode === 'real') { if (!b?.requestId) throw badRequest('CONFIRMATION_REQUIRED', 'A real pull needs a request confirmed by a second super admin'); return this.svc.confirmRealRun(u.sub, kind, b.requestId); }
    return this.svc.run(kind, { market, from: b?.from, to: b?.to, trigger: 'MANUAL', actor: u.sub });
  }

  @Roles(...rolesFor('manage')) @Post('integrations/:kind/run-requests') @ApiOperation({ summary: 'GRW-P2-F ask for a real pull (first person of two)' }) @ApiOkResponse(OBJ)
  async request(@CurrentUser() u: AuthUser, @Param('kind') kind: string, @Body() b: { market?: string; from?: string; to?: string }) {
    if (!isKind(kind)) throw growthError('GROWTH_INVALID_REQUEST', 'Unknown integration kind');
    return this.svc.requestRealRun(u.sub, kind, marketOf(b?.market), b?.from, b?.to);
  }

  @Get('channel-performance') @ApiOperation({ summary: 'GRW-P2-F channel and campaign performance: external numbers beside first-party facts, CAC, blended CAC, ROAS, MER (k >= 10, spend floor)' }) @ApiOkResponse(OBJ)
  performance(@CurrentUser() u: AuthUser, @Query('market') market?: string, @Query('from') from?: string, @Query('to') to?: string) { return this.perf.report({ market: marketOf(market), from, to, includeRevenue: can(u.roles, 'readFinance') }); }
}
