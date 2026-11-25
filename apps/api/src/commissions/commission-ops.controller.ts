import { Body, Controller, ForbiddenException, Get, Header, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { badRequest } from '../common/errors';
import { COMMISSION_ACCESS, canCommission, commissionCapabilitiesOf, commissionRolesFor, type CommissionCapability } from './commission-access';
import { CommissionCollectionService } from './commission-collection.service';
import { CommissionConfigService } from './commission-config.service';
import { CommissionQueryService, EXPORT_VIEWS, type ExportView, type Filter } from './commission-query.service';

const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;
class CommissionProposeBody { @IsIn(['MARKET', 'ORG']) scope!: 'MARKET' | 'ORG'; @IsString() @Matches(/^[A-Za-z0-9_-]{2,64}$/) scopeRef!: string; @IsObject() settings!: Record<string, unknown>; @IsOptional() @IsString() @MaxLength(300) note?: string }
class CommissionDecideBody { @IsBoolean() approve!: boolean; @IsOptional() @IsString() @MaxLength(300) note?: string }
class CommissionProviderBody { @IsString() @Matches(/^[A-Za-z]{2}$/) market!: string; @IsString() @MaxLength(20) provider!: string }
class CommissionMethodBody { @IsString() @MaxLength(20) provider!: string; @IsString() @MaxLength(120) tokenRef!: string; @IsOptional() @IsString() @MaxLength(20) brand?: string; @IsOptional() @IsString() @Matches(/^\d{4}$/) last4?: string }
class CommissionPaidBody { @IsString() @MaxLength(100) providerRef!: string; @IsOptional() @IsInt() @Min(1) @Max(2_000_000_000) amountMinor?: number }
class CommissionTriggerBody { @IsOptional() @IsString() @Matches(/^[A-Za-z0-9_-]{3,64}$/) orgRef?: string }

/** Platform finance console API (COM-1). Roles per capability table `commission-access.ts`; ops_admin alone sees no money. Every read is across ALL organisations; the provider side never uses this controller. */
@ApiTags('ops')
@Controller('admin/commissions')
export class CommissionOpsController {
  constructor(private readonly q: CommissionQueryService, private readonly cfg: CommissionConfigService, private readonly run: CommissionCollectionService) {}

  private need(u: AuthUser, cap: CommissionCapability) { if (!canCommission(u.roles, cap)) throw new ForbiddenException({ code: 'COMMISSION_ROLE_REQUIRED', message: `Requires one of: ${COMMISSION_ACCESS[cap].join(', ')}` }); }
  private filter(q: Record<string, string | undefined>): Filter { return { orgRef: q.org, market: q.market, status: q.status, collectionStatus: q.collection, periodKey: q.period, from: q.from, to: q.to }; }

  @ApiOkResponse(OBJ) @Roles('ops_admin', 'super_admin', 'finance') @Get('capabilities')
  caps(@CurrentUser() u: AuthUser) { return commissionCapabilitiesOf(u.roles); }

  @ApiOkResponse(OBJ) @Roles(...commissionRolesFor('read')) @Get('summary')
  summary(@Query() q: Record<string, string>) { return this.q.summary(this.filter(q)); }
  @ApiOkResponse(OBJ) @Roles(...commissionRolesFor('read')) @Get('claims')
  claims(@Query() q: Record<string, string>) { return this.q.claims(this.filter(q), { page: Number(q.page) || 1, pageSize: Number(q.pageSize) || 50 }); }
  @ApiOkResponse(OBJ) @Roles(...commissionRolesFor('read')) @Get('claims/:id')
  claim(@Param('id') id: string) { return this.q.claim(id); }
  @ApiOkResponse(OBJ) @Roles(...commissionRolesFor('read')) @Get('runs')
  runs(@Query() q: Record<string, string>) { return this.q.runs(this.filter(q), { page: Number(q.page) || 1, pageSize: Number(q.pageSize) || 50 }); }
  @ApiOkResponse(OBJ) @Roles(...commissionRolesFor('read')) @Get('runs/:id')
  runOne(@Param('id') id: string) { return this.q.run(id); }
  @ApiOkResponse(OBJ) @Roles(...commissionRolesFor('read')) @Get('deductions')
  deductions(@Query() q: Record<string, string>) { return this.q.deductions(this.filter(q), { page: Number(q.page) || 1 }); }
  @ApiOkResponse(OBJ) @Roles(...commissionRolesFor('read')) @Get('aging')
  aging(@Query() q: Record<string, string>) { return this.q.aging(this.filter(q)); }
  @ApiOkResponse(OBJ) @Roles(...commissionRolesFor('read')) @Get('disputes')
  disputes(@Query() q: Record<string, string>) { return this.q.disputes(this.filter(q), { page: Number(q.page) || 1 }); }
  @ApiOkResponse(OBJ) @Roles(...commissionRolesFor('read')) @Get('orgs')
  orgs(@Query() q: Record<string, string>) { return this.q.orgs(this.filter(q)); }
  @ApiOkResponse(OBJ) @Roles(...commissionRolesFor('read')) @Get('orgs/:orgRef')
  org(@Param('orgRef') orgRef: string) { return this.q.org(orgRef); }
  @ApiOkResponse(OBJ) @Roles(...commissionRolesFor('read')) @Get('reconciliation')
  recon(@Query() q: Record<string, string>) { return this.q.reconciliation(this.filter(q)); }
  @ApiOkResponse(OBJ) @Roles(...commissionRolesFor('read')) @Get('timeline')
  timeline(@Query('org') org?: string) { return this.q.timeline(org); }
  @ApiOkResponse(OBJ) @Roles(...commissionRolesFor('read')) @Get('config')
  config(@Query('scope') scope?: string, @Query('scopeRef') scopeRef?: string) { return this.cfg.list({ scope, scopeRef }); }
  @ApiOkResponse(OBJ) @Roles(...commissionRolesFor('read')) @Get('export-audit')
  audits() { return this.q.exportAudits(); }

  @ApiOperation({ summary: 'CSV export of one view (audited: who, filter, rows)' }) @Roles(...commissionRolesFor('export')) @Get('export/:view')
  @Header('content-type', 'text/csv; charset=utf-8')
  async export(@CurrentUser() u: AuthUser, @Param('view') view: string, @Query() q: Record<string, string>, @Res({ passthrough: true }) res: { setHeader(k: string, v: string): void }) {
    if (!(EXPORT_VIEWS as readonly string[]).includes(view)) throw badRequest('UNKNOWN_VIEW', 'Unknown export view');
    const r = await this.q.exportCsv(view as ExportView, this.filter(q), u.sub);
    res.setHeader('content-disposition', `attachment; filename="${r.filename}"`);
    return r.csv;
  }

  @ApiOkResponse(OBJ) @Roles(...commissionRolesFor('proposeConfig')) @Post('config') @HttpCode(200)
  propose(@CurrentUser() u: AuthUser, @Body() b: CommissionProposeBody) { return this.cfg.propose({ ...b, actor: u.sub }); }
  @ApiOkResponse(OBJ) @Roles(...commissionRolesFor('approveConfig')) @Post('config/:id/decide') @HttpCode(200)
  decide(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: CommissionDecideBody) { return this.cfg.decide({ id, approve: b.approve, note: b.note, actor: u.sub }); }
  @ApiOkResponse(OBJ) @Roles(...commissionRolesFor('chooseProvider')) @Put('orgs/:orgRef/provider')
  provider(@CurrentUser() u: AuthUser, @Param('orgRef') orgRef: string, @Body() b: CommissionProviderBody) { return this.cfg.chooseProvider({ orgRef, market: b.market, provider: b.provider, actor: u.sub }); }
  @ApiOkResponse(OBJ) @Roles(...commissionRolesFor('chooseProvider')) @Post('orgs/:orgRef/saved-method') @HttpCode(200)
  method(@CurrentUser() u: AuthUser, @Param('orgRef') orgRef: string, @Body() b: CommissionMethodBody) { return this.run.saveMethod({ orgRef, ...b, actor: u.sub }); }

  @ApiOkResponse(OBJ) @Roles(...commissionRolesFor('operate')) @Post('runs/trigger') @HttpCode(200)
  trigger(@CurrentUser() u: AuthUser, @Body() b: CommissionTriggerBody) { return b.orgRef ? this.run.runForOrg(b.orgRef, new Date(), u.sub).then((o) => ({ outcomes: [o] })) : this.run.runDue(new Date(), u.sub); }
  @ApiOkResponse(OBJ) @Roles(...commissionRolesFor('operate')) @Post('runs/:id/retry') @HttpCode(200)
  async retry(@CurrentUser() u: AuthUser, @Param('id') id: string) { await this.run.retryNow(id, u.sub); return this.q.run(id); }
  @ApiOkResponse(OBJ) @Roles(...commissionRolesFor('operate')) @Post('runs/:id/invoice-paid') @HttpCode(200)
  paid(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: CommissionPaidBody) { return this.run.markInvoicePaid({ runId: id, providerRef: b.providerRef, amountMinor: b.amountMinor, actor: u.sub }); }
}
