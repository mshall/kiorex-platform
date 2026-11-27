import { Body, Controller, Get, Header, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, OpsOnly, Public, SuperAdminOnly, type AuthUser } from '../common/auth';
import { SitePlansService } from './site-plans.service';

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
 * Kiorly admin and Kiorex console: Plans. Ops (`ops_admin`) and `super_admin` read; ONLY `super_admin` changes (the same rule as Market launch). The Clinic owns plans and
 * prices (this is the audited, role-gated door to its signed route); the Pharmacy and Lab site text is stored here.
 */
@ApiTags('ops')
@Controller('admin/kiorly-plans')
export class SitePlansAdminController {
  constructor(private readonly svc: SitePlansService) {}

  @OpsOnly() @Get() @ApiOkResponse(OBJ)
  @ApiOperation({ summary: 'Plans overview: Clinic plans with every price version and the Clinic markets, the Pharmacy and Lab site text with its version, and canChange for the caller' })
  overview(@CurrentUser() u: AuthUser) { return this.svc.overview(u); }

  @SuperAdminOnly() @Patch('clinic/:planId') @ApiOkResponse(OBJ)
  @ApiOperation({ summary: 'Super admin: change a Clinic plan name, public flag or order (forwarded to the Clinic, audited here)' })
  patch(@CurrentUser() u: AuthUser, @Param('planId') planId: string, @Body() b: unknown) { return this.svc.patchClinicPlan(u, planId, b); }

  @SuperAdminOnly() @Post('clinic/:planId/prices') @HttpCode(200) @ApiOkResponse(OBJ)
  @ApiOperation({ summary: 'Super admin: publish a new effective-dated price version for a Clinic plan and market, or { preview: true } for the impact on subscribers without publishing' })
  price(@CurrentUser() u: AuthUser, @Param('planId') planId: string, @Body() b: unknown) { return this.svc.publishClinicPrice(u, planId, b); }

  @SuperAdminOnly() @Put('content') @ApiOkResponse(OBJ)
  @ApiOperation({ summary: 'Super admin: save the site text of the Pharmacy and Lab editions. Send { version, config }; 409 PLAN_CONTENT_STALE when someone saved first. Carries no price' })
  save(@CurrentUser() u: AuthUser, @Body() b: { version?: unknown; config?: unknown }) { return this.svc.saveContent(u, b ?? {}); }
}
