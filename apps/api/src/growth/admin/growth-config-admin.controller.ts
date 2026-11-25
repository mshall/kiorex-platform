import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GROWTH_CONFIG_SCHEMAS, GROWTH_CONFIG_STATES, type GrowthConfigKind } from '@kiorex/contracts';
import { IsBoolean, IsDateString, IsIn, IsInt, IsObject, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { AuthUser, CurrentUser, Roles } from '../../common/auth';
import { growthError } from '../growth-errors';
import { GROWTH_DEFAULT_PAYLOADS } from '../config/growth-defaults';
import { GrowthConfigService, MONEY_POLICY_KINDS, type ConfigScope } from '../config/growth-config.service';
import { SEO_EXTENSION_DEFAULTS, TEMPLATE_KEYS, TEMPLATE_PLACEHOLDERS } from '../seo/seo-public';
import { rolesFor } from './growth-access';
import { LTV_POLICY_SCHEMA } from '../cohorts/ltv-policy';
import { LOYALTY_RULES_SCHEMA } from '../loyalty/loyalty-config';
import { POLICY_KINDS } from '../policy/policy-registry';
import { POLICY_SCHEMAS } from '../policy/policy-schemas.generated';

const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;
const ARR = { schema: { type: 'array', items: { type: 'object', additionalProperties: true } } } as const;
/** Kinds with a contract JSON Schema are the ones the console can edit in Phase 1 (the other kinds arrive with their phase). */
export const EDITABLE_KINDS = [...(Object.keys(GROWTH_CONFIG_SCHEMAS) as GrowthConfigKind[]), 'LTV_POLICY' as GrowthConfigKind, 'LOYALTY_RULES' as GrowthConfigKind, ...(POLICY_KINDS.filter((k) => !(k in GROWTH_CONFIG_SCHEMAS)) as unknown as GrowthConfigKind[])]; // LTV_POLICY (GRW-P3-C): its schema is local until contracts 1.13.0
const LOCAL_SCHEMAS: Record<string, unknown> = { LTV_POLICY: LTV_POLICY_SCHEMA, LOYALTY_RULES: LOYALTY_RULES_SCHEMA, ...POLICY_SCHEMAS };
const KIND_NOTES: Record<string, string> = {
  ATTRIBUTION_POLICY: 'Who gets credit for a booking: windows, precedence, dwell. Money policy: 7 days notice and a provider announcement.',
  SEO: 'Public site rules: canonical host, locales, thin-page thresholds, sitemap shard size, cache lifetimes.',
  WIDGET_POLICY: 'Booking widget limits: origins per organisation, token lifetime, hold limits, embed host.',
  CONSENT_DEFAULTS: 'Consent regime, quiet hours, frequency caps, withdrawal propagation.',
  CAMPAIGN_POLICY: 'Campaign rules: approval threshold, monthly ceiling, alert thresholds, channels, UTM naming and creative rules. Money: announcement required, no ad platform is ever touched.',
  REFERRAL_RULES: 'Patient referral qualification, caps and eligible care types (non-clinical only).',
  REWARD_RULES: 'Reward mode (coupon or credit), amounts, expiry, caps and redemption limits. Money: announcement required.',
  LIFECYCLE_POLICY: 'Message classes, frequency caps, quiet hours, journeys and allowlisted segments.',
  ASSISTANT_POLICY: 'WhatsApp assistant: languages, tools per state, token and cost budgets, retention, escalation SLA, model mode.',
  SPONSORED_PROMOTION_POLICY: 'Provider-sponsored promotions: commission basis, high-value review thresholds, funding defaults. Money: 7 days notice and an announcement.',
  INTEGRATION: 'Read-only marketing integrations by kind: mode, secret reference names, pull schedule, rate budget, retention.',
  LTV_POLICY: 'Cohort LTV model: horizon, tail fit window, discount rate, cost inclusion, bootstrap and the k-anonymity floor (never below 10). Reporting only.',
  LOYALTY_RULES: 'Loyalty points: points per completed booking, tier thresholds and bonuses, window, expiry, annual cap and the conversion into a reward lot. Every amount and threshold starts at 0 (0 = off). Points are not money. Announcement required.',
  EXPERIMENT_POLICY: 'Experiment guardrails: minimum run days, SRM alpha, concurrency, variants, k-anonymity (never below 10), assignment TTL. The denied-surface list can only grow.',
  AUTOMATION_POLICY: 'Journey builder limits: nodes, waits, sends per journey and per 30 days, compiled steps, branch arms.',
  ATTRIBUTION_MODELS: 'Reporting models only: windows, half-life, position shares, data-driven gate. Never read by the commission decision.',
  RECOMMENDATION_POLICY: 'Growth recommendation thresholds: k (never below 10), spend floor, expiry days, per-run cap, shift cap, ratio, AI summaries per day.',
  REWARD_GUARDS: 'Reward issuance guards: days blocked after a recoverable loss (never below 30) and the active-lot ceiling per patient.',
  LIFECYCLE_STAGES: 'Days that derive DORMANT and CHURNED, and what counts as RETAINED. Non-clinical.',
  CROSS_PRODUCT_POLICY: 'Continuity prompts: lifetime and parent-visit window per entry point (Rx to Pharmacy, lab order to Lab, care plan to home visit).',
  INTEGRATION_RUNTIME: 'Circuit-breaker threshold and cool-down and retry attempts for the growth integration jobs.',
  INTEGRATION_MODES: 'The mock or real mode the founder APPROVED per external integration (go-live approval and audit trail; never a credential). The Integrations Control Center shows drift against the deployed environment.',
  MARKET_GROWTH: 'Per-market growth facts: currency, phone code, locales, booking link host, integrations on/off, secret references.',
};

export class ConfigKeyDto {
  @IsIn(EDITABLE_KINDS) kind!: string;
  @IsIn(['GLOBAL', 'MARKET']) scope!: 'GLOBAL' | 'MARKET';
  @IsOptional() @IsString() @Matches(/^([A-Z]{2})?$/) scopeId?: string;
}
export class CreateConfigDto extends ConfigKeyDto {
  @IsObject() payload!: Record<string, unknown>;
  @IsOptional() @IsDateString() effectiveFrom?: string;
  @IsOptional() @IsString() @MaxLength(200) ticket?: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
  @IsOptional() @IsString() @MaxLength(1000) announcement?: string;
}
export class UpdateConfigDto {
  @IsOptional() @IsObject() payload?: Record<string, unknown>;
  @IsOptional() @IsDateString() effectiveFrom?: string;
  @IsOptional() @IsString() @MaxLength(200) ticket?: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
  @IsOptional() @IsString() @MaxLength(1000) announcement?: string;
}
export class RejectDto { @IsString() @MaxLength(300) reason!: string }
export class RollbackDto extends ConfigKeyDto {
  @IsInt() @Min(1) toVersion!: number;
  @IsString() @MaxLength(300) reason!: string;
  @IsOptional() @IsDateString() effectiveFrom?: string;
  @IsOptional() @IsString() @MaxLength(200) ticket?: string;
  @IsOptional() @IsString() @MaxLength(1000) announcement?: string;
  @IsOptional() @IsBoolean() dryRun?: boolean;
}

const scopeOf = (k: { scope: 'GLOBAL' | 'MARKET'; scopeId?: string }): ConfigScope => (k.scope === 'GLOBAL' ? { scope: 'GLOBAL', scopeId: '' } : { scope: 'MARKET', scopeId: k.scopeId ?? '' });
const date = (v?: string) => (v ? new Date(v) : undefined);
const actor = (u: AuthUser) => ({ sub: u.sub, roles: u.roles });

/**
 * GRW-P1-K maker-checker API for the growth configuration versions (ARCH section 16). The actor is ALWAYS the bearer's `sub`: no body field names an author or an
 * approver. The service additionally refuses an approver who is the creator, a non-super-admin, an edit of a non-DRAFT row, and the database refuses the same.
 */
@ApiTags('growth-admin')
@Roles(...rolesFor('read'))
@Controller('ops/growth/config')
export class GrowthConfigAdminController {
  constructor(private readonly svc: GrowthConfigService) {}

  @Get('kinds') @ApiOperation({ summary: 'GRW-P1-K editable config kinds with their JSON Schema, PROPOSED_DEFAULT payload and money-policy flag' }) @ApiOkResponse(ARR)
  kinds() {
    return EDITABLE_KINDS.map((kind) => {
      const schema = (LOCAL_SCHEMAS[kind] ?? (GROWTH_CONFIG_SCHEMAS as Record<string, unknown>)[kind]) as { properties: Record<string, unknown> };
      if (kind !== 'SEO') return { kind, note: KIND_NOTES[kind] ?? '', moneyPolicy: MONEY_POLICY_KINDS.includes(kind), schema, defaults: GROWTH_DEFAULT_PAYLOADS[kind] ?? null };
      // SEO: the contract keys plus package F's keys (metadata templates, pagination, review markup), so one form edits the whole versioned payload
      const ext = { ...schema, properties: { ...schema.properties,
        paginatedIndexable: { type: 'boolean', description: 'Page 2 and beyond of a listing are indexable. PROPOSED_DEFAULT false (noindex,follow).' },
        reviewMarkupMinCount: { type: 'integer', minimum: 1, maximum: 1000, description: 'Verified reviews needed before rating markup is emitted.' },
        sameDayWindowHours: { type: 'integer', minimum: 1, maximum: 72, description: 'A provider counts as same-day when its next slot starts within this many hours.' },
        minAvailableProviders: { type: 'integer', minimum: 1, maximum: 50, description: 'Providers with real availability needed by same-day and telemedicine hubs.' },
        maxParentSimilarityPercent: { type: 'integer', minimum: 50, maximum: 100, description: 'A district page overlapping its parent by more than this is noindex.' },
        templates: { type: 'object', 'x-editor': 'seo-templates', 'x-pageTypes': [...TEMPLATE_KEYS], 'x-placeholders': [...TEMPLATE_PLACEHOLDERS], description: 'Title and description templates per language and page type.' },
      } };
      return { kind, note: KIND_NOTES[kind] ?? '', moneyPolicy: false, schema: ext, defaults: { ...(GROWTH_DEFAULT_PAYLOADS[kind] ?? {}), ...SEO_EXTENSION_DEFAULTS() } };
    });
  }

  @Get() @ApiOperation({ summary: 'GRW-P1-K list config versions (kind, scope, status filters)' }) @ApiOkResponse(ARR)
  list(@Query('kind') kind?: string, @Query('scope') scope?: string, @Query('scopeId') scopeId?: string, @Query('status') status?: string) {
    if (status && !(GROWTH_CONFIG_STATES as readonly string[]).includes(status)) throw growthError('GROWTH_INVALID_REQUEST', 'Unknown status');
    return this.svc.list({ kind, status, scope, scopeId });
  }

  @Get('in-force') @ApiOperation({ summary: 'GRW-P1-K the version serving a kind in a market now (ACTIVE, else PROPOSED_DEFAULT), plus what is scheduled' }) @ApiOkResponse(OBJ)
  async inForce(@Query('kind') kind: string, @Query('market') market?: string) {
    if (!EDITABLE_KINDS.includes(kind as GrowthConfigKind)) throw growthError('GROWTH_INVALID_REQUEST', 'Unknown config kind');
    if (market && !/^[A-Z]{2}$/.test(market)) throw growthError('GROWTH_INVALID_REQUEST', 'market must be an ISO country code');
    const r = await this.svc.resolve(kind, { market });
    const scheduled = await this.svc.list({ kind, status: 'APPROVED' });
    return { kind: r.kind, scope: r.scope, scopeId: r.scopeId, version: r.version, versionId: r.versionId, source: r.source, effectiveFrom: r.effectiveFrom?.toISOString() ?? null, payload: r.payload, scheduled: scheduled.filter((s) => s.scope === 'GLOBAL' || s.scopeId === market).map((s) => ({ id: s.id, version: s.version, scope: s.scope, scopeId: s.scopeId, effectiveFrom: s.effectiveFrom?.toISOString() ?? null })) };
  }

  @Get('propagation') @ApiOperation({ summary: 'GRW-P1-K which readers and instances serve which version of a config (no redeploy needed)' }) @ApiOkResponse(OBJ)
  propagation(@Query('kind') kind: string, @Query('scope') scope = 'GLOBAL', @Query('scopeId') scopeId = '') { return this.svc.propagation(kind, scope, scopeId); }

  @Get(':id') @ApiOperation({ summary: 'GRW-P1-K one config version with its audit trail' }) @ApiOkResponse(OBJ)
  async one(@Param('id') id: string) {
    const row = await this.svc.get(id);
    return { ...row, audit: await this.svc.auditTrail(id) };
  }
  @Get(':id/diff') @ApiOperation({ summary: 'GRW-P1-K field-level diff against another version (default: the one it replaces)' }) @ApiOkResponse(OBJ)
  diff(@Param('id') id: string, @Query('against') against?: string) { return this.svc.diff(id, against); }
  @Get(':id/validate') @ApiOperation({ summary: 'GRW-P1-K dry-run: schema, guardrails and money-policy rules; changes nothing' }) @ApiOkResponse(OBJ)
  validate(@Param('id') id: string) { return this.svc.validate(id); }

  @Roles(...rolesFor('writeConfig')) @Post() @ApiOperation({ summary: 'GRW-P1-K create a DRAFT (maker). Validated against the contract schema; secrets by reference only' }) @ApiOkResponse(OBJ)
  create(@CurrentUser() u: AuthUser, @Body() b: CreateConfigDto) { return this.svc.createDraft(actor(u), { kind: b.kind, ...scopeOf(b), payload: b.payload, effectiveFrom: date(b.effectiveFrom), ticket: b.ticket, reason: b.reason, announcement: b.announcement }); }
  @Roles(...rolesFor('writeConfig')) @Patch(':id') @ApiOperation({ summary: 'GRW-P1-K edit a DRAFT (its author only)' }) @ApiOkResponse(OBJ)
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: UpdateConfigDto) { return this.svc.updateDraft(actor(u), id, { payload: b.payload, effectiveFrom: date(b.effectiveFrom), ticket: b.ticket, reason: b.reason, announcement: b.announcement }); }
  @Roles(...rolesFor('writeConfig')) @Post(':id/submit') @HttpCode(200) @ApiOperation({ summary: 'GRW-P1-K submit a DRAFT for approval (its author only)' }) @ApiOkResponse(OBJ)
  submit(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.submit(actor(u), id); }
  @Roles(...rolesFor('approveConfig')) @Post(':id/approve') @HttpCode(200) @ApiOperation({ summary: 'GRW-P1-K approve (checker; never the author). Activates at effectiveFrom' }) @ApiOkResponse(OBJ)
  approve(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.approve(actor(u), id); }
  @Roles(...rolesFor('approveConfig')) @Post(':id/reject') @HttpCode(200) @ApiOperation({ summary: 'GRW-P1-K reject a pending version (checker; never the author)' }) @ApiOkResponse(OBJ)
  reject(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: RejectDto) { return this.svc.reject(actor(u), id, b.reason); }
  @Roles(...rolesFor('approveConfig')) @Post(':id/activate') @HttpCode(200) @ApiOperation({ summary: 'GRW-P1-K activate an approved version at its effective date (refused earlier)' }) @ApiOkResponse(OBJ)
  activate(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.activate(actor(u), id); }
  @Roles(...rolesFor('writeConfig')) @Post('rollback') @HttpCode(200) @ApiOperation({ summary: 'GRW-P1-K roll back = a NEW version copying an older payload, same approval path' }) @ApiOkResponse(OBJ)
  rollback(@CurrentUser() u: AuthUser, @Body() b: RollbackDto) { return this.svc.rollback(actor(u), { kind: b.kind, ...scopeOf(b), toVersion: b.toVersion, reason: b.reason, effectiveFrom: date(b.effectiveFrom), ticket: b.ticket, announcement: b.announcement }); }
}
