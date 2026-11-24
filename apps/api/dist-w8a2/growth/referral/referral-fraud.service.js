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
exports.ReferralFraudService = void 0;
const common_1 = require("@nestjs/common");
const privacy_hash_1 = require("../../common/privacy-hash");
const prisma_service_1 = require("../../prisma/prisma.service");
const reward_policy_service_1 = require("../rewards/reward-policy.service");
const fraud_public_1 = require("../fraud/fraud-public");
const referral_fraud_rules_1 = require("./referral-fraud.rules");
const referral_identity_service_1 = require("./referral-identity.service");
const DAY = 86_400_000;
let ReferralFraudService = class ReferralFraudService {
    prisma;
    identity;
    policy;
    staff;
    scorer;
    constructor(prisma, identity, policy, staff, scorer) {
        this.prisma = prisma;
        this.identity = identity;
        this.policy = policy;
        this.staff = staff;
        this.scorer = scorer;
    }
    async evaluate(stage, facts) {
        const { rules } = await this.policy.referralRules();
        return (0, referral_fraud_rules_1.evaluateFraud)(stage, facts, { enforce: await this.policy.fraudEnforced(), paymentFingerprint: rules.signals.paymentFingerprint, deviceSignal: rules.signals.deviceSignal });
    }
    async escalate(verdict, surface, facts, ctx) {
        if (!this.scorer)
            return verdict;
        const a = await this.scorer.assess(surface, facts, ctx);
        if (a.action === 'REJECT_CLAIM' && verdict.action !== 'REJECT')
            return { ...verdict, action: 'REJECT' };
        if (a.action === 'HOLD_REWARD' && (verdict.action === 'ALLOW'))
            return { ...verdict, action: 'HOLD' };
        return verdict;
    }
    async record(signals, o) {
        for (const s of signals) {
            const exists = await this.prisma.growthFraudSignal.findFirst({ where: { ruleId: s.ruleId, evidenceRef: o.evidenceRef, reviewStatus: 'OPEN' }, select: { id: true } });
            if (!exists)
                await this.prisma.growthFraudSignal.create({ data: { ruleId: s.ruleId, subjectHash: (0, privacy_hash_1.subRefOf)(o.subject), score: s.score, evidenceRef: o.evidenceRef } });
        }
    }
    async claimFacts(i) {
        const refPhone = (await this.identity.hashesOf(i.referrerSub, 'PHONE'))[0];
        const phoneOther = i.refereePhoneHash ? await this.identity.seenOnOtherSub('PHONE', i.refereePhoneHash, i.refereeSub) : false;
        const payShared = await this.identity.shared('PAY_FINGERPRINT', i.referrerSub, i.refereeSub);
        const deviceShared = await this.identity.shared('DEVICE', i.referrerSub, i.refereeSub);
        const ip = i.ipHash ? await this.identity.distinctSubsSince('IP24', i.ipHash, new Date(i.now.getTime() - DAY)) : 0;
        const botFlag = i.touch ? !!(await this.prisma.growthFraudSignal.findFirst({ where: { evidenceRef: i.touch.id }, select: { id: true } })) : false;
        return {
            referrerSub: i.referrerSub, refereeSub: i.refereeSub,
            phoneHash: { referrer: refPhone, referee: i.refereePhoneHash },
            ...(payShared ? { paymentFingerprint: { referrer: 'shared', referee: 'shared' } } : {}), ...(deviceShared ? { deviceHash: { referrer: 'shared', referee: 'shared' } } : {}),
            refereePhoneSeenOnOtherSub: phoneOther, signupsFromIpPrefix24h: ip, touchFlaggedBot: botFlag,
            ...(i.touch ? { secondsClaimToSignup: Math.max(0, Math.round((i.now.getTime() - i.touch.occurredAt.getTime()) / 1000)) } : {}),
        };
    }
    async qualificationFacts(rel, booking, now) {
        const siblings = await this.prisma.referralRelationship.findMany({ where: { referrerSub: rel.referrerSub, createdAt: { gte: new Date(now.getTime() - 30 * DAY) } }, select: { id: true, refereeSub: true, firstBookingId: true } });
        const sibBookings = await this.prisma.bookingIntent.findMany({ where: { id: { in: siblings.map((s) => s.firstBookingId ?? '-') } }, select: { id: true, providerId: true, createdAt: true, sub: true } });
        const byProvider = new Map();
        for (const b of sibBookings)
            byProvider.set(b.providerId, (byProvider.get(b.providerId) ?? 0) + 1);
        const top = Math.max(0, ...byProvider.values());
        const t0 = sibBookings.length ? Math.min(...sibBookings.map((b) => b.createdAt.getTime())) : 0;
        const refPay = await this.identity.hashesOf(rel.referrerSub, 'PAY_FINGERPRINT');
        const reefPhones = await this.identity.hashesOf(rel.refereeSub, 'PHONE');
        const refPhones = await this.identity.hashesOf(rel.referrerSub, 'PHONE');
        const staffMatch = booking ? await this.staff.matches(booking.clinicId, [...reefPhones, ...refPhones]) : false;
        const checkedIn = booking ? !!(await this.prisma.bookingEvent.findFirst({ where: { bookingId: booking.id, kind: 'STATE', toStatus: { in: ['CHECKED_IN', 'COMPLETED'] } }, select: { id: true } })) : true;
        const slotRebooks = booking ? await this.prisma.bookingIntent.count({ where: { sub: rel.refereeSub, providerId: booking.providerId, startsAt: booking.startsAt, status: 'CANCELLED' } }) : 0;
        const refRefunded = booking?.depositStatus === 'REFUNDED';
        return {
            referrerSub: rel.referrerSub, refereeSub: rel.refereeSub,
            refereesInWindow: siblings.length, refereesWithSameProvider: top,
            firstBookingTimesMinutes: sibBookings.map((b) => Math.round((b.createdAt.getTime() - t0) / 60_000)),
            refereesSharingPaymentFingerprint: refPay.length && (await this.identity.shared('PAY_FINGERPRINT', rel.referrerSub, rel.refereeSub)) ? 2 : 0,
            staffPhoneMatch: staffMatch, topProviderShare: sibBookings.length >= 4 ? top / sibBookings.length : 0,
            completionWithoutCheckIn: booking?.status === 'COMPLETED' ? !checkedIn : false,
            depositRefundedAfterReward: !!rel.qualifiedAt && refRefunded, repeatedSlotCancelRebook: slotRebooks >= 2,
            refereeCancelledInHold: booking ? ['CANCELLED', 'EXPIRED'].includes(booking.status) || refRefunded : false,
            cancelledAfterRewardInWindow: !!rel.qualifiedAt && !!booking && booking.status === 'CANCELLED',
        };
    }
};
exports.ReferralFraudService = ReferralFraudService;
exports.ReferralFraudService = ReferralFraudService = __decorate([
    (0, common_1.Injectable)(),
    __param(3, (0, common_1.Inject)(referral_identity_service_1.STAFF_PHONE_MATCH)),
    __param(4, (0, common_1.Optional)()),
    __param(4, (0, common_1.Inject)(fraud_public_1.FRAUD_SCORER)),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, referral_identity_service_1.ReferralIdentityService, reward_policy_service_1.RewardPolicyService, Object, Object])
], ReferralFraudService);
//# sourceMappingURL=referral-fraud.service.js.map