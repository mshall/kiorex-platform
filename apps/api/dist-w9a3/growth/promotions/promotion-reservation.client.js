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
exports.KiorlyPromotionReservationClient = exports.PROMOTION_RESERVATION_CLIENT = void 0;
const common_1 = require("@nestjs/common");
const kiorly_public_1 = require("../../kiorly/kiorly-public");
exports.PROMOTION_RESERVATION_CLIENT = Symbol('PROMOTION_RESERVATION_CLIENT');
const REASONS = new Set(['BUDGET_EXHAUSTED', 'NOT_ELIGIBLE', 'PAUSED', 'WALLET_INSUFFICIENT', 'LIMIT_REACHED']);
let KiorlyPromotionReservationClient = class KiorlyPromotionReservationClient {
    kiorly;
    constructor(kiorly) {
        this.kiorly = kiorly;
    }
    async reserve(r) {
        try {
            const { data } = await this.kiorly.request({ method: 'POST', path: `/promotions/${encodeURIComponent(r.promotionId)}/reserve`, clinicId: r.clinicId,
                body: { version: r.version, bookingRef: r.bookingRef, patientRef: r.patientRef, careType: r.careType, amountMinor: r.amountMinor, currency: r.currency, idempotencyKey: r.idempotencyKey } });
            return typeof data?.reservationRef === 'string' ? { ok: true, reservationRef: data.reservationRef, expiresAt: data.expiresAt } : { ok: false, reason: 'UNAVAILABLE' };
        }
        catch (e) {
            if (e instanceof kiorly_public_1.KiorlyHttpError) {
                const code = e.code ?? e.body?.code ?? e.body?.message?.code;
                return { ok: false, reason: REASONS.has(code) ? code : 'NOT_ELIGIBLE' };
            }
            if (e instanceof kiorly_public_1.KiorlyTransientError)
                return { ok: false, reason: 'UNAVAILABLE' };
            throw e;
        }
    }
    async release(r) {
        try {
            await this.kiorly.request({ method: 'POST', path: `/promotions/${encodeURIComponent(r.promotionId)}/release`, clinicId: r.clinicId, body: { reservationRef: r.reservationRef, idempotencyKey: r.idempotencyKey, ...(r.reason ? { reason: r.reason } : {}) } });
            return true;
        }
        catch (e) {
            if (e instanceof kiorly_public_1.KiorlyHttpError || e instanceof kiorly_public_1.KiorlyTransientError)
                return false;
            throw e;
        }
    }
    async reviewDecision(r) {
        try {
            await this.kiorly.request({ method: 'POST', path: `/promotions/${encodeURIComponent(r.promotionId)}/review-decision`, clinicId: r.clinicId, body: { version: r.version, reviewKind: r.reviewKind, decision: r.decision, ...(r.note ? { note: r.note } : {}), decidedBy: r.decidedBy, decidedAt: new Date().toISOString() } });
            return 'APPLIED';
        }
        catch (e) {
            if (e instanceof kiorly_public_1.KiorlyHttpError)
                return { refused: e.code ?? e.body?.message?.code ?? `HTTP_${e.status}` };
            if (e instanceof kiorly_public_1.KiorlyTransientError)
                return 'UNAVAILABLE';
            throw e;
        }
    }
};
exports.KiorlyPromotionReservationClient = KiorlyPromotionReservationClient;
exports.KiorlyPromotionReservationClient = KiorlyPromotionReservationClient = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [kiorly_public_1.KiorlyClient])
], KiorlyPromotionReservationClient);
//# sourceMappingURL=promotion-reservation.client.js.map