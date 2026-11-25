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
exports.MarketOnboardingController = exports.MARKET_ONBOARDING_FLAG = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const auth_1 = require("../../common/auth");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const growth_access_1 = require("../admin/growth-access");
const market_onboarding_service_1 = require("./market-onboarding.service");
exports.MARKET_ONBOARDING_FLAG = 'growth.market_onboarding';
const OBJ = { schema: { type: 'object', additionalProperties: true } };
class CreatePlanDto {
    cc;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Length)(2, 2),
    __metadata("design:type", String)
], CreatePlanDto.prototype, "cc", void 0);
class CsvDto {
    csv;
    csvBase64;
    encoding;
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(6_000_000),
    __metadata("design:type", String)
], CsvDto.prototype, "csv", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(8_000_000),
    __metadata("design:type", String)
], CsvDto.prototype, "csvBase64", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['utf-8', 'windows-1256']),
    __metadata("design:type", String)
], CsvDto.prototype, "encoding", void 0);
const actor = (u) => ({ sub: u.sub, roles: u.roles });
const csv = (b) => ({ text: b.csv, base64: b.csvBase64, encoding: b.encoding });
let MarketOnboardingController = class MarketOnboardingController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    catalogue() { return this.svc.catalogue(); }
    list() { return this.svc.list(); }
    get(cc) { return this.svc.get(cc); }
    readiness(cc) { return this.svc.readiness(cc); }
    geography(cc, level) { return this.svc.geography(cc, level); }
    preview(b) { return this.svc.previewGeography(csv(b)); }
    create(u, b) { return this.svc.create(actor(u), b.cc); }
    step(u, cc, step, body) { return this.svc.setStep(actor(u), cc, step, body); }
    importGeo(u, cc, b) { return this.svc.importGeography(actor(u), cc, csv(b)); }
    publish(u, cc) { return this.svc.publish(actor(u), cc); }
    cancel(u, cc) { return this.svc.cancel(actor(u), cc); }
};
exports.MarketOnboardingController = MarketOnboardingController;
__decorate([
    (0, common_1.Get)('catalogue'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-G steps, data cells and the markets the code fallback already covers' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], MarketOnboardingController.prototype, "catalogue", null);
__decorate([
    (0, common_1.Get)('plans'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-G onboarding plans' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], MarketOnboardingController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('plans/:cc'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-G one plan with its answers' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Param)('cc')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], MarketOnboardingController.prototype, "get", null);
__decorate([
    (0, common_1.Get)('plans/:cc/readiness'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-G readiness checklist (DONE, TODO, AWAITING_CHECKER, NEEDS_HUMAN)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Param)('cc')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], MarketOnboardingController.prototype, "readiness", null);
__decorate([
    (0, common_1.Get)('plans/:cc/geography'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-G imported cities and districts' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Param)('cc')),
    __param(1, (0, common_1.Query)('level')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], MarketOnboardingController.prototype, "geography", null);
__decorate([
    (0, common_1.Post)('geography/preview'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-G validate a geography CSV without writing (errors per line, counts, first rows)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [CsvDto]),
    __metadata("design:returntype", void 0)
], MarketOnboardingController.prototype, "preview", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manage')),
    (0, common_1.Post)('plans'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-G start a plan for a new market (refuses EG, SA, AE and duplicates)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, CreatePlanDto]),
    __metadata("design:returntype", void 0)
], MarketOnboardingController.prototype, "create", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manage')),
    (0, common_1.Put)('plans/:cc/steps/:step'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-G answer one step (validated; references and booleans only, legal texts stay human)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('cc')),
    __param(2, (0, common_1.Param)('step')),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], MarketOnboardingController.prototype, "step", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manage')),
    (0, common_1.Post)('plans/:cc/geography'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-G import the geography CSV (all or nothing; replaces the market geography)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('cc')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, CsvDto]),
    __metadata("design:returntype", void 0)
], MarketOnboardingController.prototype, "importGeo", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manage')),
    (0, common_1.Post)('plans/:cc/publish'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-G draft and submit the three config versions and register the launch-locked live flag (a second super admin approves)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('cc')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], MarketOnboardingController.prototype, "publish", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manage')),
    (0, common_1.Post)('plans/:cc/cancel'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-G cancel an unpublished plan' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('cc')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], MarketOnboardingController.prototype, "cancel", null);
exports.MarketOnboardingController = MarketOnboardingController = __decorate([
    (0, swagger_1.ApiTags)('growth-market-onboarding'),
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('read')),
    (0, control_plane_public_1.RequiresFlag)(exports.MARKET_ONBOARDING_FLAG),
    (0, common_1.Controller)('admin/growth/market-onboarding'),
    __metadata("design:paramtypes", [market_onboarding_service_1.MarketOnboardingService])
], MarketOnboardingController);
//# sourceMappingURL=market-onboarding.controller.js.map