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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SsrVariantService = exports.SSR_SURFACE_BY_PAGE = void 0;
exports.ssrSurfaceFor = ssrSurfaceFor;
const common_1 = require("@nestjs/common");
const touch_sanitizer_1 = require("../touch/touch-sanitizer");
const exposure_service_1 = require("./exposure.service");
const surfaces_1 = require("./surfaces");
const ssr_variant_1 = require("./ssr-variant");
exports.SSR_SURFACE_BY_PAGE = { home: 'landing.home.hero_copy', doctor: 'landing.provider.cta_label', nurse: 'landing.provider.cta_label' };
function ssrSurfaceFor(pageType) {
    const key = exports.SSR_SURFACE_BY_PAGE[pageType];
    if (!key)
        return null;
    const def = (0, surfaces_1.surfaceByKey)(key);
    if (!def?.ssr || !def.platforms.includes('web') || !def.units.includes('VISITOR'))
        return null;
    try {
        (0, surfaces_1.assertSurfaceAllowed)(key);
    }
    catch {
        return null;
    }
    return key;
}
let SsrVariantService = class SsrVariantService {
    exposure;
    constructor(exposure) {
        this.exposure = exposure;
    }
    async resolve(o) {
        const surface = ssrSurfaceFor(o.pageType);
        if (!surface)
            return null;
        const kxe = (0, ssr_variant_1.parseKxe)(o.cookieHeader);
        if (kxe.size === 0)
            return null;
        const kxv = (0, touch_sanitizer_1.parseCookies)(o.cookieHeader).kxv;
        if (!kxv || !touch_sanitizer_1.VISITOR_KEY_PATTERN.test(kxv))
            return null;
        try {
            const list = await this.exposure.assignments((0, exposure_service_1.visitorUnit)(kxv), { market: o.market, locale: o.locale, platform: 'web' }, surface);
            const a = list.find((x) => x.surface === surface);
            if (!a || a.variant === 'control' || kxe.get(a.experiment) !== a.variant)
                return null;
            return { surface, experiment: a.experiment, variant: a.variant };
        }
        catch {
            return null;
        }
    }
};
exports.SsrVariantService = SsrVariantService;
exports.SsrVariantService = SsrVariantService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [exposure_service_1.ExposureService])
], SsrVariantService);
//# sourceMappingURL=ssr-variant.service.js.map