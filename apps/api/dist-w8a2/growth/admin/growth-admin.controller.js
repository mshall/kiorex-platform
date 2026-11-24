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
exports.GrowthAdminController = exports.FraudReviewDto = exports.WidgetStatusDto = exports.ChannelPatchDto = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const auth_1 = require("../../common/auth");
const growth_access_1 = require("./growth-access");
const growth_admin_service_1 = require("./growth-admin.service");
const OBJ = { schema: { type: 'object', additionalProperties: true } };
const ARR = { schema: { type: 'array', items: { type: 'object', additionalProperties: true } } };
class ChannelPatchDto {
    active;
    label;
}
exports.ChannelPatchDto = ChannelPatchDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], ChannelPatchDto.prototype, "active", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(120),
    __metadata("design:type", String)
], ChannelPatchDto.prototype, "label", void 0);
class WidgetStatusDto {
    status;
}
exports.WidgetStatusDto = WidgetStatusDto;
__decorate([
    (0, class_validator_1.IsIn)(['ACTIVE', 'DISABLED']),
    __metadata("design:type", String)
], WidgetStatusDto.prototype, "status", void 0);
class FraudReviewDto {
    status;
    note;
}
exports.FraudReviewDto = FraudReviewDto;
__decorate([
    (0, class_validator_1.IsIn)(['CONFIRMED', 'DISMISSED']),
    __metadata("design:type", String)
], FraudReviewDto.prototype, "status", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(300),
    __metadata("design:type", String)
], FraudReviewDto.prototype, "note", void 0);
let GrowthAdminController = class GrowthAdminController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    access(u) { return { roles: u.roles, capabilities: (0, growth_access_1.capabilitiesOf)(u.roles) }; }
    overview(market, days) { return this.svc.overview({ market, days }); }
    channels(market, days) { return this.svc.channels({ market, days }); }
    channel(u, id, b) { return this.svc.updateChannel(u.sub, id, b); }
    providers(market, days) { return this.svc.providerAcquisition({ market, days }); }
    seo(market) { return this.svc.seoStatus({ market }); }
    slugs(market, q, entityType, take) { return this.svc.slugs({ market, q, entityType, take }); }
    redirects(market, take) { return this.svc.redirects({ market, take }); }
    landing(market, indexable, pageType, take) { return this.svc.landingPages({ market, indexable, pageType, take }); }
    widgets(market) { return this.svc.widgets({ market }); }
    widgetStatus(u, orgRef, b) { return this.svc.setWidgetStatus(u.sub, orgRef, b.status); }
    templates() { return this.svc.templates(); }
    integrations(market) { return this.svc.integrations({ market }); }
    fraud(market, status, ruleId, take) { return this.svc.fraudSignals({ market, status, ruleId, take }); }
    fraudThresholds(market) { return this.svc.fraudThresholds({ market }); }
    review(u, id, b) { return this.svc.reviewFraud(u.sub, id, b.status, b.note); }
    audit(action, actor, resource, from, to, before, take) { return this.svc.auditLog({ action, actor, resource, from, to, before, take }); }
    markets() { return this.svc.marketConfigs(); }
    analytics(market, days) { return this.svc.analytics({ market, days }); }
    finance(market, days) { return this.svc.finance({ market, days }); }
};
exports.GrowthAdminController = GrowthAdminController;
__decorate([
    (0, common_1.Get)('access'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-K what the signed-in ops user may do in the Growth module' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], GrowthAdminController.prototype, "access", null);
__decorate([
    (0, common_1.Get)('overview'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-K executive overview: funnel, origins, sources, configuration health' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('market')),
    __param(1, (0, common_1.Query)('days')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], GrowthAdminController.prototype, "overview", null);
__decorate([
    (0, common_1.Get)('channels'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-K acquisition sources with touches per channel' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('market')),
    __param(1, (0, common_1.Query)('days')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], GrowthAdminController.prototype, "channels", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manage')),
    (0, common_1.Patch)('channels/:id'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-K activate, pause or relabel an acquisition source (audited)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, ChannelPatchDto]),
    __metadata("design:returntype", void 0)
], GrowthAdminController.prototype, "channel", null);
__decorate([
    (0, common_1.Get)('provider-acquisition'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-K provider-owned sources and the organisations that bring visitors' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('market')),
    __param(1, (0, common_1.Query)('days')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], GrowthAdminController.prototype, "providers", null);
__decorate([
    (0, common_1.Get)('seo/status'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-K SEO status: thresholds, robots, sitemap, thin pages' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('market')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], GrowthAdminController.prototype, "seo", null);
__decorate([
    (0, common_1.Get)('seo/slug-history'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-K slugs with their history' }),
    (0, swagger_1.ApiOkResponse)(ARR),
    __param(0, (0, common_1.Query)('market')),
    __param(1, (0, common_1.Query)('q')),
    __param(2, (0, common_1.Query)('entityType')),
    __param(3, (0, common_1.Query)('take')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String]),
    __metadata("design:returntype", void 0)
], GrowthAdminController.prototype, "slugs", null);
__decorate([
    (0, common_1.Get)('seo/redirect-history'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-K slug redirects (301) and gone entries' }),
    (0, swagger_1.ApiOkResponse)(ARR),
    __param(0, (0, common_1.Query)('market')),
    __param(1, (0, common_1.Query)('take')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], GrowthAdminController.prototype, "redirects", null);
__decorate([
    (0, common_1.Get)('landing-pages'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-K generated landing pages and their indexability result' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('market')),
    __param(1, (0, common_1.Query)('indexable')),
    __param(2, (0, common_1.Query)('pageType')),
    __param(3, (0, common_1.Query)('take')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String]),
    __metadata("design:returntype", void 0)
], GrowthAdminController.prototype, "landing", null);
__decorate([
    (0, common_1.Get)('widgets'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-K widget registrations, allowed origins, policy and audit' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('market')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], GrowthAdminController.prototype, "widgets", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manage')),
    (0, common_1.Patch)('widgets/:orgRef'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-K enable or disable one organisation widget registration (audited)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('orgRef')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, WidgetStatusDto]),
    __metadata("design:returntype", void 0)
], GrowthAdminController.prototype, "widgetStatus", null);
__decorate([
    (0, common_1.Get)('templates'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-K notification templates with their consent class (read-only)' }),
    (0, swagger_1.ApiOkResponse)(ARR),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], GrowthAdminController.prototype, "templates", null);
__decorate([
    (0, common_1.Get)('integrations'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-K integration mode and readiness with secret references only' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('market')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], GrowthAdminController.prototype, "integrations", null);
__decorate([
    (0, common_1.Get)('fraud/signals'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-K fraud signals and review queue' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('market')),
    __param(1, (0, common_1.Query)('status')),
    __param(2, (0, common_1.Query)('ruleId')),
    __param(3, (0, common_1.Query)('take')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String]),
    __metadata("design:returntype", void 0)
], GrowthAdminController.prototype, "fraud", null);
__decorate([
    (0, common_1.Get)('fraud/thresholds'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-K fraud rules and their thresholds (read-only)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('market')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], GrowthAdminController.prototype, "fraudThresholds", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('reviewFraud')),
    (0, common_1.Post)('fraud/signals/:id/review'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-K confirm or dismiss a fraud signal (audited; never changes an attribution decision)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, FraudReviewDto]),
    __metadata("design:returntype", void 0)
], GrowthAdminController.prototype, "review", null);
__decorate([
    (0, common_1.Get)('audit'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-K growth audit events with filters' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('action')),
    __param(1, (0, common_1.Query)('actor')),
    __param(2, (0, common_1.Query)('resource')),
    __param(3, (0, common_1.Query)('from')),
    __param(4, (0, common_1.Query)('to')),
    __param(5, (0, common_1.Query)('before')),
    __param(6, (0, common_1.Query)('take')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, String, String, String]),
    __metadata("design:returntype", void 0)
], GrowthAdminController.prototype, "audit", null);
__decorate([
    (0, common_1.Get)('markets'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-K per-market configuration summary' }),
    (0, swagger_1.ApiOkResponse)(ARR),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], GrowthAdminController.prototype, "markets", null);
__decorate([
    (0, common_1.Get)('analytics'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-K daily growth events and decisions (raw tables until analytics v1 serves them)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('market')),
    __param(1, (0, common_1.Query)('days')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], GrowthAdminController.prototype, "analytics", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('readFinance')),
    (0, common_1.Get)('finance'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-K financial performance: decisions by origin and revenue facts (finance role)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('market')),
    __param(1, (0, common_1.Query)('days')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], GrowthAdminController.prototype, "finance", null);
exports.GrowthAdminController = GrowthAdminController = __decorate([
    (0, swagger_1.ApiTags)('growth-admin'),
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('read')),
    (0, common_1.Controller)('ops/growth'),
    __metadata("design:paramtypes", [growth_admin_service_1.GrowthAdminService])
], GrowthAdminController);
//# sourceMappingURL=growth-admin.controller.js.map