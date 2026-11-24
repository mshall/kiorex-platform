import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser, Roles } from '../../common/auth';
import { capabilitiesOf, rolesFor } from './growth-access';
import { GrowthAdminService } from './growth-admin.service';

const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;
const ARR = { schema: { type: 'array', items: { type: 'object', additionalProperties: true } } } as const;

export class ChannelPatchDto { @IsOptional() @IsBoolean() active?: boolean; @IsOptional() @IsString() @MaxLength(120) label?: string }
export class WidgetStatusDto { @IsIn(['ACTIVE', 'DISABLED']) status!: 'ACTIVE' | 'DISABLED' }
export class FraudReviewDto { @IsIn(['CONFIRMED', 'DISMISSED']) status!: 'CONFIRMED' | 'DISMISSED'; @IsOptional() @IsString() @MaxLength(300) note?: string }

/** GRW-P1-K read models and small audited actions behind the Growth & Patient Acquisition pages of the ops console. Roles come from growth-access.ts (one table). */
@ApiTags('growth-admin')
@Roles(...rolesFor('read'))
@Controller('ops/growth')
export class GrowthAdminController {
  constructor(private readonly svc: GrowthAdminService) {}

  @Get('access') @ApiOperation({ summary: 'GRW-P1-K what the signed-in ops user may do in the Growth module' }) @ApiOkResponse(OBJ)
  access(@CurrentUser() u: AuthUser) { return { roles: u.roles, capabilities: capabilitiesOf(u.roles) }; }

  @Get('overview') @ApiOperation({ summary: 'GRW-P1-K executive overview: funnel, origins, sources, configuration health' }) @ApiOkResponse(OBJ)
  overview(@Query('market') market?: string, @Query('days') days?: string) { return this.svc.overview({ market, days }); }

  @Get('channels') @ApiOperation({ summary: 'GRW-P1-K acquisition sources with touches per channel' }) @ApiOkResponse(OBJ)
  channels(@Query('market') market?: string, @Query('days') days?: string) { return this.svc.channels({ market, days }); }
  @Roles(...rolesFor('manage')) @Patch('channels/:id') @ApiOperation({ summary: 'GRW-P1-K activate, pause or relabel an acquisition source (audited)' }) @ApiOkResponse(OBJ)
  channel(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: ChannelPatchDto) { return this.svc.updateChannel(u.sub, id, b); }

  @Get('provider-acquisition') @ApiOperation({ summary: 'GRW-P1-K provider-owned sources and the organisations that bring visitors' }) @ApiOkResponse(OBJ)
  providers(@Query('market') market?: string, @Query('days') days?: string) { return this.svc.providerAcquisition({ market, days }); }

  @Get('seo/status') @ApiOperation({ summary: 'GRW-P1-K SEO status: thresholds, robots, sitemap, thin pages' }) @ApiOkResponse(OBJ)
  seo(@Query('market') market?: string) { return this.svc.seoStatus({ market }); }
  @Get('seo/slug-history') @ApiOperation({ summary: 'GRW-P1-K slugs with their history' }) @ApiOkResponse(ARR)
  slugs(@Query('market') market?: string, @Query('q') q?: string, @Query('entityType') entityType?: string, @Query('take') take?: string) { return this.svc.slugs({ market, q, entityType, take }); }
  @Get('seo/redirect-history') @ApiOperation({ summary: 'GRW-P1-K slug redirects (301) and gone entries' }) @ApiOkResponse(ARR)
  redirects(@Query('market') market?: string, @Query('take') take?: string) { return this.svc.redirects({ market, take }); }
  @Get('landing-pages') @ApiOperation({ summary: 'GRW-P1-K generated landing pages and their indexability result' }) @ApiOkResponse(OBJ)
  landing(@Query('market') market?: string, @Query('indexable') indexable?: string, @Query('pageType') pageType?: string, @Query('take') take?: string) { return this.svc.landingPages({ market, indexable, pageType, take }); }

  @Get('widgets') @ApiOperation({ summary: 'GRW-P1-K widget registrations, allowed origins, policy and audit' }) @ApiOkResponse(OBJ)
  widgets(@Query('market') market?: string) { return this.svc.widgets({ market }); }
  @Roles(...rolesFor('manage')) @Patch('widgets/:orgRef') @ApiOperation({ summary: 'GRW-P1-K enable or disable one organisation widget registration (audited)' }) @ApiOkResponse(OBJ)
  widgetStatus(@CurrentUser() u: AuthUser, @Param('orgRef') orgRef: string, @Body() b: WidgetStatusDto) { return this.svc.setWidgetStatus(u.sub, orgRef, b.status); }

  @Get('templates') @ApiOperation({ summary: 'GRW-P1-K notification templates with their consent class (read-only)' }) @ApiOkResponse(ARR)
  templates() { return this.svc.templates(); }

  @Get('integrations') @ApiOperation({ summary: 'GRW-P1-K integration mode and readiness with secret references only' }) @ApiOkResponse(OBJ)
  integrations(@Query('market') market?: string) { return this.svc.integrations({ market }); }

  @Get('fraud/signals') @ApiOperation({ summary: 'GRW-P1-K fraud signals and review queue' }) @ApiOkResponse(OBJ)
  fraud(@Query('market') market?: string, @Query('status') status?: string, @Query('ruleId') ruleId?: string, @Query('take') take?: string) { return this.svc.fraudSignals({ market, status, ruleId, take }); }
  @Get('fraud/thresholds') @ApiOperation({ summary: 'GRW-P1-K fraud rules and their thresholds (read-only)' }) @ApiOkResponse(OBJ)
  fraudThresholds(@Query('market') market?: string) { return this.svc.fraudThresholds({ market }); }
  @Roles(...rolesFor('reviewFraud')) @Post('fraud/signals/:id/review') @HttpCode(200) @ApiOperation({ summary: 'GRW-P1-K confirm or dismiss a fraud signal (audited; never changes an attribution decision)' }) @ApiOkResponse(OBJ)
  review(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: FraudReviewDto) { return this.svc.reviewFraud(u.sub, id, b.status, b.note); }

  @Get('audit') @ApiOperation({ summary: 'GRW-P1-K growth audit events with filters' }) @ApiOkResponse(OBJ)
  audit(@Query('action') action?: string, @Query('actor') actor?: string, @Query('resource') resource?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('before') before?: string, @Query('take') take?: string) { return this.svc.auditLog({ action, actor, resource, from, to, before, take }); }

  @Get('markets') @ApiOperation({ summary: 'GRW-P1-K per-market configuration summary' }) @ApiOkResponse(ARR)
  markets() { return this.svc.marketConfigs(); }

  @Get('analytics') @ApiOperation({ summary: 'GRW-P1-K daily growth events and decisions (raw tables until analytics v1 serves them)' }) @ApiOkResponse(OBJ)
  analytics(@Query('market') market?: string, @Query('days') days?: string) { return this.svc.analytics({ market, days }); }
  @Roles(...rolesFor('readFinance')) @Get('finance') @ApiOperation({ summary: 'GRW-P1-K financial performance: decisions by origin and revenue facts (finance role)' }) @ApiOkResponse(OBJ)
  finance(@Query('market') market?: string, @Query('days') days?: string) { return this.svc.finance({ market, days }); }
}
