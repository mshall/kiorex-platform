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
exports.LinkLandingController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const auth_1 = require("../common/auth");
const config_1 = require("../common/config");
const control_plane_public_1 = require("../control-plane/control-plane-public");
const growth_public_1 = require("../growth/growth-public");
const deep_link_rules_1 = require("./deep-link-rules");
const link_landing_1 = require("./link-landing");
const market_service_1 = require("./market.service");
let LinkLandingController = class LinkLandingController {
    flags;
    markets;
    constructor(flags, markets) {
        this.flags = flags;
        this.markets = markets;
    }
    async page(res, kind, value, q, accept) {
        if (!value) {
            res.status(404).json({ code: 'LINK_INVALID', message: 'This link is not valid' });
            return;
        }
        const locale = (0, deep_link_rules_1.normalizeLocale)(typeof q.l === 'string' ? q.l : /^\s*en/i.test(accept ?? '') ? 'en' : 'ar');
        const live = await this.markets.liveMarkets();
        const market = (0, deep_link_rules_1.chooseMarket)((0, deep_link_rules_1.normalizeCc)(q.cc), live, (process.env.DEFAULT_MARKET ?? live[0] ?? '').toUpperCase());
        const c = (0, config_1.cfg)();
        const web = (0, link_landing_1.safeWebOrigin)(c.webBaseUrl, c.isProd);
        const linkBase = (0, link_landing_1.safeWebOrigin)(process.env.PROVIDER_LINK_BASE_URL ?? 'https://kiorly.link', c.isProd);
        const webUrl = kind === 'appointment' ? `${web ?? ''}/appointments/${value}` : kind === 'provider' ? `${linkBase ?? ''}/q/${value}` : `${web ?? ''}/?ref=${value}`;
        if (!(await this.flags.isEnabled(growth_public_1.GROWTH_FLAG.DEEP_LINKS, { market }))) {
            res.redirect(302, webUrl);
            return;
        }
        const nonce = (0, link_landing_1.newNonce)();
        const html = (0, link_landing_1.renderLanding)({
            kind, value, locale, cc: market ? market.toLowerCase() : null, webUrl,
            iosStoreUrl: (0, link_landing_1.safeStoreUrl)(process.env.IOS_APP_STORE_URL, 'ios'), androidStoreUrl: (0, link_landing_1.safeStoreUrl)(process.env.ANDROID_PLAY_STORE_URL, 'android'),
            nonce, draftMarker: !c.isProd,
        });
        for (const [k, v] of Object.entries((0, link_landing_1.landingHeaders)(nonce)))
            res.setHeader(k, v);
        res.status(200).send(html);
    }
    referral(code, q, al, res) {
        return this.page(res, 'referral', (0, deep_link_rules_1.isRefCode)(code) ? code : null, q, al);
    }
    provider(code, q, al, res) {
        return this.page(res, 'provider', (0, deep_link_rules_1.normalizeProviderCode)(code), q, al);
    }
    apptShort(id, q, al, res) {
        return this.page(res, 'appointment', (0, deep_link_rules_1.isSafeSegment)(id) ? id : null, q, al);
    }
    appt(id, q, al, res) {
        return this.page(res, 'appointment', (0, deep_link_rules_1.isSafeSegment)(id) ? id : null, q, al);
    }
};
exports.LinkLandingController = LinkLandingController;
__decorate([
    (0, auth_1.Public)(),
    (0, common_1.Get)('r/:code'),
    __param(0, (0, common_1.Param)('code')),
    __param(1, (0, common_1.Query)()),
    __param(2, (0, common_1.Headers)('accept-language')),
    __param(3, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object, Object]),
    __metadata("design:returntype", void 0)
], LinkLandingController.prototype, "referral", null);
__decorate([
    (0, auth_1.Public)(),
    (0, common_1.Get)('q/:code'),
    __param(0, (0, common_1.Param)('code')),
    __param(1, (0, common_1.Query)()),
    __param(2, (0, common_1.Headers)('accept-language')),
    __param(3, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object, Object]),
    __metadata("design:returntype", void 0)
], LinkLandingController.prototype, "provider", null);
__decorate([
    (0, auth_1.Public)(),
    (0, common_1.Get)('a/:id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Query)()),
    __param(2, (0, common_1.Headers)('accept-language')),
    __param(3, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object, Object]),
    __metadata("design:returntype", void 0)
], LinkLandingController.prototype, "apptShort", null);
__decorate([
    (0, auth_1.Public)(),
    (0, common_1.Get)('appointment/:id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Query)()),
    __param(2, (0, common_1.Headers)('accept-language')),
    __param(3, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object, Object]),
    __metadata("design:returntype", void 0)
], LinkLandingController.prototype, "appt", null);
exports.LinkLandingController = LinkLandingController = __decorate([
    (0, swagger_1.ApiExcludeController)(),
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [control_plane_public_1.FlagsService, market_service_1.MarketService])
], LinkLandingController);
//# sourceMappingURL=link-landing.controller.js.map