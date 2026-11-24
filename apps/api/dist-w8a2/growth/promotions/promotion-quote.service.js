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
exports.PromotionQuoteService = void 0;
const market_core_public_1 = require("../../market/market-core-public");
const common_1 = require("@nestjs/common");
const errors_1 = require("../../common/errors");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const prisma_service_1 = require("../../prisma/prisma.service");
const growth_flags_1 = require("../growth-flags");
const checkout_lines_1 = require("../rewards/checkout-lines");
const promotion_math_1 = require("./promotion-math");
const LIVE_STATUSES = ['PENDING_CLINIC', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED'];
let PromotionQuoteService = class PromotionQuoteService {
    prisma;
    flags;
    constructor(prisma, flags) {
        this.prisma = prisma;
        this.flags = flags;
    }
    async quote(sub, bookingId, now = new Date()) {
        const b = await this.prisma.bookingIntent.findFirst({ where: { id: bookingId, sub } });
        if (!b)
            throw (0, errors_1.notFound)('BOOKING_NOT_FOUND', 'Booking not found');
        return this.quoteFor(b, now);
    }
    async quoteFor(b, now = new Date()) {
        if (!b.tenantId || !b.feeMinor || b.feeMinor <= 0)
            return null;
        if (!(await this.flags.isEnabled(growth_flags_1.GROWTH_FLAG.SPONSORED_PROMOTIONS, { market: market_core_public_1.DEFAULT_MARKET, orgId: b.tenantId }).catch(() => false)))
            return null;
        const rows = await this.prisma.sponsoredPromotionProjection.findMany({ where: { orgRef: b.tenantId, status: 'ACTIVE', endsAt: { gt: now } }, take: 100 });
        if (!rows.length)
            return null;
        const careType = b.serviceLocation === 'HOME' ? 'HOME_VISIT' : b.telehealth ? 'VIDEO' : 'IN_CLINIC';
        const [sameClinic, kiorexBefore] = await Promise.all([
            this.prisma.bookingIntent.count({ where: { sub: b.sub, tenantId: b.tenantId, id: { not: b.id }, status: { in: LIVE_STATUSES } } }),
            this.prisma.bookingIntent.count({ where: { sub: b.sub, id: { not: b.id }, status: { in: LIVE_STATUSES } } }),
        ]);
        const facts = { doctorId: b.clinicianId, appointmentTypeId: b.typeId, careType, startsAt: b.startsAt, visitFeeMinor: b.feeMinor, isNewToClinic: sameClinic === 0, kiorexBookingsBefore: kiorexBefore, channelIsKiorex: true };
        const cands = rows.map((r) => ({ id: r.id, row: r, promo: { status: r.status, startsAt: r.startsAt, endsAt: r.endsAt, budgetCapMinor: Number(r.budgetCapMinor), scope: r.scope, discount: r.discount, eligibility: r.eligibility } }));
        const best = (0, promotion_math_1.bestOffer)(cands, facts, now);
        if (!best)
            return null;
        const prov = await this.prisma.provider.findUnique({ where: { id: b.providerId }, select: { clinicNameAr: true, clinicNameEn: true } });
        const sponsor = { ar: prov?.clinicNameAr || prov?.clinicNameEn || 'العيادة', en: prov?.clinicNameEn || prov?.clinicNameAr || 'the clinic' };
        const r = best.cand.row;
        const l = (0, promotion_math_1.sponsoredLabel)(sponsor, r.endsAt, { ar: r.patientCopyAr, en: r.patientCopyEn });
        const checkout = (0, checkout_lines_1.composeCheckout)({ priceMinor: b.feeMinor, sponsoredMinor: best.amountMinor });
        return { promotionId: r.promotionId, version: r.version, amountMinor: best.amountMinor, currency: b.currency, endsAt: r.endsAt.toISOString(), label: { ar: l.ar, en: l.en }, patientCopy: l.copy, sponsor, lines: checkout.lines };
    }
};
exports.PromotionQuoteService = PromotionQuoteService;
exports.PromotionQuoteService = PromotionQuoteService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, control_plane_public_1.FlagsService])
], PromotionQuoteService);
//# sourceMappingURL=promotion-quote.service.js.map