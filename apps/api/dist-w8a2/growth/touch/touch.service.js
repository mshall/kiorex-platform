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
exports.TouchService = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const config_1 = require("../../common/config");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const prisma_service_1 = require("../../prisma/prisma.service");
const policy_1 = require("../attribution/policy");
const link_token_1 = require("../consent/link-token");
const link_registry_service_1 = require("../links/link-registry.service");
const touch_rules_1 = require("../fraud/touch-rules");
const fraud_public_1 = require("../fraud/fraud-public");
const growth_errors_1 = require("../growth-errors");
const growth_flags_1 = require("../growth-flags");
const growth_limiter_1 = require("../growth-limiter");
const growth_secrets_1 = require("../growth-secrets");
const decide_1 = require("../attribution/decide");
const touch_sanitizer_1 = require("./touch-sanitizer");
const dwellFloorFallback = 1000;
let TouchService = class TouchService {
    prisma;
    flags;
    limiter;
    fraud;
    policies;
    links;
    scorer;
    constructor(prisma, flags, limiter, fraud, policies, links, scorer) {
        this.prisma = prisma;
        this.flags = flags;
        this.limiter = limiter;
        this.fraud = fraud;
        this.policies = policies;
        this.links = links;
        this.scorer = scorer;
    }
    newVisitorKey() { return `kxv_${(0, growth_secrets_1.randomToken)(18)}`; }
    clickHash(kind, value) { return (0, node_crypto_1.createHmac)('sha256', (0, growth_secrets_1.growthKey)('clickid')).update(`${kind}|${value}`).digest('base64url'); }
    async record(t, ctx) {
        const now = ctx.now ?? new Date();
        const market = ctx.market ?? growth_flags_1.GROWTH_DEFAULT_MARKET;
        await this.limiter.take('touch', ctx.ipHash, (0, growth_limiter_1.growthLimits)().touchPerMin);
        let claims;
        if (t.lt !== undefined) {
            const v = (0, link_token_1.verifyAnyLinkToken)({ kxl1: (0, growth_secrets_1.linkTokenKey)(), provider: (0, growth_secrets_1.providerLinkTouchSecret)() }, t.lt, now.getTime());
            if (this.scorer)
                void this.scorer.onLinkToken({ ipHash: ctx.ipHash, ok: v.ok, expired: !v.ok && v.reason === 'EXPIRED', ...(v.ok ? { tokenId: (0, growth_secrets_1.sha256Hex)(t.lt).slice(0, 16) } : {}) }).catch(() => undefined);
            if (!v.ok)
                throw (0, growth_errors_1.growthError)(v.reason === 'EXPIRED' ? 'GROWTH_LINK_TOKEN_EXPIRED' : 'GROWTH_LINK_TOKEN_INVALID', v.reason === 'EXPIRED' ? 'The link token expired' : 'The link token is not valid');
            claims = { ...v.claims, n: (0, growth_secrets_1.sha256Hex)(t.lt).slice(0, 16) };
            await this.links.learn(v.claims.code, v.claims.org, market);
        }
        const policy = await this.policies.get(market, now);
        const referrerHost = (0, touch_sanitizer_1.referrerHostOf)(ctx.referer, ctx.origin);
        const kind = (0, touch_sanitizer_1.sourceKindOf)(t, referrerHost);
        const providerOwned = decide_1.PROVIDER_OWNED_KINDS.includes(kind);
        await this.fraud.onTouch({ ipHash: ctx.ipHash, providerOwned, dwellMs: t.dwellMs, minDwellMs: policy.minDwellMsForProviderTouch ?? dwellFloorFallback });
        const visitorKeysEnabled = ctx.consentAnalytics && (await this.flags.isEnabled(growth_flags_1.GROWTH_FLAG.ANALYTICS_VISITOR, { market }).catch(() => false));
        if (!visitorKeysEnabled)
            return { accepted: true, visitorKeySet: false, persisted: false };
        let sourceRef = '';
        let orgRef = null;
        let linkCode = null;
        if (kind === 'PROVIDER_LINK' || kind === 'WIDGET' || kind === 'REFERRAL') {
            const code = t.ref ?? claims?.code;
            if (code) {
                const src = await this.prisma.growthAcquisitionSource.findFirst({ where: { market, sourceKind: kind, sourceRef: code, active: true } })
                    ?? (kind === 'PROVIDER_LINK' ? await this.prisma.growthAcquisitionSource.findFirst({ where: { market, sourceKind: 'PROVIDER_QR', sourceRef: code, active: true } }) : null);
                if (src) {
                    sourceRef = src.sourceRef;
                    orgRef = src.ownerOrgRef;
                    linkCode = code;
                }
            }
            if (!orgRef && claims && kind !== 'REFERRAL') {
                orgRef = claims.org;
                linkCode = linkCode ?? claims.code;
                sourceRef = sourceRef || claims.code;
            }
            if (kind !== 'REFERRAL' && !orgRef)
                return { accepted: true, visitorKeySet: false, persisted: false };
            if (kind === 'REFERRAL' && !linkCode)
                return { accepted: true, visitorKeySet: false, persisted: false };
            if (claims && orgRef && claims.org !== orgRef)
                return { accepted: true, visitorKeySet: false, persisted: false };
        }
        const campaign = await this.campaignOf(t.utm.campaign, market, kind);
        const touchKind = campaign ? 'CAMPAIGN' : kind;
        const source = await this.source(market, touchKind, campaign ? campaign.ref : sourceRef);
        const visitorKey = ctx.cookieVisitorKey && touch_sanitizer_1.VISITOR_KEY_PATTERN.test(ctx.cookieVisitorKey) ? ctx.cookieVisitorKey : this.newVisitorKey();
        const touch = await this.prisma.growthTouchpoint.create({
            data: {
                market, visitorKey, sourceId: source.id, kind: touchKind, providerOrgRef: orgRef, linkCode, landingKind: t.landingKind, localeAt: ctx.locale === 'en' ? 'en' : 'ar',
                utmSource: t.utm.source, utmMedium: t.utm.medium, utmCampaign: t.utm.campaign, utmContent: t.utm.content, utmTerm: t.utm.term,
                clickIdKind: t.clickId?.kind, clickIdHash: t.clickId ? this.clickHash(t.clickId.kind, t.clickId.value) : undefined,
                referrerHost, dwellMs: t.dwellMs, ltTokenId: claims?.n, occurredAt: now, ipHash: ctx.ipHash, uaClass: (0, touch_sanitizer_1.uaClassOf)(ctx.userAgent),
            },
        });
        return { accepted: true, visitorKeySet: true, visitorKey, persisted: true, touchId: touch.id };
    }
    async campaignOf(utm, market, kind) {
        if (!utm || decide_1.PROVIDER_OWNED_KINDS.includes(kind) || kind === 'WIDGET' || kind === 'REFERRAL')
            return null;
        if (!(await this.flags.isEnabled(growth_flags_1.GROWTH_FLAG.CAMPAIGNS, { market }).catch(() => false)))
            return null;
        const c = await this.prisma.growthCampaign.findFirst({ where: { market, utmCampaign: utm }, select: { id: true, status: true } });
        return c ? { ref: c.status === 'ACTIVE' ? c.id : '' } : null;
    }
    async source(market, kind, ref) {
        const where = { market_sourceKind_sourceRef: { market, sourceKind: kind, sourceRef: ref } };
        const found = await this.prisma.growthAcquisitionSource.findUnique({ where });
        if (found)
            return found;
        try {
            return await this.prisma.growthAcquisitionSource.create({ data: { market, sourceKind: kind, sourceRef: ref } });
        }
        catch (e) {
            if (e.code === 'P2002')
                return this.prisma.growthAcquisitionSource.findUniqueOrThrow({ where });
            throw e;
        }
    }
    async cookieFor(visitorKey, market = growth_flags_1.GROWTH_DEFAULT_MARKET) {
        const policy = await this.policies.get(market, new Date());
        const days = Math.min(180, policy.visitorKeyMaxDays ?? 180);
        return `kxv=${visitorKey}; Path=/; Max-Age=${days * 86_400}; HttpOnly; SameSite=Lax${(0, config_1.cfg)().isProd || process.env.GROWTH_COOKIE_SECURE === 'true' ? '; Secure' : ''}`;
    }
    clearCookie() { return `kxv=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${(0, config_1.cfg)().isProd || process.env.GROWTH_COOKIE_SECURE === 'true' ? '; Secure' : ''}`; }
};
exports.TouchService = TouchService;
exports.TouchService = TouchService = __decorate([
    (0, common_1.Injectable)(),
    __param(6, (0, common_1.Optional)()),
    __param(6, (0, common_1.Inject)(fraud_public_1.FRAUD_SCORER)),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, control_plane_public_1.FlagsService, growth_limiter_1.GrowthLimiter,
        touch_rules_1.FraudSignalService, policy_1.AttributionPolicyResolver, link_registry_service_1.LinkRegistryService, Object])
], TouchService);
//# sourceMappingURL=touch.service.js.map