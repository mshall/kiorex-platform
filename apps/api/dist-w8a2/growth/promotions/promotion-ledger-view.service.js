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
exports.PromotionLedgerViewService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
let PromotionLedgerViewService = class PromotionLedgerViewService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async forPromotion(promotionId, page = 1, pageSize = 50) {
        const take = Math.min(Math.max(pageSize, 1), 200);
        const skip = (Math.max(page, 1) - 1) * take;
        const [rows, total, byState] = await Promise.all([
            this.prisma.bookingSponsoredDiscount.findMany({ where: { promotionId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take, select: { id: true, bookingIntentId: true, promotionVersion: true, amountMinor: true, currency: true, state: true, createdAt: true, updatedAt: true } }),
            this.prisma.bookingSponsoredDiscount.count({ where: { promotionId } }),
            this.prisma.bookingSponsoredDiscount.groupBy({ by: ['state'], where: { promotionId }, _sum: { amountMinor: true }, _count: { _all: true } }),
        ]);
        return { promotionId, total, page, pageSize: take, lines: rows.map((r) => ({ ...r, ledgerLine: 'PROVIDER_SPONSORED_DISCOUNT', signedAmountMinor: -r.amountMinor })), byState: byState.map((s) => ({ state: s.state, count: s._count._all, amountMinor: s._sum.amountMinor ?? 0 })) };
    }
};
exports.PromotionLedgerViewService = PromotionLedgerViewService;
exports.PromotionLedgerViewService = PromotionLedgerViewService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], PromotionLedgerViewService);
//# sourceMappingURL=promotion-ledger-view.service.js.map