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
exports.NavigationResultDto = exports.AiLabelDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const shared_dto_1 = require("../common/shared.dto");
class AiLabelDto {
    badge;
    copyEn;
    copyAr;
}
exports.AiLabelDto = AiLabelDto;
class NavigationResultDto {
    source;
    ai;
    specialties;
    label;
    fallbackReason;
    emergency;
}
exports.NavigationResultDto = NavigationResultDto;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['AI', 'RULES'] }),
    __metadata("design:type", String)
], NavigationResultDto.prototype, "source", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'true only when a model produced the suggestion (AI badge)' }),
    __metadata("design:type", Boolean)
], NavigationResultDto.prototype, "ai", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [shared_dto_1.SpecialtyDto] }),
    __metadata("design:type", Array)
], NavigationResultDto.prototype, "specialties", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: AiLabelDto, required: false }),
    __metadata("design:type", AiLabelDto)
], NavigationResultDto.prototype, "label", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false, description: 'Why the rules path answered: FLAG_AWAITING_GATE, NO_AI_CONSENT, QUOTA_EXCEEDED, PROVIDER_ERROR...' }),
    __metadata("design:type", String)
], NavigationResultDto.prototype, "fallbackReason", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: shared_dto_1.EmergencyDto, required: false }),
    __metadata("design:type", shared_dto_1.EmergencyDto)
], NavigationResultDto.prototype, "emergency", void 0);
//# sourceMappingURL=ai.dto.js.map