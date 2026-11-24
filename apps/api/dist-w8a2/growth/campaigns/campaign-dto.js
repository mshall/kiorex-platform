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
exports.CampaignSpendDto = exports.AddCreativeDto = exports.DecideApprovalDto = exports.RequestApprovalDto = exports.TransitionDto = exports.UpdateCampaignDto = exports.CreateCampaignDto = exports.OBJECTIVES = void 0;
const contracts_1 = require("@kiorex/contracts");
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
const CHANNELS = [...contracts_1.CAMPAIGN_CHANNELS];
const STATES = [...contracts_1.CAMPAIGN_STATES];
const PAUSE = [...contracts_1.CAMPAIGN_PAUSE_REASONS];
exports.OBJECTIVES = ['AWARENESS', 'ACQUISITION', 'REACTIVATION', 'PROMOTION', 'APP_INSTALL', 'PROVIDER_GROWTH'];
class CreateCampaignDto {
    key;
    name;
    objective;
    market;
    budgetTotalMinor;
    budgetDailyMinor;
    channels;
    startsAt;
    endsAt;
    eligibility;
    utmConfig;
    landingPageId;
}
exports.CreateCampaignDto = CreateCampaignDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Matches)(/^[a-z0-9][a-z0-9-]{1,47}$/),
    __metadata("design:type", String)
], CreateCampaignDto.prototype, "key", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(2),
    (0, class_validator_1.MaxLength)(120),
    __metadata("design:type", String)
], CreateCampaignDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsIn)([...exports.OBJECTIVES]),
    __metadata("design:type", Object)
], CreateCampaignDto.prototype, "objective", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Matches)(/^[A-Z]{2}$/),
    __metadata("design:type", String)
], CreateCampaignDto.prototype, "market", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(2_000_000_000),
    __metadata("design:type", Number)
], CreateCampaignDto.prototype, "budgetTotalMinor", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(2_000_000_000),
    __metadata("design:type", Number)
], CreateCampaignDto.prototype, "budgetDailyMinor", void 0);
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMaxSize)(12),
    (0, class_validator_1.IsIn)(CHANNELS, { each: true }),
    __metadata("design:type", Array)
], CreateCampaignDto.prototype, "channels", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], CreateCampaignDto.prototype, "startsAt", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], CreateCampaignDto.prototype, "endsAt", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsObject)(),
    __metadata("design:type", Object)
], CreateCampaignDto.prototype, "eligibility", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsObject)(),
    __metadata("design:type", Object)
], CreateCampaignDto.prototype, "utmConfig", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(64),
    __metadata("design:type", String)
], CreateCampaignDto.prototype, "landingPageId", void 0);
class UpdateCampaignDto {
    version;
    name;
    objective;
    budgetTotalMinor;
    budgetDailyMinor;
    channels;
    startsAt;
    endsAt;
    eligibility;
    utmConfig;
    landingPageId;
}
exports.UpdateCampaignDto = UpdateCampaignDto;
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], UpdateCampaignDto.prototype, "version", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(2),
    (0, class_validator_1.MaxLength)(120),
    __metadata("design:type", String)
], UpdateCampaignDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)([...exports.OBJECTIVES]),
    __metadata("design:type", Object)
], UpdateCampaignDto.prototype, "objective", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(2_000_000_000),
    __metadata("design:type", Number)
], UpdateCampaignDto.prototype, "budgetTotalMinor", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(2_000_000_000),
    __metadata("design:type", Number)
], UpdateCampaignDto.prototype, "budgetDailyMinor", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMaxSize)(12),
    (0, class_validator_1.IsIn)(CHANNELS, { each: true }),
    __metadata("design:type", Array)
], UpdateCampaignDto.prototype, "channels", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], UpdateCampaignDto.prototype, "startsAt", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], UpdateCampaignDto.prototype, "endsAt", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsObject)(),
    __metadata("design:type", Object)
], UpdateCampaignDto.prototype, "eligibility", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsObject)(),
    __metadata("design:type", Object)
], UpdateCampaignDto.prototype, "utmConfig", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(64),
    __metadata("design:type", String)
], UpdateCampaignDto.prototype, "landingPageId", void 0);
class TransitionDto {
    to;
    reasonCode;
    reason;
    pauseReason;
}
exports.TransitionDto = TransitionDto;
__decorate([
    (0, class_validator_1.IsIn)(STATES),
    __metadata("design:type", String)
], TransitionDto.prototype, "to", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Matches)(/^[A-Z][A-Z0-9_]{2,63}$/),
    __metadata("design:type", String)
], TransitionDto.prototype, "reasonCode", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(300),
    __metadata("design:type", String)
], TransitionDto.prototype, "reason", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(PAUSE),
    __metadata("design:type", String)
], TransitionDto.prototype, "pauseReason", void 0);
class RequestApprovalDto {
    kind;
    budgetTotalMinor;
    budgetDailyMinor;
    note;
}
exports.RequestApprovalDto = RequestApprovalDto;
__decorate([
    (0, class_validator_1.IsIn)(['ACTIVATE', 'BUDGET_INCREASE', 'REACTIVATE']),
    __metadata("design:type", String)
], RequestApprovalDto.prototype, "kind", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(2_000_000_000),
    __metadata("design:type", Number)
], RequestApprovalDto.prototype, "budgetTotalMinor", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(2_000_000_000),
    __metadata("design:type", Number)
], RequestApprovalDto.prototype, "budgetDailyMinor", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(300),
    __metadata("design:type", String)
], RequestApprovalDto.prototype, "note", void 0);
class DecideApprovalDto {
    decision;
    reason;
    snapshotHash;
}
exports.DecideApprovalDto = DecideApprovalDto;
__decorate([
    (0, class_validator_1.IsIn)(['APPROVED', 'REJECTED']),
    __metadata("design:type", String)
], DecideApprovalDto.prototype, "decision", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(300),
    __metadata("design:type", String)
], DecideApprovalDto.prototype, "reason", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Matches)(/^[0-9a-f]{64}$/),
    __metadata("design:type", String)
], DecideApprovalDto.prototype, "snapshotHash", void 0);
class AddCreativeDto {
    kind;
    assetRef;
    locale;
    checksum;
}
exports.AddCreativeDto = AddCreativeDto;
__decorate([
    (0, class_validator_1.IsIn)(['IMAGE', 'VIDEO', 'COPY', 'LANDING', 'LINK']),
    __metadata("design:type", String)
], AddCreativeDto.prototype, "kind", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(3),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], AddCreativeDto.prototype, "assetRef", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['ar', 'en']),
    __metadata("design:type", String)
], AddCreativeDto.prototype, "locale", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Matches)(/^[0-9a-f]{64}$/),
    __metadata("design:type", String)
], AddCreativeDto.prototype, "checksum", void 0);
class CampaignSpendDto {
    day;
    amountMinor;
    note;
}
exports.CampaignSpendDto = CampaignSpendDto;
__decorate([
    (0, class_validator_1.Matches)(/^\d{4}-\d{2}-\d{2}$/),
    __metadata("design:type", String)
], CampaignSpendDto.prototype, "day", void 0);
__decorate([
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(1_000_000_000),
    __metadata("design:type", Number)
], CampaignSpendDto.prototype, "amountMinor", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(300),
    __metadata("design:type", String)
], CampaignSpendDto.prototype, "note", void 0);
//# sourceMappingURL=campaign-dto.js.map