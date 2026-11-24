import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** Ops view of the distinct `PROVIDER_SPONSORED_DISCOUNT` line per booking (GRW-P2-S). Opaque booking ids and amounts; no patient field exists in the table or in this view. */
@Injectable()
export class PromotionLedgerViewService {
  constructor(private readonly prisma: PrismaService) {}
  async forPromotion(promotionId: string, page = 1, pageSize = 50) {
    const take = Math.min(Math.max(pageSize, 1), 200); const skip = (Math.max(page, 1) - 1) * take;
    const [rows, total, byState] = await Promise.all([
      this.prisma.bookingSponsoredDiscount.findMany({ where: { promotionId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take, select: { id: true, bookingIntentId: true, promotionVersion: true, amountMinor: true, currency: true, state: true, createdAt: true, updatedAt: true } }),
      this.prisma.bookingSponsoredDiscount.count({ where: { promotionId } }),
      this.prisma.bookingSponsoredDiscount.groupBy({ by: ['state'], where: { promotionId }, _sum: { amountMinor: true }, _count: { _all: true } }),
    ]);
    return { promotionId, total, page, pageSize: take, lines: rows.map((r) => ({ ...r, ledgerLine: 'PROVIDER_SPONSORED_DISCOUNT', signedAmountMinor: -r.amountMinor })), byState: byState.map((s) => ({ state: s.state, count: s._count._all, amountMinor: s._sum.amountMinor ?? 0 })) };
  }
}
