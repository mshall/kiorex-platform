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
Object.defineProperty(exports, "__esModule", { value: true });
exports.BootstrapDto = exports.BootstrapCapabilitiesDto = exports.BootstrapMarketDto = void 0;
const market_registry_1 = require("./market-registry");
const swagger_1 = require("@nestjs/swagger");
class BootstrapMarketDto {
    code;
    currency;
    phoneCode;
    name;
    apiEndpoint;
}
exports.BootstrapMarketDto = BootstrapMarketDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: market_registry_1.DEFAULT_MARKET }),
    __metadata("design:type", String)
], BootstrapMarketDto.prototype, "code", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'EGP' }),
    __metadata("design:type", String)
], BootstrapMarketDto.prototype, "currency", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: '+20' }),
    __metadata("design:type", String)
], BootstrapMarketDto.prototype, "phoneCode", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: { ar: 'مصر', en: 'Egypt' } }),
    __metadata("design:type", Object)
], BootstrapMarketDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'https://api.example.com/api/v1', description: 'Regional API base for this market (binding), with /api/v1' }),
    __metadata("design:type", String)
], BootstrapMarketDto.prototype, "apiEndpoint", void 0);
class BootstrapCapabilitiesDto {
    deepLinks;
    marketplace;
    homeVisits;
}
exports.BootstrapCapabilitiesDto = BootstrapCapabilitiesDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Boolean)
], BootstrapCapabilitiesDto.prototype, "deepLinks", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Boolean)
], BootstrapCapabilitiesDto.prototype, "marketplace", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Boolean)
], BootstrapCapabilitiesDto.prototype, "homeVisits", void 0);
class BootstrapDto {
    defaultMarket;
    resolvedMarket;
    liveMarkets;
    markets;
    locales;
    showMarketSelector;
    minAppVersion;
    apiEndpoint;
    capabilities;
}
exports.BootstrapDto = BootstrapDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: market_registry_1.DEFAULT_MARKET }),
    __metadata("design:type", String)
], BootstrapDto.prototype, "defaultMarket", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: market_registry_1.DEFAULT_MARKET, description: 'The link or account market when LIVE, else the default. Never derived from IP or device location.' }),
    __metadata("design:type", String)
], BootstrapDto.prototype, "resolvedMarket", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [String], example: [market_registry_1.DEFAULT_MARKET] }),
    __metadata("design:type", Array)
], BootstrapDto.prototype, "liveMarkets", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [BootstrapMarketDto] }),
    __metadata("design:type", Array)
], BootstrapDto.prototype, "markets", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['ar', 'en'], isArray: true }),
    __metadata("design:type", Array)
], BootstrapDto.prototype, "locales", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'False unless more than one market is live (founder rule 23 Nov 2026).' }),
    __metadata("design:type", Boolean)
], BootstrapDto.prototype, "showMarketSelector", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ type: String, nullable: true }),
    __metadata("design:type", Object)
], BootstrapDto.prototype, "minAppVersion", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'https://api.example.com/api/v1' }),
    __metadata("design:type", String)
], BootstrapDto.prototype, "apiEndpoint", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: BootstrapCapabilitiesDto }),
    __metadata("design:type", BootstrapCapabilitiesDto)
], BootstrapDto.prototype, "capabilities", void 0);
//# sourceMappingURL=bootstrap.dto.js.map