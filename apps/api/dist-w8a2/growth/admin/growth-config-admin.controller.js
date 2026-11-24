"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GrowthConfigAdminController = exports.RollbackDto = exports.RejectDto = exports.UpdateConfigDto = exports.CreateConfigDto = exports.ConfigKeyDto = exports.EDITABLE_KINDS = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const contracts_1 = require("@kiorex/contracts");
const class_validator_1 = require("class-validator");
const auth_1 = require("../../common/auth");
const growth_errors_1 = require("../growth-errors");
const growth_defaults_1 = require("../config/growth-defaults");
const growth_config_service_1 = require("../config/growth-config.service");
const seo_public_1 = require("../seo/seo-public");
const growth_access_1 = require("./growth-access");
const ltv_policy_1 = require("../cohorts/ltv-policy");
const OBJ = { schema: { type: 'object', additionalProperties: true } };
const ARR = { schema: { type: 'array', items: { type: 'object', additionalProperties: true } } };
exports.EDITABLE_KINDS = [...Object.keys(contracts_1.GROWTH_CONFIG_SCHEMAS), 'LTV_POLICY'];
const LOCAL_SCHEMAS = { LTV_POLICY: ltv_policy_1.LTV_POLICY_SCHEMA };
const KIND_NOTES = {
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
    MARKET_GROWTH: 'Per-market growth facts: currency, phone code, locales, booking link host, integrations on/off, secret references.',
};
class ConfigKeyDto {
    kind;
    scope;
    scopeId;
}
exports.ConfigKeyDto = ConfigKeyDto;
__decorate([
    (0, class_validator_1.IsIn)(exports.EDITABLE_KINDS),
    __metadata("design:type", String)
], ConfigKeyDto.prototype, "kind", void 0);
__decorate([
    (0, class_validator_1.IsIn)(['GLOBAL', 'MARKET']),
    __metadata("design:type", String)
], ConfigKeyDto.prototype, "scope", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Matches)(/^([A-Z]{2})?$/),
    __metadata("design:type", String)
], ConfigKeyDto.prototype, "scopeId", void 0);
class CreateConfigDto extends ConfigKeyDto {
    payload;
    effectiveFrom;
    ticket;
    reason;
    announcement;
}
exports.CreateConfigDto = CreateConfigDto;
__decorate([
    (0, class_validator_1.IsObject)(),
    __metadata("design:type", Object)
], CreateConfigDto.prototype, "payload", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], CreateConfigDto.prototype, "effectiveFrom", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], CreateConfigDto.prototype, "ticket", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], CreateConfigDto.prototype, "reason", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(1000),
    __metadata("design:type", String)
], CreateConfigDto.prototype, "announcement", void 0);
class UpdateConfigDto {
    payload;
    effectiveFrom;
    ticket;
    reason;
    announcement;
}
exports.UpdateConfigDto = UpdateConfigDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsObject)(),
    __metadata("design:type", Object)
], UpdateConfigDto.prototype, "payload", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], UpdateConfigDto.prototype, "effectiveFrom", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], UpdateConfigDto.prototype, "ticket", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], UpdateConfigDto.prototype, "reason", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(1000),
    __metadata("design:type", String)
], UpdateConfigDto.prototype, "announcement", void 0);
class RejectDto {
    reason;
}
exports.RejectDto = RejectDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(300),
    __metadata("design:type", String)
], RejectDto.prototype, "reason", void 0);
class RollbackDto extends ConfigKeyDto {
    toVersion;
    reason;
    effectiveFrom;
    ticket;
    announcement;
    dryRun;
}
exports.RollbackDto = RollbackDto;
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], RollbackDto.prototype, "toVersion", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(300),
    __metadata("design:type", String)
], RollbackDto.prototype, "reason", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], RollbackDto.prototype, "effectiveFrom", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], RollbackDto.prototype, "ticket", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(1000),
    __metadata("design:type", String)
], RollbackDto.prototype, "announcement", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], RollbackDto.prototype, "dryRun", void 0);
const scopeOf = (k) => (k.scope === 'GLOBAL' ? { scope: 'GLOBAL', scopeId: '' } : { scope: 'MARKET', scopeId: k.scopeId ?? '' });
const date = (v) => (v ? new Date(v) : undefined);
const actor = (u) => ({ sub: u.sub, roles: u.roles });
let GrowthConfigAdminController = class GrowthConfigAdminController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    kinds() {
        return exports.EDITABLE_KINDS.map((kind) => {
            const schema = (LOCAL_SCHEMAS[kind] ?? contracts_1.GROWTH_CONFIG_SCHEMAS[kind]);
            if (kind !== 'SEO')
                return { kind, note: KIND_NOTES[kind] ?? '', moneyPolicy: growth_config_service_1.MONEY_POLICY_KINDS.includes(kind), schema, defaults: growth_defaults_1.GROWTH_DEFAULT_PAYLOADS[kind] ?? null };
            const ext = { ...schema, properties: { ...schema.properties,
                    paginatedIndexable: { type: 'boolean', description: 'Page 2 and beyond of a listing are indexable. PROPOSED_DEFAULT false (noindex,follow).' },
                    reviewMarkupMinCount: { type: 'integer', minimum: 1, maximum: 1000, description: 'Verified reviews needed before rating markup is emitted.' },
                    sameDayWindowHours: { type: 'integer', minimum: 1, maximum: 72, description: 'A provider counts as same-day when its next slot starts within this many hours.' },
                    minAvailableProviders: { type: 'integer', minimum: 1, maximum: 50, description: 'Providers with real availability needed by same-day and telemedicine hubs.' },
                    maxParentSimilarityPercent: { type: 'integer', minimum: 50, maximum: 100, description: 'A district page overlapping its parent by more than this is noindex.' },
                    templates: { type: 'object', 'x-editor': 'seo-templates', 'x-pageTypes': [...seo_public_1.TEMPLATE_KEYS], 'x-placeholders': [...seo_public_1.TEMPLATE_PLACEHOLDERS], description: 'Title and description templates per language and page type.' },
                } };
            return { kind, note: KIND_NOTES[kind] ?? '', moneyPolicy: false, schema: ext, defaults: { ...(growth_defaults_1.GROWTH_DEFAULT_PAYLOADS[kind] ?? {}), ...(0, seo_public_1.SEO_EXTENSION_DEFAULTS)() } };
        });
    }
    list(kind, scope, scopeId, status) {
        if (status && !contracts_1.GROWTH_CONFIG_STATES.includes(status))
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'Unknown status');
        return this.svc.list({ kind, status, scope, scopeId });
    }
    async inForce(kind, market) {
        if (!exports.EDITABLE_KINDS.includes(kind))
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'Unknown config kind');
        if (market && !/^[A-Z]{2}$/.test(market))
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'market must be an ISO country code');
        const r = await this.svc.resolve(kind, { market });
        const scheduled = await this.svc.list({ kind, status: 'APPROVED' });
        return { kind: r.kind, scope: r.scope, scopeId: r.scopeId, version: r.version, versionId: r.versionId, source: r.source, effectiveFrom: r.effectiveFrom?.toISOString() ?? null, payload: r.payload, scheduled: scheduled.filter((s) => s.scope === 'GLOBAL' || s.scopeId === market).map((s) => ({ id: s.id, version: s.version, scope: s.scope, scopeId: s.scopeId, effectiveFrom: s.effectiveFrom?.toISOString() ?? null })) };
    }
    propagation(kind, scope = 'GLOBAL', scopeId = '') { return this.svc.propagation(kind, scope, scopeId); }
    async one(id) {
        const row = await this.svc.get(id);
        return { ...row, audit: await this.svc.auditTrail(id) };
    }
    diff(id, against) { return this.svc.diff(id, against); }
    validate(id) { return this.svc.validate(id); }
    create(u, b) { return this.svc.createDraft(actor(u), { kind: b.kind, ...scopeOf(b), payload: b.payload, effectiveFrom: date(b.effectiveFrom), ticket: b.ticket, reason: b.reason, announcement: b.announcement }); }
    update(u, id, b) { return this.svc.updateDraft(actor(u), id, { payload: b.payload, effectiveFrom: date(b.effectiveFrom), ticket: b.ticket, reason: b.reason, announcement: b.announcement }); }
    submit(u, id) { return this.svc.submit(actor(u), id); }
    approve(u, id) { return this.svc.approve(actor(u), id); }
    reject(u, id, b) { return this.svc.reject(actor(u), id, b.reason); }
    activate(u, id) { return this.svc.activate(actor(u), id); }
    rollback(u, b) { return this.svc.rollback(actor(u), { kind: b.kind, ...scopeOf(b), toVersion: b.toVersion, reason: b.reason, effectiveFrom: date(b.effectiveFrom), ticket: b.ticket, announcement: b.announcement }); }
};
exports.GrowthConfigAdminController = GrowthConfigAdminController;
__decorate([
    (0, common_1.Get)('kinds'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-K editable config kinds with their JSON Schema, PROPOSED_DEFAULT payload and money-policy flag' }),
    (0, swagger_1.ApiOkResponse)(ARR),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], GrowthConfigAdminController.prototype, "kinds", null);
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-K list config versions (kind, scope, status filters)' }),
    (0, swagger_1.ApiOkResponse)(ARR),
    __param(0, (0, common_1.Query)('kind')),
    __param(1, (0, common_1.Query)('scope')),
    __param(2, (0, common_1.Query)('scopeId')),
    __param(3, (0, common_1.Query)('status')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String]),
    __metadata("design:returntype", void 0)
], GrowthConfigAdminController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('in-force'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-K the version serving a kind in a market now (ACTIVE, else PROPOSED_DEFAULT), plus what is scheduled' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('kind')),
    __param(1, (0, common_1.Query)('market')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], GrowthConfigAdminController.prototype, "inForce", null);
__decorate([
    (0, common_1.Get)('propagation'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-K which readers and instances serve which version of a config (no redeploy needed)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('kind')),
    __param(1, (0, common_1.Query)('scope')),
    __param(2, (0, common_1.Query)('scopeId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", void 0)
], GrowthConfigAdminController.prototype, "propagation", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-K one config version with its audit trail' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], GrowthConfigAdminController.prototype, "one", null);
__decorate([
    (0, common_1.Get)(':id/diff'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-K field-level diff against another version (default: the one it replaces)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Query)('against')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], GrowthConfigAdminController.prototype, "diff", null);
__decorate([
    (0, common_1.Get)(':id/validate'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-K dry-run: schema, guardrails and money-policy rules; changes nothing' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], GrowthConfigAdminController.prototype, "validate", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('writeConfig')),
    (0, common_1.Post)(),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-K create a DRAFT (maker). Validated against the contract schema; secrets by reference only' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, CreateConfigDto]),
    __metadata("design:returntype", void 0)
], GrowthConfigAdminController.prototype, "create", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('writeConfig')),
    (0, common_1.Patch)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-K edit a DRAFT (its author only)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, UpdateConfigDto]),
    __metadata("design:returntype", void 0)
], GrowthConfigAdminController.prototype, "update", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('writeConfig')),
    (0, common_1.Post)(':id/submit'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-K submit a DRAFT for approval (its author only)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], GrowthConfigAdminController.prototype, "submit", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('approveConfig')),
    (0, common_1.Post)(':id/approve'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-K approve (checker; never the author). Activates at effectiveFrom' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], GrowthConfigAdminController.prototype, "approve", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('approveConfig')),
    (0, common_1.Post)(':id/reject'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-K reject a pending version (checker; never the author)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, RejectDto]),
    __metadata("design:returntype", void 0)
], GrowthConfigAdminController.prototype, "reject", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('approveConfig')),
    (0, common_1.Post)(':id/activate'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-K activate an approved version at its effective date (refused earlier)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], GrowthConfigAdminController.prototype, "activate", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('writeConfig')),
    (0, common_1.Post)('rollback'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-K roll back = a NEW version copying an older payload, same approval path' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, RollbackDto]),
    __metadata("design:returntype", void 0)
], GrowthConfigAdminController.prototype, "rollback", null);
exports.GrowthConfigAdminController = GrowthConfigAdminController = __decorate([
    (0, swagger_1.ApiTags)('growth-admin'),
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('read')),
    (0, common_1.Controller)('ops/growth/config'),
    __metadata("design:paramtypes", [growth_config_service_1.GrowthConfigService])
], GrowthConfigAdminController);
//# sourceMappingURL=growth-config-admin.controller.js.map