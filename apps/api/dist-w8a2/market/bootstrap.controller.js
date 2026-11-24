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
exports.BootstrapController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const auth_1 = require("../common/auth");
const bootstrap_dto_1 = require("./bootstrap.dto");
const bootstrap_service_1 = require("./bootstrap.service");
let BootstrapController = class BootstrapController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    get(cc) { return this.svc.get(cc); }
};
exports.BootstrapController = BootstrapController;
__decorate([
    (0, auth_1.Public)(),
    (0, common_1.Get)(),
    (0, common_1.Header)('Cache-Control', 'public, max-age=60'),
    (0, common_1.Header)('Vary', 'Accept-Encoding'),
    (0, swagger_1.ApiOperation)({ summary: 'Market-aware app and web bootstrap: live markets, regional API endpoint and capabilities. Public, cacheable for 60 seconds. The market comes from the account or link context (?cc=), never from the caller location.' }),
    (0, swagger_1.ApiQuery)({ name: 'cc', required: false, description: 'Market hint from a link or the signed-in account (ISO alpha-2). Honoured only when that market is live; otherwise the default market is returned.' }),
    (0, swagger_1.ApiOkResponse)({ description: 'Bootstrap', type: bootstrap_dto_1.BootstrapDto }),
    __param(0, (0, common_1.Query)('cc')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], BootstrapController.prototype, "get", null);
exports.BootstrapController = BootstrapController = __decorate([
    (0, swagger_1.ApiTags)('bootstrap'),
    (0, common_1.Controller)('bootstrap'),
    __metadata("design:paramtypes", [bootstrap_service_1.BootstrapService])
], BootstrapController);
//# sourceMappingURL=bootstrap.controller.js.map