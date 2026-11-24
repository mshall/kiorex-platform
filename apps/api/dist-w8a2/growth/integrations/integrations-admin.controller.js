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
exports.IntegrationsAdminController = void 0;
const market_core_public_1 = require("../../market/market-core-public");
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const auth_1 = require("../../common/auth");
const errors_1 = require("../../common/errors");
const growth_access_1 = require("../admin/growth-access");
const channel_performance_service_1 = require("../analytics/channel-performance.service");
const growth_errors_1 = require("../growth-errors");
const integration_service_1 = require("./integration.service");
const OBJ = { schema: { type: 'object', additionalProperties: true } };
const marketOf = (m) => (m && /^[A-Z]{2}$/.test(m) ? m : market_core_public_1.DEFAULT_MARKET);
let IntegrationsAdminController = class IntegrationsAdminController {
    svc;
    perf;
    constructor(svc, perf) {
        this.svc = svc;
        this.perf = perf;
    }
    status(market) { return this.svc.status(marketOf(market)); }
    runs(market, kind, take) { return this.svc.runs(marketOf(market), kind, take ? Number(take) : 50); }
    async test(kind, market) {
        if (!(0, integration_service_1.isKind)(kind))
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'Unknown integration kind');
        const s = await this.svc.setting(kind, marketOf(market));
        const h = await this.svc.adapter(kind, s).health();
        return { kind, mode: s.mode, ok: h.ok, detail: h.detail };
    }
    async run(u, kind, b) {
        if (!(0, integration_service_1.isKind)(kind))
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'Unknown integration kind');
        const market = marketOf(b?.market);
        const s = await this.svc.setting(kind, market);
        if (s.mode === 'real') {
            if (!b?.requestId)
                throw (0, errors_1.badRequest)('CONFIRMATION_REQUIRED', 'A real pull needs a request confirmed by a second super admin');
            return this.svc.confirmRealRun(u.sub, kind, b.requestId);
        }
        return this.svc.run(kind, { market, from: b?.from, to: b?.to, trigger: 'MANUAL', actor: u.sub });
    }
    async request(u, kind, b) {
        if (!(0, integration_service_1.isKind)(kind))
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'Unknown integration kind');
        return this.svc.requestRealRun(u.sub, kind, marketOf(b?.market), b?.from, b?.to);
    }
    performance(u, market, from, to) { return this.perf.report({ market: marketOf(market), from, to, includeRevenue: (0, growth_access_1.can)(u.roles, 'readFinance') }); }
};
exports.IntegrationsAdminController = IntegrationsAdminController;
__decorate([
    (0, common_1.Get)('integration-status'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-F status, mode, circuit, last run, secretRef presence (boolean) per integration' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('market')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], IntegrationsAdminController.prototype, "status", null);
__decorate([
    (0, common_1.Get)('integration-runs'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-F run history (kind filter)' }),
    (0, swagger_1.ApiOkResponse)({ schema: { type: 'array', items: { type: 'object', additionalProperties: true } } }),
    __param(0, (0, common_1.Query)('market')),
    __param(1, (0, common_1.Query)('kind')),
    __param(2, (0, common_1.Query)('take')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", void 0)
], IntegrationsAdminController.prototype, "runs", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manage')),
    (0, common_1.Post)('integrations/:kind/test'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-F health check (mock: synthetic OK; real: secret resolves, no upstream call)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Param)('kind')),
    __param(1, (0, common_1.Query)('market')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], IntegrationsAdminController.prototype, "test", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manage')),
    (0, common_1.Post)('integrations/:kind/run'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-F pull now. Mock: direct. Real: needs { requestId } of a request made by another super admin' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('kind')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], IntegrationsAdminController.prototype, "run", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manage')),
    (0, common_1.Post)('integrations/:kind/run-requests'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-F ask for a real pull (first person of two)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('kind')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], IntegrationsAdminController.prototype, "request", null);
__decorate([
    (0, common_1.Get)('channel-performance'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-F channel and campaign performance: external numbers beside first-party facts, CAC, blended CAC, ROAS, MER (k >= 10, spend floor)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Query)('market')),
    __param(2, (0, common_1.Query)('from')),
    __param(3, (0, common_1.Query)('to')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], IntegrationsAdminController.prototype, "performance", null);
exports.IntegrationsAdminController = IntegrationsAdminController = __decorate([
    (0, swagger_1.ApiTags)('growth-integrations'),
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('read')),
    (0, common_1.Controller)('admin/growth'),
    __metadata("design:paramtypes", [integration_service_1.IntegrationService, channel_performance_service_1.ChannelPerformanceService])
], IntegrationsAdminController);
//# sourceMappingURL=integrations-admin.controller.js.map