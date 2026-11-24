"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SponsoredPromotionsModule = void 0;
const common_1 = require("@nestjs/common");
const kiorly_public_1 = require("../../kiorly/kiorly-public");
const promotion_fraud_signals_1 = require("./promotion-fraud.signals");
const promotion_ledger_view_service_1 = require("./promotion-ledger-view.service");
const promotion_projection_service_1 = require("./promotion-projection.service");
const promotion_quote_service_1 = require("./promotion-quote.service");
const promotion_reservation_client_1 = require("./promotion-reservation.client");
const promotion_review_service_1 = require("./promotion-review.service");
const promotions_admin_controller_1 = require("./promotions-admin.controller");
const promotions_public_controller_1 = require("./promotions-public.controller");
const growth_ports_public_1 = require("../growth-ports-public");
const sponsored_discount_service_1 = require("./sponsored-discount.service");
let SponsoredPromotionsModule = class SponsoredPromotionsModule {
};
exports.SponsoredPromotionsModule = SponsoredPromotionsModule;
exports.SponsoredPromotionsModule = SponsoredPromotionsModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        imports: [kiorly_public_1.KiorlyModule],
        controllers: [promotions_admin_controller_1.PromotionsAdminController, promotions_public_controller_1.PromotionsPublicController],
        providers: [promotion_projection_service_1.PromotionProjectionService, promotion_quote_service_1.PromotionQuoteService, promotion_review_service_1.PromotionReviewService, promotion_ledger_view_service_1.PromotionLedgerViewService, promotion_fraud_signals_1.PromotionFraudSignals, sponsored_discount_service_1.SponsoredDiscountService, promotion_reservation_client_1.KiorlyPromotionReservationClient, { provide: promotion_reservation_client_1.PROMOTION_RESERVATION_CLIENT, useExisting: promotion_reservation_client_1.KiorlyPromotionReservationClient }, { provide: growth_ports_public_1.SPONSORED_DISCOUNT_PORT, useExisting: sponsored_discount_service_1.SponsoredDiscountService }, { provide: growth_ports_public_1.SPONSORED_PAY_PORT, useExisting: sponsored_discount_service_1.SponsoredDiscountService }],
        exports: [promotion_projection_service_1.PromotionProjectionService, promotion_quote_service_1.PromotionQuoteService, promotion_review_service_1.PromotionReviewService, sponsored_discount_service_1.SponsoredDiscountService, promotion_reservation_client_1.PROMOTION_RESERVATION_CLIENT, growth_ports_public_1.SPONSORED_DISCOUNT_PORT, growth_ports_public_1.SPONSORED_PAY_PORT],
    })
], SponsoredPromotionsModule);
//# sourceMappingURL=promotions.module.js.map