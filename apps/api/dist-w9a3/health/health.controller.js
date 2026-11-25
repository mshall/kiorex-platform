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
exports.HealthController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const auth_1 = require("../common/auth");
const internal_access_1 = require("../common/internal-access");
const prisma_service_1 = require("../prisma/prisma.service");
const startup_1 = require("../common/providers/startup");
const partner_leads_public_1 = require("../partner-leads/partner-leads-public");
const health_dto_1 = require("./health.dto");
let HealthController = class HealthController {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    live() {
        return { status: 'ok' };
    }
    providers(req) {
        if (!(0, internal_access_1.hasInternalHealthAccess)(req))
            throw new common_1.ForbiddenException({ code: 'INTERNAL_ONLY', message: 'Provider status is available to internal callers only' });
        return { providers: (0, startup_1.providerStatus)() };
    }
    async ready(req) {
        try {
            await this.prisma.$queryRaw `SELECT 1`;
            if (!(0, internal_access_1.hasInternalHealthAccess)(req))
                return { status: 'ready' };
            return { status: 'ready', db: 'up', providers: (0, startup_1.providerStatus)(), leadSigning: (0, partner_leads_public_1.leadSigningStatus)() };
        }
        catch {
            throw new common_1.ServiceUnavailableException({ code: 'NOT_READY', message: 'database unavailable' });
        }
    }
};
exports.HealthController = HealthController;
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: health_dto_1.LiveDto }),
    (0, auth_1.Public)(),
    (0, common_1.Get)('live'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], HealthController.prototype, "live", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: health_dto_1.ProvidersDto }),
    (0, auth_1.Public)(),
    (0, common_1.Get)('providers'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], HealthController.prototype, "providers", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: health_dto_1.ReadyDto }),
    (0, auth_1.Public)(),
    (0, common_1.Get)('ready'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], HealthController.prototype, "ready", null);
exports.HealthController = HealthController = __decorate([
    (0, swagger_1.ApiTags)('health'),
    (0, common_1.Controller)('health'),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], HealthController);
//# sourceMappingURL=health.controller.js.map