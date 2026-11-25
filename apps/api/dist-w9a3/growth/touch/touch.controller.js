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
exports.TouchController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const errors_1 = require("../../common/errors");
const auth_1 = require("../../common/auth");
const privacy_hash_1 = require("../../common/privacy-hash");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const growth_flags_1 = require("../growth-flags");
const touch_sanitizer_1 = require("./touch-sanitizer");
const touch_service_1 = require("./touch.service");
const one = (v) => (Array.isArray(v) ? v[0] : v);
const TOUCH_BODY = { schema: { type: 'object', required: ['landingKind'], properties: { landingKind: { type: 'string' }, utm: { type: 'object', additionalProperties: { type: 'string' } }, clickId: { type: 'object' }, ref: { type: 'string' }, lt: { type: 'string' }, dwellMs: { type: 'integer' } } } };
let TouchController = class TouchController {
    touches;
    constructor(touches) {
        this.touches = touches;
    }
    async touch(req, res, body, consent, market) {
        if ((req.rawBody?.length ?? 0) > touch_sanitizer_1.TOUCH_MAX_BODY_BYTES)
            throw new errors_1.ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
        const parsed = (0, touch_sanitizer_1.parseTouchBody)(body);
        const cookies = (0, touch_sanitizer_1.parseCookies)(one(req.headers.cookie));
        const r = await this.touches.record(parsed, {
            consentAnalytics: consent?.trim().toLowerCase() === 'analytics', cookieVisitorKey: cookies.kxv, ipHash: (0, privacy_hash_1.ipHashOf)(req.ip), userAgent: one(req.headers['user-agent']),
            referer: one(req.headers.referer), origin: one(req.headers.origin), locale: one(req.headers['accept-language'])?.slice(0, 2), market: market && /^[A-Z]{2}$/.test(market) ? market : undefined,
        });
        if (r.visitorKey)
            res.setHeader('Set-Cookie', await this.touches.cookieFor(r.visitorKey, market && /^[A-Z]{2}$/.test(market) ? market : undefined));
        else if (!(consent?.trim().toLowerCase() === 'analytics') && cookies.kxv)
            res.setHeader('Set-Cookie', this.touches.clearCookie());
        return { accepted: true, visitorKeySet: r.visitorKeySet };
    }
};
exports.TouchController = TouchController;
__decorate([
    (0, auth_1.Public)(),
    (0, control_plane_public_1.RequiresFlag)(growth_flags_1.GROWTH_FLAG.ATTRIBUTION),
    (0, common_1.Post)('touch'),
    (0, common_1.HttpCode)(202),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-B record a landing touch (consent-gated visitor identity; no IP, no full UA, no full referrer, no search text)' }),
    (0, swagger_1.ApiHeader)({ name: 'X-KX-Consent', required: false, description: 'analytics, only after the person accepted analytics/attribution consent' }),
    (0, swagger_1.ApiBody)(TOUCH_BODY),
    (0, swagger_1.ApiAcceptedResponse)({ schema: { type: 'object', properties: { accepted: { type: 'boolean' }, visitorKeySet: { type: 'boolean' } } } }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Body)()),
    __param(3, (0, common_1.Headers)('x-kx-consent')),
    __param(4, (0, common_1.Headers)('x-kiorex-market')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object, String, String]),
    __metadata("design:returntype", Promise)
], TouchController.prototype, "touch", null);
exports.TouchController = TouchController = __decorate([
    (0, swagger_1.ApiTags)('growth'),
    (0, common_1.Controller)('growth/v1'),
    __metadata("design:paramtypes", [touch_service_1.TouchService])
], TouchController);
//# sourceMappingURL=touch.controller.js.map