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
exports.bookingServiceKind = exports.RewardsQueryService = void 0;
exports.scopeText = scopeText;
const market_core_public_1 = require("../../market/market-core-public");
const common_1 = require("@nestjs/common");
const errors_1 = require("../../common/errors");
const crypto_1 = require("../../common/crypto");
const prisma_service_1 = require("../../prisma/prisma.service");
const reward_ledger_service_1 = require("./reward-ledger.service");
const reward_policy_service_1 = require("./reward-policy.service");
const reward_redemption_service_1 = require("./reward-redemption.service");
const SERVICE_TEXT = { IN_CLINIC: { en: 'clinic visits', ar: 'زيارات العيادة' }, VIDEO: { en: 'video visits', ar: 'زيارات الفيديو' }, HOME_VISIT: { en: 'home visits', ar: 'الزيارات المنزلية' } };
function scopeText(scope, locale) {
    const kinds = scope.serviceKinds ?? [];
    const spec = scope.specialtyAllowlist ?? [];
    if (!kinds.length && !spec.length)
        return locale === 'ar' ? 'على أي حجز في كيوريكس' : 'On any Kiorex booking';
    const k = kinds.map((x) => SERVICE_TEXT[x]?.[locale]).filter(Boolean).join(locale === 'ar' ? ' و' : ', ');
    return (locale === 'ar' ? `على ${k || 'حجوزات محددة'}` : `On ${k || 'selected bookings'}`) + (spec.length ? (locale === 'ar' ? ' (تخصصات محددة)' : ' (selected specialties)') : '');
}
let RewardsQueryService = class RewardsQueryService {
    prisma;
    ledger;
    redemption;
    policy;
    constructor(prisma, ledger, redemption, policy) {
        this.prisma = prisma;
        this.ledger = ledger;
        this.redemption = redemption;
        this.policy = policy;
    }
    async rewards(sub, o = {}) {
        const take = Math.min(Math.max(o.take ?? 50, 1), 100);
        const lots = await this.prisma.rewardLot.findMany({ where: { OR: [{ ownerSub: sub }, { ownerSub: null, sub }] }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: take + 1, ...(o.cursor ? { cursor: { id: o.cursor }, skip: 1 } : {}) });
        const page = lots.slice(0, take);
        const items = [];
        for (const l of page) {
            const b = await this.ledger.balance(this.prisma, l.id);
            items.push({ id: l.id, kind: l.kind, mode: l.mode, amountMinor: l.amountMinor, currency: l.currency, status: l.status, expiresAt: l.expiresAt, remainingMinor: b.available + b.reserved + b.held, couponState: l.mode === 'COUPON' && l.couponCodeHash ? (l.couponCodeSealed ? 'UNREVEALED' : 'REVEALED') : 'NONE', ref: l.id.slice(-6).toUpperCase() });
        }
        return { items, nextCursor: lots.length > take ? page[page.length - 1].id : null };
    }
    async reveal(sub, lotId) {
        return this.prisma.$transaction(async (tx) => {
            const rows = await tx.$queryRaw `SELECT "couponCodeSealed" FROM "RewardLot" WHERE "id" = ${lotId} AND COALESCE("ownerSub","sub") = ${sub} AND "mode" = 'COUPON' FOR UPDATE`;
            const sealed = rows[0]?.couponCodeSealed;
            if (!sealed)
                throw new errors_1.ApiError(409, 'COUPON_ALREADY_REVEALED', 'This code was already shown. Use the voucher from your list at checkout.');
            await tx.rewardLot.update({ where: { id: lotId }, data: { couponCodeSealed: null, couponRevealedAt: new Date() } });
            return { code: (0, crypto_1.decryptField)(sealed) };
        });
    }
    async credit(sub, locale) {
        const now = new Date();
        const open = await this.ledger.openLots(this.prisma, { owners: [sub], now, mode: 'CREDIT' });
        const h = await this.prisma.rewardHousehold.findFirst({ where: { ownerSub: sub }, include: { members: { where: { endedAt: null } } } });
        return {
            openBalanceMinor: open.reduce((s, l) => s + l.availableMinor, 0), currency: open[0]?.currency ?? ((0, market_core_public_1.marketCurrency)(market_core_public_1.DEFAULT_MARKET) || 'EGP'),
            lots: open.map((l) => ({ id: l.id, kind: l.kind, remainingMinor: l.availableMinor, expiresAt: l.expiresAt, scopeText: scopeText(l.scope, locale), funding: l.funding })),
            household: h ? { ownerIsMe: true, members: h.members.length } : null,
        };
    }
    async quote(sub, i) {
        const ctx = { sub, amountMinor: i.amountMinor, serviceKind: (['IN_CLINIC', 'VIDEO', 'HOME_VISIT'].includes(i.careType ?? '') ? i.careType : 'IN_CLINIC'), couponCode: i.couponCode, lotId: i.lotId };
        if (i.bookingRef) {
            const b = await this.prisma.bookingIntent.findFirst({ where: { id: i.bookingRef, sub } });
            if (!b)
                throw new errors_1.ApiError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
            const p = await this.prisma.provider.findUnique({ where: { id: b.providerId }, select: { specialty: true } });
            Object.assign(ctx, { serviceKind: (0, exports.bookingServiceKind)(b), specialty: p?.specialty ?? null, dependantId: b.dependantId });
        }
        return this.redemption.quoteLines(ctx);
    }
};
exports.RewardsQueryService = RewardsQueryService;
exports.RewardsQueryService = RewardsQueryService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, reward_ledger_service_1.RewardLedgerService, reward_redemption_service_1.RewardRedemptionService, reward_policy_service_1.RewardPolicyService])
], RewardsQueryService);
const bookingServiceKind = (b) => (b.serviceLocation === 'HOME' ? 'HOME_VISIT' : b.telehealth ? 'VIDEO' : 'IN_CLINIC');
exports.bookingServiceKind = bookingServiceKind;
//# sourceMappingURL=rewards-query.service.js.map