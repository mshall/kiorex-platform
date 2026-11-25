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
exports.ExperimentsPublicController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const auth_1 = require("../../common/auth");
const errors_1 = require("../../common/errors");
const privacy_hash_1 = require("../../common/privacy-hash");
const growth_flags_1 = require("../growth-flags");
const growth_limiter_1 = require("../growth-limiter");
const touch_sanitizer_1 = require("../touch/touch-sanitizer");
const exposure_service_1 = require("./exposure.service");
const experiment_types_1 = require("./experiment.types");
const ssr_variant_1 = require("./ssr-variant");
const one = (v) => (Array.isArray(v) ? v[0] : v);
const OBJ = { schema: { type: 'object', additionalProperties: true } };
const KEY = /^[a-z0-9][a-z0-9_-]{1,62}$/;
function ctxOf(req, q, market) {
    return {
        market: market && /^[A-Z]{2}$/.test(market) ? market : growth_flags_1.GROWTH_DEFAULT_MARKET,
        locale: q.locale === 'ar' || q.locale === 'en' ? q.locale : (one(req.headers['accept-language'])?.slice(0, 2) === 'en' ? 'en' : one(req.headers['accept-language'])?.slice(0, 2) === 'ar' ? 'ar' : undefined),
        platform: q.platform === 'web' || q.platform === 'ios' || q.platform === 'android' ? q.platform : undefined,
        stage: q.stage === 'new' || q.stage === 'returning' ? q.stage : undefined,
    };
}
let ExperimentsPublicController = class ExperimentsPublicController {
    exposure;
    limiter;
    constructor(exposure, limiter) {
        this.exposure = exposure;
        this.limiter = limiter;
    }
    visitor(req, consent) {
        if (consent?.trim().toLowerCase() !== 'analytics')
            return null;
        const k = (0, touch_sanitizer_1.parseCookies)(one(req.headers.cookie)).kxv;
        return k && touch_sanitizer_1.VISITOR_KEY_PATTERN.test(k) ? (0, exposure_service_1.visitorUnit)(k) : null;
    }
    headers(res) { res.setHeader('Cache-Control', `private, max-age=${experiment_types_1.EXPERIMENT_POLICY.assignmentTtlSeconds}`); res.setHeader('Vary', 'Cookie, X-KX-Consent, Authorization'); }
    async visitorAssignments(req, res, q, consent, market) {
        await this.limiter.take('experiments-assign', (0, privacy_hash_1.ipHashOf)(req.ip), (0, growth_limiter_1.growthLimits)().touchPerMin);
        const surface = q.surface && KEY.test(q.surface.replace(/\./g, '-')) ? q.surface : undefined;
        const unit = this.visitor(req, consent);
        const ctx = ctxOf(req, q, market);
        const assignments = await this.exposure.assignments(unit, ctx, surface);
        this.headers(res);
        if (unit) {
            const c = (0, ssr_variant_1.setCookieFor)(assignments.map((a) => ({ key: a.experiment, variant: a.variant })), true);
            if (c)
                res.setHeader('Set-Cookie', c);
        }
        else if (/(?:^|;\s*)kxe=/.test(one(req.headers.cookie) ?? ''))
            res.setHeader('Set-Cookie', (0, ssr_variant_1.clearCookie)());
        return { assignments, ttlSeconds: experiment_types_1.EXPERIMENT_POLICY.assignmentTtlSeconds, unit: unit ? 'VISITOR' : 'NONE' };
    }
    async visitorExposure(req, b, consent, market) {
        await this.limiter.take('experiments-expose', (0, privacy_hash_1.ipHashOf)(req.ip), (0, growth_limiter_1.growthLimits)().touchPerMin);
        if (typeof b?.experiment !== 'string' || !KEY.test(b.experiment))
            throw new errors_1.ApiError(400, 'GROWTH_INVALID_REQUEST', 'experiment is required');
        return this.exposure.expose(this.visitor(req, consent), ctxOf(req, {}, market), b.experiment);
    }
    async myAssignments(u, req, res, q, market) {
        const assignments = await this.exposure.assignments((0, exposure_service_1.subUnit)(u.sub), ctxOf(req, q, market), q.surface);
        this.headers(res);
        return { assignments, ttlSeconds: experiment_types_1.EXPERIMENT_POLICY.assignmentTtlSeconds, unit: 'SUB' };
    }
    myExposure(u, req, b, market) {
        if (typeof b?.experiment !== 'string' || !KEY.test(b.experiment))
            throw new errors_1.ApiError(400, 'GROWTH_INVALID_REQUEST', 'experiment is required');
        return this.exposure.expose((0, exposure_service_1.subUnit)(u.sub), ctxOf(req, {}, market), b.experiment);
    }
};
exports.ExperimentsPublicController = ExperimentsPublicController;
__decorate([
    (0, auth_1.Public)(),
    (0, common_1.Get)('assignments'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-A assignments of the consented visitor (empty list without consent)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Query)()),
    __param(3, (0, common_1.Headers)('x-kx-consent')),
    __param(4, (0, common_1.Headers)('x-kiorex-market')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object, String, String]),
    __metadata("design:returntype", Promise)
], ExperimentsPublicController.prototype, "visitorAssignments", null);
__decorate([
    (0, auth_1.Public)(),
    (0, common_1.Post)('exposures'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-A record that the consented visitor saw its variant (idempotent)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Headers)('x-kx-consent')),
    __param(3, (0, common_1.Headers)('x-kiorex-market')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, String]),
    __metadata("design:returntype", Promise)
], ExperimentsPublicController.prototype, "visitorExposure", null);
__decorate([
    (0, common_1.Get)('me/assignments'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-A assignments of the signed-in person for in-product surfaces' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __param(3, (0, common_1.Query)()),
    __param(4, (0, common_1.Headers)('x-kiorex-market')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object, Object, String]),
    __metadata("design:returntype", Promise)
], ExperimentsPublicController.prototype, "myAssignments", null);
__decorate([
    (0, common_1.Post)('me/exposures'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-A record that the signed-in person saw its variant (idempotent)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Body)()),
    __param(3, (0, common_1.Headers)('x-kiorex-market')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object, String]),
    __metadata("design:returntype", void 0)
], ExperimentsPublicController.prototype, "myExposure", null);
exports.ExperimentsPublicController = ExperimentsPublicController = __decorate([
    (0, swagger_1.ApiTags)('growth-experiments'),
    (0, common_1.Controller)('growth/v1/experiments'),
    __metadata("design:paramtypes", [exposure_service_1.ExposureService, growth_limiter_1.GrowthLimiter])
], ExperimentsPublicController);
//# sourceMappingURL=experiments-public.controller.js.map