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
exports.PartnersController = exports.PartnerBody = exports.PartnerDto = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const auth_1 = require("../common/auth");
const partners_service_1 = require("./partners.service");
class PartnerDto {
    id;
    kind;
    name;
    baseUrl;
    clientKey;
    clientSecret;
    webhookSecret;
    active;
    apiPath;
    labRegistrationId;
    createdAt;
    updatedAt;
}
exports.PartnerDto = PartnerDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PartnerDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['pharmacy', 'lab', 'lab_nurse'] }),
    __metadata("design:type", String)
], PartnerDto.prototype, "kind", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PartnerDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Host only, e.g. http://localhost:3100' }),
    __metadata("design:type", String)
], PartnerDto.prototype, "baseUrl", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PartnerDto.prototype, "clientKey", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Always masked' }),
    __metadata("design:type", String)
], PartnerDto.prototype, "clientSecret", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Always masked' }),
    __metadata("design:type", String)
], PartnerDto.prototype, "webhookSecret", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Boolean)
], PartnerDto.prototype, "active", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Contract path appended to baseUrl' }),
    __metadata("design:type", String)
], PartnerDto.prototype, "apiPath", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, description: 'lab_nurse only: the lab registration (same lab tenant) this nurse client belongs to' }),
    __metadata("design:type", Object)
], PartnerDto.prototype, "labRegistrationId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PartnerDto.prototype, "createdAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PartnerDto.prototype, "updatedAt", void 0);
class PartnerBody {
    name;
    baseUrl;
    clientKey;
    clientSecret;
    webhookSecret;
    active;
    labRegistrationId;
}
exports.PartnerBody = PartnerBody;
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(120),
    __metadata("design:type", String)
], PartnerBody.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], PartnerBody.prototype, "baseUrl", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(120),
    __metadata("design:type", String)
], PartnerBody.prototype, "clientKey", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Write-only' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], PartnerBody.prototype, "clientSecret", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Write-only' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], PartnerBody.prototype, "webhookSecret", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], PartnerBody.prototype, "active", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'lab_nurse only: id of the lab registration this nurse client belongs to (routes Nurse lab orders to the lab that owns them); empty string clears' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(80),
    __metadata("design:type", String)
], PartnerBody.prototype, "labRegistrationId", void 0);
let PartnersController = class PartnersController {
    registry;
    constructor(registry) {
        this.registry = registry;
    }
    list() { return this.registry.list(); }
    create(kind, b) { return this.registry.upsert(kind, undefined, b); }
    update(kind, id, b) { return this.registry.upsert(kind, id, b); }
};
exports.PartnersController = PartnersController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'OP: partner registrations (Kiorly Pharmacy / Lab); secrets masked' }),
    (0, swagger_1.ApiOkResponse)({ type: PartnerDto, isArray: true }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], PartnersController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(':kind'),
    (0, common_1.HttpCode)(201),
    (0, swagger_1.ApiOperation)({ summary: 'OP: register a partner (pharmacy|lab)' }),
    (0, swagger_1.ApiOkResponse)({ type: PartnerDto }),
    __param(0, (0, common_1.Param)('kind')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, PartnerBody]),
    __metadata("design:returntype", void 0)
], PartnersController.prototype, "create", null);
__decorate([
    (0, common_1.Put)(':kind/:id'),
    (0, swagger_1.ApiOperation)({ summary: 'OP: update base URL / keys / active of a partner registration' }),
    (0, swagger_1.ApiOkResponse)({ type: PartnerDto }),
    __param(0, (0, common_1.Param)('kind')),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, PartnerBody]),
    __metadata("design:returntype", void 0)
], PartnersController.prototype, "update", null);
exports.PartnersController = PartnersController = __decorate([
    (0, swagger_1.ApiTags)('ops'),
    (0, auth_1.OpsOnly)(),
    (0, common_1.Controller)('admin/partners'),
    __metadata("design:paramtypes", [partners_service_1.PartnerRegistry])
], PartnersController);
//# sourceMappingURL=partners.controller.js.map