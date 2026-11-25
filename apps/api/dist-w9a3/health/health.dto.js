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
exports.ProvidersDto = exports.ReadyDto = exports.LeadSigningDto = exports.ProviderStatusDto = exports.LiveDto = void 0;
const swagger_1 = require("@nestjs/swagger");
class LiveDto {
    status;
}
exports.LiveDto = LiveDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'ok' }),
    __metadata("design:type", String)
], LiveDto.prototype, "status", void 0);
class ProviderStatusDto {
    provider;
    mode;
    vendor;
    ready;
}
exports.ProviderStatusDto = ProviderStatusDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'whatsapp' }),
    __metadata("design:type", String)
], ProviderStatusDto.prototype, "provider", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['mock', 'real'] }),
    __metadata("design:type", String)
], ProviderStatusDto.prototype, "mode", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'meta' }),
    __metadata("design:type", String)
], ProviderStatusDto.prototype, "vendor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'All required variables for the active mode are present' }),
    __metadata("design:type", Boolean)
], ProviderStatusDto.prototype, "ready", void 0);
class LeadSigningDto {
    status;
    previousAccepted;
}
exports.LeadSigningDto = LeadSigningDto;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['configured', 'not configured'], description: 'PARTNER_LEAD_SIGNING_SECRET present (never the value)' }),
    __metadata("design:type", String)
], LeadSigningDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'A previous secret is also accepted (rotation window)' }),
    __metadata("design:type", Boolean)
], LeadSigningDto.prototype, "previousAccepted", void 0);
class ReadyDto {
    status;
    db;
    providers;
    leadSigning;
}
exports.ReadyDto = ReadyDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'ready' }),
    __metadata("design:type", String)
], ReadyDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'up', required: false, description: 'Internal callers only (loopback / private address without a proxy header, or X-Health-Token); the public answer is just `status`' }),
    __metadata("design:type", String)
], ReadyDto.prototype, "db", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [ProviderStatusDto], required: false, description: 'Internal callers only' }),
    __metadata("design:type", Array)
], ReadyDto.prototype, "providers", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: LeadSigningDto, required: false, description: 'Internal callers only' }),
    __metadata("design:type", LeadSigningDto)
], ReadyDto.prototype, "leadSigning", void 0);
class ProvidersDto {
    providers;
}
exports.ProvidersDto = ProvidersDto;
__decorate([
    (0, swagger_1.ApiProperty)({ type: [ProviderStatusDto] }),
    __metadata("design:type", Array)
], ProvidersDto.prototype, "providers", void 0);
//# sourceMappingURL=health.dto.js.map