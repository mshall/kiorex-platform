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
exports.GrowthConfigController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const auth_1 = require("../../common/auth");
const growth_errors_1 = require("../growth-errors");
const growth_config_service_1 = require("./growth-config.service");
const OBJ = { schema: { type: 'object', additionalProperties: true } };
let GrowthConfigController = class GrowthConfigController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    async resolve(kind, market, at) {
        if (!kind)
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'kind is required');
        const when = at ? new Date(at) : undefined;
        if (when && Number.isNaN(when.getTime()))
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'at must be an ISO date-time');
        const r = await this.svc.resolve(kind, { market: market && /^[A-Z]{2}$/.test(market) ? market : undefined, at: when });
        return { kind: r.kind, scope: r.scope, scopeId: r.scopeId, version: r.version, versionId: r.versionId, source: r.source, effectiveFrom: r.effectiveFrom?.toISOString() ?? null, payload: r.payload };
    }
};
exports.GrowthConfigController = GrowthConfigController;
__decorate([
    (0, common_1.Get)('resolve'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-B resolved growth config for a kind and market (ACTIVE version, else PROPOSED_DEFAULT)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    (0, swagger_1.ApiQuery)({ name: 'kind', required: true }),
    (0, swagger_1.ApiQuery)({ name: 'market', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'at', required: false }),
    __param(0, (0, common_1.Query)('kind')),
    __param(1, (0, common_1.Query)('market')),
    __param(2, (0, common_1.Query)('at')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", Promise)
], GrowthConfigController.prototype, "resolve", null);
exports.GrowthConfigController = GrowthConfigController = __decorate([
    (0, swagger_1.ApiTags)('growth'),
    (0, auth_1.OpsOnly)(),
    (0, common_1.Controller)('growth/config'),
    __metadata("design:paramtypes", [growth_config_service_1.GrowthConfigService])
], GrowthConfigController);
//# sourceMappingURL=growth-config.controller.js.map