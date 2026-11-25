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
exports.WidgetRequestGuard = exports.WIDGET_HEADER = void 0;
const market_core_public_1 = require("../market/market-core-public");
const common_1 = require("@nestjs/common");
const contracts_1 = require("@kiorex/contracts");
const errors_1 = require("../common/errors");
const privacy_hash_1 = require("../common/privacy-hash");
const control_plane_public_1 = require("../control-plane/control-plane-public");
const prisma_service_1 = require("../prisma/prisma.service");
const fraud_public_1 = require("../growth/fraud/fraud-public");
const widget_audit_service_1 = require("./widget-audit.service");
const widget_limiter_1 = require("./widget-limiter");
const widget_origins_1 = require("./widget-origins");
const widget_policy_service_1 = require("./widget-policy.service");
const widget_registration_service_1 = require("./widget-registration.service");
const widget_token_1 = require("./widget-token");
exports.WIDGET_HEADER = 'x-kx-widget';
const P = '/api/v1';
const ROUTES = [
    { m: 'GET', re: new RegExp(`^${P}/widget/v1/config$`), cls: 'config' },
    { m: 'GET', re: new RegExp(`^${P}/providers/([^/]+)/slots$`), cls: 'slots' },
    { m: 'GET', re: new RegExp(`^${P}/providers/([^/]+)$`), cls: 'read' },
    { m: 'GET', re: new RegExp(`^${P}/specialties$`), cls: 'read' },
    { m: 'POST', re: new RegExp(`^${P}/bookings$`), cls: 'book' },
    { m: 'POST', re: new RegExp(`^${P}/bookings/([^/]+)/(confirm|release|deposit-checkout)$`), cls: 'confirm' },
    { m: 'GET', re: new RegExp(`^${P}/bookings/([^/]+)$`), cls: 'read' },
    { m: 'GET', re: new RegExp(`^${P}/me/profile$`), cls: 'read' },
    { m: 'PUT', re: new RegExp(`^${P}/me/profile$`), cls: 'profile' },
    { m: 'POST', re: new RegExp(`^${P}/growth/v1/touch$`), cls: 'touch' },
];
let WidgetRequestGuard = class WidgetRequestGuard {
    flags;
    regs;
    audit;
    limiter;
    prisma;
    policy;
    fraud;
    constructor(flags, regs, audit, limiter, prisma, policy, fraud) {
        this.flags = flags;
        this.regs = regs;
        this.audit = audit;
        this.limiter = limiter;
        this.prisma = prisma;
        this.policy = policy;
        this.fraud = fraud;
    }
    async deny(org, origin, reason, surface) {
        await this.audit.denied(org, origin, reason, surface);
        if (this.fraud)
            void this.fraud.onWidgetDenied({ org, origin, reason }).catch(() => undefined);
    }
    async canActivate(ctx) {
        const req = ctx.switchToHttp().getRequest();
        const raw = req.headers?.[exports.WIDGET_HEADER];
        if (raw === undefined)
            return true;
        const token = Array.isArray(raw) ? raw[0] : raw;
        const path = String(req.originalUrl ?? req.url ?? '').split('?')[0];
        const method = String(req.method ?? 'GET').toUpperCase();
        const v = (0, widget_token_1.verifyWidgetToken)(token);
        if (!v.ok) {
            await this.deny(null, req.headers?.origin, 'TOKEN_INVALID', path);
            throw new errors_1.ApiError(401, 'WIDGET_TOKEN_INVALID', 'Widget session is not valid or has expired', { reason: v.reason });
        }
        const { org, origin } = v.claims;
        if (await this.fraud?.originThrottled(origin))
            throw new errors_1.ApiError(429, 'WIDGET_ORIGIN_THROTTLED', 'Too many requests from this site, try again later');
        await this.flags.assertEnabled('growth.widgets', { market: market_core_public_1.DEFAULT_MARKET });
        const route = ROUTES.find((r) => r.m === method && r.re.test(path));
        if (!route) {
            await this.deny(org, origin, 'ROUTE_NOT_ALLOWED', `${method} ${path}`);
            throw (0, errors_1.forbidden)('WIDGET_ROUTE_NOT_ALLOWED', 'This request is not available to the widget');
        }
        const reg = await this.regs.byOrg(org);
        const allowed = reg ? this.regs.effectiveOrigins(reg) : [];
        const sandbox = v.claims.sbx === 1 && (0, widget_origins_1.originOfUrl)(origin) === (0, widget_origins_1.widgetSelfOrigin)(req.protocol, req.headers?.host);
        if (!reg || (!allowed.includes(origin) && !sandbox)) {
            await this.deny(org, origin, 'ORIGIN_NOT_ALLOWED', path);
            throw new errors_1.ApiError(contracts_1.GROWTH_ERROR_STATUS.GROWTH_WIDGET_ORIGIN_NOT_ALLOWED, 'GROWTH_WIDGET_ORIGIN_NOT_ALLOWED', 'This site is not allowed to embed the booking widget');
        }
        const self = (0, widget_origins_1.widgetSelfOrigin)(req.protocol, req.headers?.host);
        const seen = (0, widget_origins_1.originOfUrl)(req.headers?.origin) ?? (method === 'GET' ? (0, widget_origins_1.originOfUrl)(req.headers?.referer) : null);
        if ((seen && seen !== self) || (!seen && method !== 'GET')) {
            await this.deny(org, seen ?? req.headers?.origin ?? '', 'ORIGIN_MISMATCH', path);
            throw (0, errors_1.forbidden)('WIDGET_ORIGIN_MISMATCH', 'Request did not come from the widget');
        }
        const ip = (0, privacy_hash_1.ipHashOf)(req.ip);
        const L = (0, widget_limiter_1.widgetLimits)();
        switch (route.cls) {
            case 'slots':
                await this.limiter.take('slots-ip', ip, L.slotsPerMinIp);
                await this.limiter.take('slots-org', org, L.slotsPerMinOrg);
                await this.assertProviderInScope(org, route.re.exec(path)[1]);
                break;
            case 'book': {
                await this.limiter.take('booking-ip', ip, L.bookingPerMinIp);
                const body = req.body ?? {};
                await this.assertProviderInScope(org, String(body.providerId ?? ''));
                body.channel = 'CLINIC_LINK';
                body.bookingPageSlug = reg.orgSlug ?? reg.orgRef;
                req.body = body;
                const sub = req.user?.sub;
                if (sub) {
                    const max = (await this.policy.get()).maxActiveHoldsPerPhone;
                    const held = await this.prisma.bookingIntent.count({ where: { sub, status: 'HELD', channel: 'CLINIC_LINK', holdExpiresAt: { gt: new Date() } } });
                    if (held >= max)
                        throw new errors_1.ApiError(429, 'WIDGET_HOLD_LIMIT', 'You already hold the maximum number of slots; finish or release one first', { max });
                }
                break;
            }
            case 'confirm':
                await this.limiter.take('confirm-ip', ip, L.confirmPerMinIp);
                break;
            case 'profile': {
                const b = req.body ?? {};
                req.body = { ...(typeof b.nameEn === 'string' ? { nameEn: b.nameEn.slice(0, 120) } : {}), ...(b.preferredLocale === 'ar' || b.preferredLocale === 'en' ? { preferredLocale: b.preferredLocale } : {}) };
                await this.limiter.take('confirm-ip', ip, L.confirmPerMinIp);
                break;
            }
            case 'config':
                await this.limiter.take('config-ip', ip, L.configPerMin);
                break;
            default: break;
        }
        if (route.cls === 'book' || route.cls === 'confirm')
            req.headers['x-kx-platform'] = 'widget';
        req.widget = { org, origin, orgSlug: reg.orgSlug ?? reg.orgRef, sandbox };
        return true;
    }
    async assertProviderInScope(org, providerId) {
        const p = providerId ? await this.prisma.provider.findUnique({ where: { id: providerId }, select: { clinicId: true } }) : null;
        if (p && p.clinicId !== org) {
            await this.deny(org, null, 'OUT_OF_SCOPE', 'provider');
            throw (0, errors_1.forbidden)('WIDGET_PROVIDER_OUT_OF_SCOPE', 'This provider is not part of the widget');
        }
    }
};
exports.WidgetRequestGuard = WidgetRequestGuard;
exports.WidgetRequestGuard = WidgetRequestGuard = __decorate([
    (0, common_1.Injectable)(),
    __param(6, (0, common_1.Optional)()),
    __param(6, (0, common_1.Inject)(fraud_public_1.FRAUD_SCORER)),
    __metadata("design:paramtypes", [control_plane_public_1.FlagsService, widget_registration_service_1.WidgetRegistrationService, widget_audit_service_1.WidgetAuditService,
        widget_limiter_1.WidgetLimiter, prisma_service_1.PrismaService, widget_policy_service_1.WidgetPolicyService, Object])
], WidgetRequestGuard);
//# sourceMappingURL=widget.guard.js.map