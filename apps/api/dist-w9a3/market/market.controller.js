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
exports.MarketController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const auth_1 = require("../common/auth");
const market_service_1 = require("./market.service");
const market_dto_1 = require("./market.dto");
const swagger_2 = require("@nestjs/swagger");
let MarketController = class MarketController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    async list(all) {
        const rows = await this.svc.list();
        return all === 'true' ? rows : rows.filter((r) => r.live);
    }
};
exports.MarketController = MarketController;
__decorate([
    (0, auth_1.Public)(),
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'Markets (countries) that are LIVE; use for the sign-up country picker. ?all=true also lists gated markets with their state' }),
    (0, swagger_2.ApiOkResponse)({ type: market_dto_1.MarketDto, isArray: true }),
    __param(0, (0, common_1.Query)('all')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], MarketController.prototype, "list", null);
exports.MarketController = MarketController = __decorate([
    (0, swagger_1.ApiTags)('market'),
    (0, common_1.Controller)('markets'),
    __metadata("design:paramtypes", [market_service_1.MarketService])
], MarketController);
//# sourceMappingURL=market.controller.js.map