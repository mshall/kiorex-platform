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
exports.MarketDto = void 0;
const market_registry_1 = require("./market-registry");
const swagger_1 = require("@nestjs/swagger");
class MarketDto {
    code;
    live;
    flag;
    state;
}
exports.MarketDto = MarketDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: market_registry_1.DEFAULT_MARKET }),
    __metadata("design:type", String)
], MarketDto.prototype, "code", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Boolean)
], MarketDto.prototype, "live", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'market.eg.live' }),
    __metadata("design:type", String)
], MarketDto.prototype, "flag", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'LIVE or the reason it is not (AWAITING_GATE, OFF_GLOBAL, ...)' }),
    __metadata("design:type", String)
], MarketDto.prototype, "state", void 0);
//# sourceMappingURL=market.dto.js.map