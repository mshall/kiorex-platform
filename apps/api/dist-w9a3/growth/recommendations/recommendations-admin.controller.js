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
exports.RecommendationsAdminController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const auth_1 = require("../../common/auth");
const growth_access_1 = require("../admin/growth-access");
const recommendation_service_1 = require("./recommendation.service");
const market_core_public_1 = require("../../market/market-core-public");
const OBJ = { schema: { type: 'object', additionalProperties: true } };
const ARR = { schema: { type: 'array', items: { type: 'object', additionalProperties: true } } };
const actor = (u) => ({ sub: u.sub, kind: 'USER', roles: u.roles });
const mk = (m) => (m && /^[A-Z]{2}$/.test(m) ? m : undefined);
let RecommendationsAdminController = class RecommendationsAdminController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    catalog() { return this.svc.catalog(); }
    list(market, status, kind, take) { return this.svc.list({ market: mk(market), status, kind, take: take ? Number(take) || undefined : undefined }); }
    get(id) { return this.svc.get(id); }
    async run(u, b) { const m = mk(b?.market) ?? market_core_public_1.DEFAULT_MARKET; await this.svc.assertOn(m); return this.svc.generate(actor(u), m); }
    decide(u, id, b) { return this.svc.decide(actor(u), id, b?.decision, b?.note); }
    feedback(u, id, b) { return this.svc.feedback(actor(u), id, b?.value); }
};
exports.RecommendationsAdminController = RecommendationsAdminController;
__decorate([
    (0, common_1.Get)('catalog'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-E the closed vocabulary of recommendation kinds, the policy numbers and the model mode' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], RecommendationsAdminController.prototype, "catalog", null);
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-E list recommendations (market, status, kind filters); expired ones are marked EXPIRED first' }),
    (0, swagger_1.ApiOkResponse)(ARR),
    __param(0, (0, common_1.Query)('market')),
    __param(1, (0, common_1.Query)('status')),
    __param(2, (0, common_1.Query)('kind')),
    __param(3, (0, common_1.Query)('take')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String]),
    __metadata("design:returntype", void 0)
], RecommendationsAdminController.prototype, "list", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-E one recommendation with its evidence references and rationale in both languages' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], RecommendationsAdminController.prototype, "get", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manageCampaigns')),
    (0, common_1.Post)('run'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-E build proposals from the aggregates now (idempotent per open fingerprint; also what the daily job does)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], RecommendationsAdminController.prototype, "run", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manageCampaigns')),
    (0, common_1.Post)(':id/decision'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-E APPROVE (creates at most a DRAFT) or REJECT (reason required) a PROPOSED recommendation' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], RecommendationsAdminController.prototype, "decide", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manageCampaigns')),
    (0, common_1.Post)(':id/feedback'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-E reviewer feedback (USEFUL or NOT_USEFUL), stored for evaluation' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], RecommendationsAdminController.prototype, "feedback", null);
exports.RecommendationsAdminController = RecommendationsAdminController = __decorate([
    (0, swagger_1.ApiTags)('growth-recommendations'),
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('read')),
    (0, common_1.Controller)('admin/growth/recommendations'),
    __metadata("design:paramtypes", [recommendation_service_1.RecommendationService])
], RecommendationsAdminController);
//# sourceMappingURL=recommendations-admin.controller.js.map