import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { MarketCreateBody, MarketLegalBody, MarketRequestDecisionBody, MarketSecondApproverBody, MarketTaxPackBody, MarketTransitionBody, RequestStatusQuery } from './kiorly-markets.dto';
import { KiorlyMarketsService } from './kiorly-markets.service';

const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;

/**
 * Kiorly admin edition, Market launch (ADR-060): the Kiorly markets are owned by the Clinic; this is the audited, role-gated door to them.
 * `ops_admin` and `super_admin` read; ONLY `super_admin` changes (Kiorly ops is read-only). The Kiorex market state of the same country is added read-only.
 */
@ApiTags('ops')
@Controller('admin/kiorly-markets')
export class KiorlyMarketsController {
  constructor(private readonly svc: KiorlyMarketsService) {}

  @ApiOkResponse(OBJ) @ApiOperation({ summary: 'Kiorly markets (Clinic Market table) with readiness and the read-only Kiorex state of the same country; canChange tells the console whether the caller may change anything' })
  @Roles('ops_admin', 'super_admin') @Get()
  list(@CurrentUser() u: AuthUser) { return this.svc.list(u); }

  @ApiOkResponse(OBJ) @ApiOperation({ summary: 'Per-country starting values for the initiate-country-launch form' })
  @Roles('ops_admin', 'super_admin') @Get('country-defaults')
  defaults() { return this.svc.defaults(); }

  @ApiOkResponse(OBJ) @ApiOperation({ summary: 'One market with readiness, legal and commercial summaries' })
  @Roles('ops_admin', 'super_admin') @Get(':id')
  one(@Param('id') id: string) { return this.svc.one(id); }

  @ApiOkResponse(OBJ) @ApiOperation({ summary: 'Append-only market audit trail (newest first, paged with ?before)' })
  @Roles('ops_admin', 'super_admin') @Get(':id/audit')
  audit(@Param('id') id: string, @Query('limit') limit?: string, @Query('before') before?: string) { return this.svc.audit(id, { limit, before }); }

  @ApiOkResponse(OBJ) @ApiOperation({ summary: 'Second-approver requests of the market' })
  @Roles('ops_admin', 'super_admin') @Get(':id/change-requests')
  requests(@Param('id') id: string, @Query() q: RequestStatusQuery) { return this.svc.requests(id, q.status); }

  @ApiOkResponse(OBJ) @ApiOperation({ summary: 'Initiate a country launch (draft market)' })
  @Roles('super_admin') @Post() @HttpCode(201)
  create(@CurrentUser() u: AuthUser, @Body() b: MarketCreateBody) { return this.svc.create(u, b); }

  @ApiOkResponse(OBJ) @Roles('super_admin') @Post(':id/launch') @HttpCode(200)
  launch(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: MarketTransitionBody) { return this.svc.transition(u, id, 'launch', b); }
  @ApiOkResponse(OBJ) @Roles('super_admin') @Post(':id/pause') @HttpCode(200)
  pause(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: MarketTransitionBody) { return this.svc.transition(u, id, 'pause', b); }
  @ApiOkResponse(OBJ) @Roles('super_admin') @Post(':id/disable') @HttpCode(200)
  disable(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: MarketTransitionBody) { return this.svc.transition(u, id, 'disable', b); }
  @ApiOkResponse(OBJ) @Roles('super_admin') @Post(':id/enable') @HttpCode(200)
  enable(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: MarketTransitionBody) { return this.svc.transition(u, id, 'enable', b); }

  @ApiOkResponse(OBJ) @ApiOperation({ summary: 'Tax pack prerequisite (invoice VAT, subscription VAT, default visit fee)' })
  @Roles('super_admin') @Put(':id/tax-pack')
  taxPack(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: MarketTaxPackBody) { return this.svc.taxPack(u, id, b); }

  @ApiOkResponse(OBJ) @ApiOperation({ summary: 'Legal prerequisite (cross-border approval, legal pilot exception)' })
  @Roles('super_admin') @Put(':id/legal-config')
  legal(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: MarketLegalBody) { return this.svc.legal(u, id, b); }

  @ApiOkResponse(OBJ) @ApiOperation({ summary: 'Turn the optional second-approver rule on or off' })
  @Roles('super_admin') @Patch(':id/second-approver')
  second(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: MarketSecondApproverBody) { return this.svc.secondApprover(u, id, b); }

  @ApiOkResponse(OBJ) @Roles('super_admin') @Post(':id/change-requests/:requestId/approve') @HttpCode(200)
  approve(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('requestId') rid: string, @Body() b: MarketRequestDecisionBody) { return this.svc.decide(u, id, rid, 'approve', b); }
  @ApiOkResponse(OBJ) @Roles('super_admin') @Post(':id/change-requests/:requestId/reject') @HttpCode(200)
  reject(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('requestId') rid: string, @Body() b: MarketRequestDecisionBody) { return this.svc.decide(u, id, rid, 'reject', b); }
}
