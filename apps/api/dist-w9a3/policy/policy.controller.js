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
exports.PolicyController = exports.PolicyClearResultDto = exports.PolicySetResultDto = exports.SetPolicyBody = exports.PolicyDescribeDto = exports.PolicyItemDto = exports.PolicyOverrideDto = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const auth_1 = require("../common/auth");
const policy_service_1 = require("./policy.service");
class PolicyOverrideDto {
    scope;
    scopeId;
    value;
    note;
    updatedBy;
    updatedAt;
}
exports.PolicyOverrideDto = PolicyOverrideDto;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['GLOBAL', 'MARKET', 'ORG'] }),
    __metadata("design:type", String)
], PolicyOverrideDto.prototype, "scope", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PolicyOverrideDto.prototype, "scopeId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: 'object', additionalProperties: true }),
    __metadata("design:type", Object)
], PolicyOverrideDto.prototype, "value", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], PolicyOverrideDto.prototype, "note", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PolicyOverrideDto.prototype, "updatedBy", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], PolicyOverrideDto.prototype, "updatedAt", void 0);
class PolicyItemDto {
    key;
    titleEn;
    titleAr;
    descriptionEn;
    descriptionAr;
    value;
    source;
    proposedDefault;
    note;
    defaults;
    scopes;
    overrides;
}
exports.PolicyItemDto = PolicyItemDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'pay.deposit_default' }),
    __metadata("design:type", String)
], PolicyItemDto.prototype, "key", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PolicyItemDto.prototype, "titleEn", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PolicyItemDto.prototype, "titleAr", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PolicyItemDto.prototype, "descriptionEn", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PolicyItemDto.prototype, "descriptionAr", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: 'object', additionalProperties: true, description: 'Resolved value for the market' }),
    __metadata("design:type", Object)
], PolicyItemDto.prototype, "value", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['ORG', 'MARKET', 'GLOBAL', 'PROPOSED_DEFAULT'] }),
    __metadata("design:type", String)
], PolicyItemDto.prototype, "source", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'true while the value is the in-code PROPOSED_DEFAULT (founder-delegated 23 Nov 2026), i.e. no override stored' }),
    __metadata("design:type", Boolean)
], PolicyItemDto.prototype, "proposedDefault", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], PolicyItemDto.prototype, "note", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: 'object', additionalProperties: true }),
    __metadata("design:type", Object)
], PolicyItemDto.prototype, "defaults", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [String] }),
    __metadata("design:type", Array)
], PolicyItemDto.prototype, "scopes", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [PolicyOverrideDto] }),
    __metadata("design:type", Array)
], PolicyItemDto.prototype, "overrides", void 0);
class PolicyDescribeDto {
    market;
    proposedDefaultNote;
    items;
}
exports.PolicyDescribeDto = PolicyDescribeDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'EG' }),
    __metadata("design:type", String)
], PolicyDescribeDto.prototype, "market", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PolicyDescribeDto.prototype, "proposedDefaultNote", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [PolicyItemDto] }),
    __metadata("design:type", Array)
], PolicyDescribeDto.prototype, "items", void 0);
class SetPolicyBody {
    scope;
    scopeId;
    value;
    note;
}
exports.SetPolicyBody = SetPolicyBody;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['GLOBAL', 'MARKET', 'ORG'] }),
    (0, class_validator_1.IsIn)(['GLOBAL', 'MARKET', 'ORG']),
    __metadata("design:type", String)
], SetPolicyBody.prototype, "scope", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'MARKET: ISO country code; ORG: partner / clinic organisation id; GLOBAL: omit' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(64),
    __metadata("design:type", String)
], SetPolicyBody.prototype, "scopeId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: 'object', additionalProperties: true, description: 'Validated against the policy definition (e.g. { enabled, percentBps, capMajor })' }),
    (0, class_validator_1.IsObject)(),
    __metadata("design:type", Object)
], SetPolicyBody.prototype, "value", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(300),
    __metadata("design:type", String)
], SetPolicyBody.prototype, "note", void 0);
class PolicySetResultDto {
    key;
    scope;
    scopeId;
    value;
}
exports.PolicySetResultDto = PolicySetResultDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PolicySetResultDto.prototype, "key", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PolicySetResultDto.prototype, "scope", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PolicySetResultDto.prototype, "scopeId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: 'object', additionalProperties: true }),
    __metadata("design:type", Object)
], PolicySetResultDto.prototype, "value", void 0);
class PolicyClearResultDto {
    cleared;
}
exports.PolicyClearResultDto = PolicyClearResultDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], PolicyClearResultDto.prototype, "cleared", void 0);
let PolicyController = class PolicyController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    describe(market = 'EG') { return this.svc.describe(market); }
    set(u, key, b) { return this.svc.set(key, b, u.sub); }
    clear(u, key, scope, scopeId) { return this.svc.clear(key, { scope, scopeId }, u.sub); }
};
exports.PolicyController = PolicyController;
__decorate([
    (0, auth_1.OpsOnly)(),
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'OP: business policies resolved for a market (default EG), with source and overrides' }),
    (0, swagger_1.ApiQuery)({ name: 'market', required: false, description: 'ISO country code (default EG)' }),
    (0, swagger_1.ApiOkResponse)({ type: PolicyDescribeDto }),
    __param(0, (0, common_1.Query)('market')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], PolicyController.prototype, "describe", null);
__decorate([
    (0, auth_1.SuperAdminOnly)(),
    (0, common_1.Put)(':key'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'SA: set a policy override at GLOBAL, MARKET or ORG scope (validated, audited)' }),
    (0, swagger_1.ApiOkResponse)({ type: PolicySetResultDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('key')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, SetPolicyBody]),
    __metadata("design:returntype", void 0)
], PolicyController.prototype, "set", null);
__decorate([
    (0, auth_1.SuperAdminOnly)(),
    (0, common_1.Delete)(':key'),
    (0, swagger_1.ApiOperation)({ summary: 'SA: remove an override (falls back to the next level / PROPOSED_DEFAULT)' }),
    (0, swagger_1.ApiQuery)({ name: 'scope', enum: ['GLOBAL', 'MARKET', 'ORG'] }),
    (0, swagger_1.ApiQuery)({ name: 'scopeId', required: false }),
    (0, swagger_1.ApiOkResponse)({ type: PolicyClearResultDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('key')),
    __param(2, (0, common_1.Query)('scope')),
    __param(3, (0, common_1.Query)('scopeId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], PolicyController.prototype, "clear", null);
exports.PolicyController = PolicyController = __decorate([
    (0, swagger_1.ApiTags)('policy'),
    (0, common_1.Controller)('admin/policy'),
    __metadata("design:paramtypes", [policy_service_1.PolicyService])
], PolicyController);
//# sourceMappingURL=policy.controller.js.map