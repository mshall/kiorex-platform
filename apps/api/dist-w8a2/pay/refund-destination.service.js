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
exports.RefundDestinationService = void 0;
const common_1 = require("@nestjs/common");
const errors_1 = require("../common/errors");
const growth_ports_public_1 = require("../growth/growth-ports-public");
const prisma_service_1 = require("../prisma/prisma.service");
const refund_allocation_1 = require("./refund-allocation");
let RefundDestinationService = class RefundDestinationService {
    prisma;
    rewards;
    constructor(prisma, rewards) {
        this.prisma = prisma;
        this.rewards = rewards;
    }
    async preview(sub, bookingRef) {
        const b = await this.prisma.bookingIntent.findFirst({ where: { id: bookingRef, sub } });
        if (!b)
            throw (0, errors_1.notFound)('BOOKING_NOT_FOUND', 'Booking not found');
        const p = await this.prisma.paymentIntent.findFirst({ where: { bookingId: b.id, status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED'] } }, orderBy: { createdAt: 'desc' } });
        const none = { options: [{ destination: 'ORIGINAL', amountMinor: 0, isDefault: true }], creditRestoredMinor: 0, sponsoredVoidedMinor: 0, currency: b.currency, refundableByPolicy: b.depositRefundable };
        if (!p || p.releasedAt || b.depositRefundable === false)
            return none;
        const remainingCard = p.amountMinor - p.refundedMinor;
        const price = p.amountMinor + p.rewardMinor;
        const a = (0, refund_allocation_1.allocateRefund)({ priceMinor: price, sponsoredMinor: 0, creditMinor: p.rewardMinor, cardMinor: p.amountMinor, heldDepositMinor: 0, refundableMinor: price });
        const card = Math.min(a.cardRefundMinor, remainingCard);
        const options = [{ destination: 'ORIGINAL', amountMinor: card, isDefault: true }];
        if (card > 0 && this.rewards && (await this.rewards.refundCreditAvailable()))
            options.push({ destination: 'CREDIT', amountMinor: card, isDefault: false });
        return { options, creditRestoredMinor: a.creditRestoredMinor, sponsoredVoidedMinor: a.sponsoredVoidedMinor, currency: p.currency, refundableByPolicy: b.depositRefundable };
    }
};
exports.RefundDestinationService = RefundDestinationService;
exports.RefundDestinationService = RefundDestinationService = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, common_1.Optional)()),
    __param(1, (0, common_1.Inject)(growth_ports_public_1.REWARDS_PORT)),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, Object])
], RefundDestinationService);
//# sourceMappingURL=refund-destination.service.js.map