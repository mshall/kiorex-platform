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
exports.VisitorConsentController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const auth_1 = require("../../common/auth");
const touch_service_1 = require("../touch/touch.service");
const touch_sanitizer_1 = require("../touch/touch-sanitizer");
const visitor_consent_service_1 = require("./visitor-consent.service");
const OBJ = { schema: { type: 'object', additionalProperties: true } };
let VisitorConsentController = class VisitorConsentController {
    svc;
    touches;
    constructor(svc, touches) {
        this.svc = svc;
        this.touches = touches;
    }
    versions(market) { return this.svc.textVersions(market && /^[A-Z]{2}$/.test(market) ? market : undefined); }
    async record(req, res, body, market) {
        const r = await this.svc.record({ analytics: body?.analytics, marketing: body?.marketing, textVersion: body?.textVersion, source: body?.source, evidence: body?.evidence }, { ip: req.ip, market: market && /^[A-Z]{2}$/.test(market) ? market : undefined });
        if (!r.analytics && (0, touch_sanitizer_1.parseCookies)(Array.isArray(req.headers.cookie) ? req.headers.cookie[0] : req.headers.cookie).kxv)
            res.setHeader('Set-Cookie', this.touches.clearCookie());
        return r;
    }
};
exports.VisitorConsentController = VisitorConsentController;
__decorate([
    (0, auth_1.Public)(),
    (0, common_1.Get)('consent/versions'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-I current consent text version ids (the banner stores the version it showed)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Headers)('x-kiorex-market')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], VisitorConsentController.prototype, "versions", null);
__decorate([
    (0, auth_1.Public)(),
    (0, common_1.Post)('consent'),
    (0, common_1.HttpCode)(201),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-I record an anonymous visitor consent decision (audit row keyed by a random consent id; sets nothing else server-side)' }),
    (0, swagger_1.ApiBody)({ schema: { type: 'object', required: ['analytics'], properties: { analytics: { type: 'boolean' }, marketing: { type: 'boolean' }, textVersion: { type: 'string' }, source: { type: 'string', enum: ['web', 'app', 'widget'] }, evidence: { type: 'string' } } } }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Body)()),
    __param(3, (0, common_1.Headers)('x-kiorex-market')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object, String]),
    __metadata("design:returntype", Promise)
], VisitorConsentController.prototype, "record", null);
exports.VisitorConsentController = VisitorConsentController = __decorate([
    (0, swagger_1.ApiTags)('growth'),
    (0, common_1.Controller)('growth/v1'),
    __metadata("design:paramtypes", [visitor_consent_service_1.VisitorConsentService, touch_service_1.TouchService])
], VisitorConsentController);
//# sourceMappingURL=visitor-consent.controller.js.map