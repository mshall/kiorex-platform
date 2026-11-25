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
exports.VisitorConsentService = exports.VISITOR_CONSENT_SOURCES = void 0;
const common_1 = require("@nestjs/common");
const growth_secrets_1 = require("../growth-secrets");
const prisma_service_1 = require("../../prisma/prisma.service");
const privacy_hash_1 = require("../../common/privacy-hash");
const growth_flags_1 = require("../growth-flags");
const growth_config_service_1 = require("../config/growth-config.service");
const growth_events_service_1 = require("../events/growth-events.service");
const growth_limiter_1 = require("../growth-limiter");
const growth_errors_1 = require("../growth-errors");
exports.VISITOR_CONSENT_SOURCES = ['web', 'app', 'widget'];
let VisitorConsentService = class VisitorConsentService {
    prisma;
    config;
    limiter;
    events;
    constructor(prisma, config, limiter, events) {
        this.prisma = prisma;
        this.config = config;
        this.limiter = limiter;
        this.events = events;
    }
    async textVersions(market = growth_flags_1.GROWTH_DEFAULT_MARKET) {
        const d = await this.config.resolve('CONSENT_DEFAULTS', { market });
        return { ...d.payload.textVersionIds, regime: d.payload.regimeId, configVersion: d.versionId };
    }
    async record(i, ctx) {
        const market = ctx.market ?? growth_flags_1.GROWTH_DEFAULT_MARKET;
        const now = new Date();
        const ipHash = (0, privacy_hash_1.ipHashOf)(ctx.ip, now);
        await this.limiter.take('consent', ipHash, (0, growth_limiter_1.growthLimits)().consentPerMin);
        if (typeof i.analytics !== 'boolean' || (i.marketing !== undefined && typeof i.marketing !== 'boolean'))
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'analytics (and marketing) must be booleans');
        const source = i.source ?? 'web';
        if (!exports.VISITOR_CONSENT_SOURCES.includes(source))
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'source must be web, app or widget');
        const v = await this.textVersions(market);
        const textVersion = i.textVersion && i.textVersion.length <= 64 ? i.textVersion : v.analytics;
        const id = `kxc_${(0, growth_secrets_1.randomToken)(12)}`;
        await this.prisma.growthVisitorConsent.create({ data: { id, market, analytics: i.analytics, marketing: i.marketing === true, textVersion, source, evidence: i.evidence?.slice(0, 64), ipHash } });
        if (i.analytics)
            await this.events.recordFact({ name: 'ConsentGranted', naturalKey: id, market, props: { surface: source } }).catch(() => undefined);
        return { consentId: id, analytics: i.analytics, marketing: i.marketing === true, textVersion, at: now.toISOString() };
    }
};
exports.VisitorConsentService = VisitorConsentService;
exports.VisitorConsentService = VisitorConsentService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, growth_config_service_1.GrowthConfigService, growth_limiter_1.GrowthLimiter, growth_events_service_1.GrowthEventsService])
], VisitorConsentService);
//# sourceMappingURL=visitor-consent.service.js.map