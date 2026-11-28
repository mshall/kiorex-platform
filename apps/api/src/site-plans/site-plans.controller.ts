import { Body, Controller, Get, Header, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, OpsOnly, Public, SuperAdminOnly, type AuthUser } from '../common/auth';
import { SitePlansService } from './site-plans.service';
import { PlanPriceProposalService } from './plan-price-proposals.service';

const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;

/** Public, read-only, cacheable. No authentication, no secrets, no personal data: only the whitelisted fields of the plans marked public (see site-plans.catalog.ts). */
@ApiTags('public-site')
@Controller('public/plans')
export class SitePlansPublicController {
  constructor(private readonly svc: SitePlansService) {}

  @Public() @Get() @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=120') @ApiOkResponse(OBJ)
  @ApiOperation({ summary: 'Public: the subscription plans of Clinic, Pharmacy and Lab for the Kiorly site (contract kiorly.public-plans.v1). Clinic comes live from the Clinic catalogue for ?market=CC (default EG); a plan without an active price says priceStatus TO_BE_ANNOUNCED and carries no number' })
  list(@Query('market') market?: string) { return this.svc.publicPlans(market); }
}

/**
 * Kiorly admin and Kiorex console: Plans. Ops (`ops_admin`) and `super_admin` read and PROPOSE prices; ONLY `super_admin` changes plan wording and DECIDES a price, and never their own
 * proposal (maker-checker, like the commission policy). The products own plans and prices (this is the audited, role-gated door to their signed routes); the Pharmacy and Lab site text is stored here.
 */
@ApiTags('ops')
@Controller('admin/kiorly-plans')
export class SitePlansAdminController {
  constructor(private readonly svc: SitePlansService, private readonly prices: PlanPriceProposalService) {}

  @OpsOnly() @Get() @ApiOkResponse(OBJ)
  @ApiOperation({ summary: 'Plans overview: Clinic plans with every price version and the Clinic markets, the Pharmacy and Lab price versions, the site text with its version, the price proposals, the checks on the published catalogue, and what the caller may do' })
  async overview(@CurrentUser() u: AuthUser) { const o = await this.svc.overview(u); return { ...o, ...(await this.prices.extras(u, o.clinic as never)) }; }

  @SuperAdminOnly() @Patch('clinic/:planId') @ApiOkResponse(OBJ)
  @ApiOperation({ summary: 'Super admin: change a Clinic plan name, public flag or order (forwarded to the Clinic, audited here)' })
  patch(@CurrentUser() u: AuthUser, @Param('planId') planId: string, @Body() b: unknown) { return this.svc.patchClinicPlan(u, planId, b); }

  @OpsOnly() @Post('clinic/:planId/prices') @HttpCode(200) @ApiOkResponse(OBJ)
  @ApiOperation({ summary: 'Kept for the earlier console: previews a Clinic price ({ preview: true }) and refuses a direct publish with 409 PROPOSAL_REQUIRED (a price is proposed, then approved by a second super admin)' })
  price(@CurrentUser() u: AuthUser, @Param('planId') planId: string, @Body() b: unknown) { return this.svc.publishClinicPrice(u, planId, b); }

  @OpsOnly() @Post('prices/preview') @HttpCode(200) @ApiOkResponse(OBJ)
  @ApiOperation({ summary: 'Preview a price version for the Clinic, the Pharmacy or the Lab: impact on subscribers, the version it would create, and advisory warnings (annual against monthly, plan order, big change). Writes nothing' })
  preview(@CurrentUser() u: AuthUser, @Body() b: unknown) { return this.prices.preview(u, b); }

  @OpsOnly() @Get('proposals') @ApiOkResponse(OBJ)
  @ApiOperation({ summary: 'Price proposals, newest first, optionally ?status=PENDING|APPROVED|REJECTED|WITHDRAWN and ?product=CLINIC|PHARMACY|LAB; rejected and withdrawn ones stay in the history' })
  proposals(@CurrentUser() u: AuthUser, @Query('status') status?: string, @Query('product') product?: string) { return this.prices.list(u, { status, product }); }

  @OpsOnly() @Post('proposals') @HttpCode(201) @ApiOkResponse(OBJ)
  @ApiOperation({ summary: 'Propose a price version (Kiorly ops or a super admin). Nothing is published until a different super admin approves it' })
  propose(@CurrentUser() u: AuthUser, @Body() b: unknown) { return this.prices.propose(u, b); }

  @SuperAdminOnly() @Post('proposals/:id/approve') @HttpCode(200) @ApiOkResponse(OBJ)
  @ApiOperation({ summary: 'A super admin other than the proposer approves and publishes the price through the product (effective-dated, append-only, audited)' })
  approve(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b?: { note?: unknown }) { return this.prices.approve(u, id, b?.note); }

  @SuperAdminOnly() @Post('proposals/:id/reject') @HttpCode(200) @ApiOkResponse(OBJ)
  @ApiOperation({ summary: 'A super admin other than the proposer rejects a proposal; it stays in the history' })
  reject(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b?: { note?: unknown }) { return this.prices.reject(u, id, b?.note); }

  @OpsOnly() @Post('proposals/:id/withdraw') @HttpCode(200) @ApiOkResponse(OBJ)
  @ApiOperation({ summary: 'The proposer withdraws a pending proposal; it stays in the history' })
  withdraw(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.prices.withdraw(u, id); }

  @SuperAdminOnly() @Put('content') @ApiOkResponse(OBJ)
  @ApiOperation({ summary: 'Super admin: save the site text of the Pharmacy and Lab editions. Send { version, config }; 409 PLAN_CONTENT_STALE when someone saved first. Carries no price' })
  save(@CurrentUser() u: AuthUser, @Body() b: { version?: unknown; config?: unknown }) { return this.svc.saveContent(u, b ?? {}); }
}
