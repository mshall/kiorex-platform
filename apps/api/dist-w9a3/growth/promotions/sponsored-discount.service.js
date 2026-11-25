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
exports.SponsoredDiscountService = void 0;
const market_core_public_1 = require("../../market/market-core-public");
const common_1 = require("@nestjs/common");
const privacy_hash_1 = require("../../common/privacy-hash");
const prisma_service_1 = require("../../prisma/prisma.service");
const promotion_reservation_client_1 = require("./promotion-reservation.client");
const promotion_quote_service_1 = require("./promotion-quote.service");
const promotion_fraud_signals_1 = require("./promotion-fraud.signals");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const growth_flags_1 = require("../growth-flags");
const promotion_math_1 = require("./promotion-math");
let SponsoredDiscountService = class SponsoredDiscountService {
    prisma;
    quotes;
    fraud;
    clinic;
    flags;
    log = new common_1.Logger('sponsored-discount');
    constructor(prisma, quotes, fraud, clinic, flags) {
        this.prisma = prisma;
        this.quotes = quotes;
        this.fraud = fraud;
        this.clinic = clinic;
        this.flags = flags;
    }
    async reserveForConfirm(b) {
        try {
            const existing = await this.prisma.bookingSponsoredDiscount.findUnique({ where: { bookingIntentId: b.id } });
            if (existing)
                return existing.state === 'RESERVED' || existing.state === 'APPLIED' ? { promotionId: existing.promotionId, promotionVersion: existing.promotionVersion, reservationRef: existing.reservationRef, amountMinor: existing.amountMinor, currency: existing.currency } : null;
            const q = await this.quotes.quoteFor(b);
            if (!q)
                return null;
            const careType = b.serviceLocation === 'HOME' ? 'HOME_VISIT' : b.telehealth ? 'VIDEO' : 'IN_CLINIC';
            const out = await this.clinic.reserve({ promotionId: q.promotionId, clinicId: b.clinicId, version: q.version, bookingRef: b.id, patientRef: (0, privacy_hash_1.subRefOf)(b.sub), careType, amountMinor: q.amountMinor, currency: q.currency, idempotencyKey: `spr:${b.id}:${q.promotionId}:${q.version}` });
            if (!out.ok) {
                this.log.log(`reserve refused for ${b.id}: ${out.reason}`);
                return null;
            }
            await this.prisma.bookingSponsoredDiscount.create({ data: { bookingIntentId: b.id, promotionId: q.promotionId, promotionVersion: q.version, amountMinor: q.amountMinor, currency: q.currency, reservationRef: out.reservationRef } });
            await this.fraud.afterReserve(b.sub, b.tenantId ?? '', q.promotionId).catch(() => undefined);
            return { promotionId: q.promotionId, promotionVersion: q.version, reservationRef: out.reservationRef, amountMinor: q.amountMinor, currency: q.currency };
        }
        catch (e) {
            this.log.warn(`sponsored reserve failed for ${b.id}: ${e.message}`);
            return null;
        }
    }
    async onClinicAnswer(bookingId, answer) {
        if (!answer)
            return;
        await this.prisma.bookingSponsoredDiscount.updateMany({ where: { bookingIntentId: bookingId, ...(answer.reservationRef ? { reservationRef: answer.reservationRef } : {}), state: 'RESERVED' }, data: { state: answer.applied ? 'APPLIED' : 'RELEASED' } });
    }
    async releaseForBooking(bookingId, reason = 'BOOKING_NOT_CONFIRMED') {
        const l = await this.prisma.bookingSponsoredDiscount.findUnique({ where: { bookingIntentId: bookingId } });
        if (!l || l.state !== 'RESERVED')
            return;
        const b = await this.prisma.bookingIntent.findUnique({ where: { id: bookingId }, select: { clinicId: true } });
        if (b)
            await this.clinic.release({ promotionId: l.promotionId, clinicId: b.clinicId, reservationRef: l.reservationRef, idempotencyKey: `sprr:${bookingId}`, reason }).catch(() => false);
        await this.prisma.bookingSponsoredDiscount.updateMany({ where: { bookingIntentId: bookingId, state: 'RESERVED' }, data: { state: 'RELEASED' } });
    }
    async applyClinicEvent(type, data) {
        const ref = typeof data.reservationRef === 'string' ? data.reservationRef : '';
        if (!ref)
            return 'IGNORED';
        const to = type === 'SponsoredDiscountDebited' ? { state: 'DEBITED', from: ['RESERVED', 'APPLIED'] } : type === 'SponsoredDiscountReleased' ? { state: 'RELEASED', from: ['RESERVED', 'APPLIED'] } : type === 'SponsoredDiscountReversed' ? { state: 'REVERSED', from: ['DEBITED'] } : null;
        if (!to)
            return 'IGNORED';
        const r = await this.prisma.bookingSponsoredDiscount.updateMany({ where: { reservationRef: ref, state: { in: to.from } }, data: { state: to.state, ...(to.state === 'DEBITED' ? { debitRef: ref } : {}) } });
        if (to.state === 'REVERSED' && r.count)
            await this.prisma.bookingSponsoredDiscount.updateMany({ where: { reservationRef: ref }, data: { debitRef: ref } });
        return r.count ? 'APPLIED' : 'IGNORED';
    }
    line(bookingId) { return this.prisma.bookingSponsoredDiscount.findUnique({ where: { bookingIntentId: bookingId } }); }
    async lineForDeposit(bookingId) {
        const l = await this.prisma.bookingSponsoredDiscount.findUnique({ where: { bookingIntentId: bookingId } });
        if (!l || !['APPLIED', 'DEBITED'].includes(l.state) || l.amountMinor <= 0)
            return null;
        const b = await this.prisma.bookingIntent.findUnique({ where: { id: bookingId }, select: { tenantId: true } });
        if (!(await this.flags.isEnabled(growth_flags_1.GROWTH_FLAG.SPONSORED_PROMOTIONS, { market: market_core_public_1.DEFAULT_MARKET, orgId: b?.tenantId ?? undefined }).catch(() => false)))
            return null;
        return { amountMinor: l.amountMinor, currency: l.currency, reservationRef: l.reservationRef };
    }
    async payoutHoldMinor(bookingId, postedMinor) {
        if (postedMinor <= 0)
            return 0;
        const l = await this.prisma.bookingSponsoredDiscount.findUnique({ where: { bookingIntentId: bookingId } });
        return Math.min(postedMinor, l ? (0, promotion_math_1.sponsoredPayoutHoldMinor)(l) : postedMinor);
    }
};
exports.SponsoredDiscountService = SponsoredDiscountService;
exports.SponsoredDiscountService = SponsoredDiscountService = __decorate([
    (0, common_1.Injectable)(),
    __param(3, (0, common_1.Inject)(promotion_reservation_client_1.PROMOTION_RESERVATION_CLIENT)),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, promotion_quote_service_1.PromotionQuoteService, promotion_fraud_signals_1.PromotionFraudSignals, Object, control_plane_public_1.FlagsService])
], SponsoredDiscountService);
//# sourceMappingURL=sponsored-discount.service.js.map