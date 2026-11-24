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
exports.ReferralService = void 0;
const common_1 = require("@nestjs/common");
const contracts_1 = require("@kiorex/contracts");
const errors_1 = require("../../common/errors");
const prisma_service_1 = require("../../prisma/prisma.service");
const growth_flags_1 = require("../growth-flags");
const growth_limiter_1 = require("../growth-limiter");
const reward_events_service_1 = require("../rewards/reward-events.service");
const reward_ledger_service_1 = require("../rewards/reward-ledger.service");
const reward_policy_service_1 = require("../rewards/reward-policy.service");
const referral_code_1 = require("./referral-code");
const referral_identity_service_1 = require("./referral-identity.service");
const CHANNELS = ['LINK', 'WHATSAPP_SHARE', 'SMS', 'COPY'];
let ReferralService = class ReferralService {
    prisma;
    identity;
    events;
    policy;
    limiter;
    ledger;
    constructor(prisma, identity, events, policy, limiter, ledger) {
        this.prisma = prisma;
        this.identity = identity;
        this.events = events;
        this.policy = policy;
        this.limiter = limiter;
        this.ledger = ledger;
    }
    async ensureCode(sub, market = growth_flags_1.GROWTH_DEFAULT_MARKET) {
        const found = await this.prisma.referralCode.findUnique({ where: { market_sub: { market, sub } } });
        if (found)
            return found;
        for (let attempt = 0; attempt < 8; attempt++) {
            try {
                const created = await this.prisma.$transaction(async (tx) => {
                    const c = await tx.referralCode.create({ data: { market, sub, code: (0, referral_code_1.generateReferralCode)() } });
                    await tx.growthAcquisitionSource.upsert({ where: { market_sourceKind_sourceRef: { market, sourceKind: 'REFERRAL', sourceRef: c.code } }, create: { market, sourceKind: 'REFERRAL', sourceRef: c.code }, update: {} });
                    await this.events.emit(tx, 'ReferralCodeIssued', 'ReferralCode', c.id, { codeRef: c.id, market, code: c.code, issuedAt: c.createdAt.toISOString() }, c.id);
                    return c;
                });
                return created;
            }
            catch (e) {
                if (e.code !== 'P2002')
                    throw e;
                const raced = await this.prisma.referralCode.findUnique({ where: { market_sub: { market, sub } } });
                if (raced)
                    return raced;
            }
        }
        throw new errors_1.ApiError(503, 'REFERRAL_CODE_UNAVAILABLE', 'A referral code could not be issued, try again');
    }
    async me(u) {
        const { rules } = await this.policy.referralRules();
        await this.identity.recordPhone(u.sub, u.phone);
        const code = await this.ensureCode(u.sub);
        const [invited, signedUp, qualified, last30, year] = await Promise.all([
            this.prisma.referralShare.count({ where: { codeId: code.id } }),
            this.prisma.referralRelationship.count({ where: { referrerSub: u.sub, status: { in: ['SIGNED_UP', 'BOOKED', 'QUALIFIED'] } } }),
            this.prisma.referralRelationship.count({ where: { referrerSub: u.sub, status: 'QUALIFIED' } }),
            this.prisma.referralRelationship.count({ where: { referrerSub: u.sub, status: 'QUALIFIED', qualifiedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } }),
            this.prisma.referralRelationship.count({ where: { referrerSub: u.sub, status: 'QUALIFIED', qualifiedAt: { gte: new Date(Date.now() - 365 * 86_400_000) } } }),
        ]);
        const locale = u.locale === 'en' ? 'en' : 'ar';
        const open = await this.ledger.openLots(this.prisma, { owners: [u.sub], now: new Date() });
        return {
            code: code.code, status: code.status, inviteUrl: (0, referral_code_1.inviteUrl)(code.code, { locale }), deepLink: (0, referral_code_1.inviteDeepLink)(code.code),
            counts: { invited, signedUp, qualified },
            capsRemaining: { last30Days: Math.max(0, rules.caps.perReferrer30Days - last30), thisYear: Math.max(0, rules.caps.perReferrerYear - year) },
            rewards: { activeCount: open.length, activeMinor: open.reduce((s, l) => s + l.availableMinor, 0), currency: 'EGP' },
        };
    }
    async createInvite(u, i) {
        if (i.channel !== undefined && !CHANNELS.includes(i.channel))
            throw new errors_1.ApiError(400, 'GROWTH_INVALID_REQUEST', 'channel must be one of LINK, WHATSAPP_SHARE, SMS, COPY');
        await this.limiter.take('referral-invite', u.sub.slice(0, 24), 30, 3600_000);
        const code = await this.ensureCode(u.sub);
        if (code.status !== 'ACTIVE')
            throw new errors_1.ApiError(403, 'REFERRAL_CODE_SUSPENDED', 'Your invite link is not available');
        await this.prisma.referralShare.create({ data: { codeId: code.id, channel: i.channel ?? 'LINK' } });
        const locale = i.locale === 'en' || i.locale === 'ar' ? i.locale : u.locale === 'en' ? 'en' : 'ar';
        return { inviteUrl: (0, referral_code_1.inviteUrl)(code.code, { locale }), code: code.code, shareText: (0, referral_code_1.shareText)(code.code, { locale }) };
    }
    async usable(code) {
        if (!contracts_1.REFERRAL_CODE_PATTERN.test(code))
            return false;
        return !!(await this.prisma.referralCode.findFirst({ where: { code, status: 'ACTIVE' }, select: { id: true } }));
    }
};
exports.ReferralService = ReferralService;
exports.ReferralService = ReferralService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, referral_identity_service_1.ReferralIdentityService, reward_events_service_1.RewardEventsService, reward_policy_service_1.RewardPolicyService, growth_limiter_1.GrowthLimiter, reward_ledger_service_1.RewardLedgerService])
], ReferralService);
//# sourceMappingURL=referral.service.js.map