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
exports.CampaignsPublicController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const auth_1 = require("../../common/auth");
const privacy_hash_1 = require("../../common/privacy-hash");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const prisma_service_1 = require("../../prisma/prisma.service");
const growth_flags_1 = require("../growth-flags");
const growth_errors_1 = require("../growth-errors");
const growth_limiter_1 = require("../growth-limiter");
const campaign_utm_1 = require("./campaign-utm");
const OBJ = { schema: { type: 'object', additionalProperties: true } };
const UTM = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const site = () => process.env.SITE_CANONICAL_HOST?.replace(/\/+$/, '') || 'https://kiorex.com';
let CampaignsPublicController = class CampaignsPublicController {
    prisma;
    limiter;
    constructor(prisma, limiter) {
        this.prisma = prisma;
        this.limiter = limiter;
    }
    async resolve(req, utm, locale, market) {
        await this.limiter.take('campaign-resolve', (0, privacy_hash_1.ipHashOf)(req.ip), (0, growth_limiter_1.growthLimits)().touchPerMin);
        if (typeof utm !== 'string' || !UTM.test(utm))
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'utm_campaign must be a lower-case campaign value such as eg-ramadan-checkup');
        const mk = market && /^[A-Z]{2}$/.test(market) ? market : growth_flags_1.GROWTH_DEFAULT_MARKET;
        const c = await this.prisma.growthCampaign.findFirst({ where: { market: mk, utmCampaign: utm, status: 'ACTIVE' } });
        if (!c)
            throw (0, growth_errors_1.growthError)('CAMPAIGN_NOT_FOUND', 'No active campaign matches');
        const loc = locale === 'en' || locale === 'ar' ? locale : undefined;
        const links = (0, campaign_utm_1.trackedLinks)({ market: c.market, key: c.key, channels: c.channels, config: c.utmConfig, host: site(), locale: loc });
        return { landing: { path: links.landingPath, locale: c.utmConfig.locale ?? loc ?? 'ar', landingPageId: c.landingPageId ?? null }, campaignToken: c.utmCampaign };
    }
};
exports.CampaignsPublicController = CampaignsPublicController;
__decorate([
    (0, auth_1.Public)(),
    (0, control_plane_public_1.RequiresFlag)(growth_flags_1.GROWTH_FLAG.CAMPAIGNS),
    (0, common_1.Get)('resolve'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-A resolve an ACTIVE campaign UTM to its landing target and campaign token' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('utm_campaign')),
    __param(2, (0, common_1.Query)('locale')),
    __param(3, (0, common_1.Headers)('x-kiorex-market')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", Promise)
], CampaignsPublicController.prototype, "resolve", null);
exports.CampaignsPublicController = CampaignsPublicController = __decorate([
    (0, swagger_1.ApiTags)('growth'),
    (0, common_1.Controller)('growth/v1/campaign'),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, growth_limiter_1.GrowthLimiter])
], CampaignsPublicController);
//# sourceMappingURL=campaigns-public.controller.js.map