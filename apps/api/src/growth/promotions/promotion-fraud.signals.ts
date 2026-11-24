import { Injectable } from '@nestjs/common';
import { subRefOf } from '../../common/privacy-hash';
import { PrismaService } from '../../prisma/prisma.service';

/** KP side of the promotion fraud rules (shadow first, like AD-11): signals go to `GrowthFraudSignal` as hashes, never as identifiers, and never change a patient's discount after a reservation. */
export const FARM_THRESHOLD = 3; export const LOOP_CLINICS = 3;
export const farm = (reservationsIn24h: number) => reservationsIn24h >= FARM_THRESHOLD;
export const collusionLoop = (distinctOrgs30d: number) => distinctOrgs30d >= LOOP_CLINICS;

@Injectable()
export class PromotionFraudSignals {
  constructor(private readonly prisma: PrismaService) {}
  async afterReserve(sub: string, orgRef: string, promotionId: string, now = new Date()) {
    const since24 = new Date(now.getTime() - 24 * 3_600_000), since30 = new Date(now.getTime() - 30 * 86_400_000);
    const mine = await this.prisma.bookingIntent.findMany({ where: { sub }, select: { id: true } , take: 500 });
    const ids = mine.map((m) => m.id); if (!ids.length) return;
    const lines = await this.prisma.bookingSponsoredDiscount.findMany({ where: { bookingIntentId: { in: ids }, createdAt: { gte: since30 } }, select: { promotionId: true, createdAt: true } });
    const subjectHash = subRefOf(sub);
    if (farm(lines.filter((l) => l.createdAt >= since24).length)) await this.prisma.growthFraudSignal.create({ data: { ruleId: 'PF_FARM', subjectHash, score: 60, evidenceRef: promotionId.slice(0, 64) } });
    const orgs = await this.prisma.sponsoredPromotionProjection.findMany({ where: { promotionId: { in: [...new Set(lines.map((l) => l.promotionId))] } }, select: { orgRef: true }, distinct: ['orgRef'] });
    if (collusionLoop(new Set([...orgs.map((o) => o.orgRef), orgRef]).size)) await this.prisma.growthFraudSignal.create({ data: { ruleId: 'PF_COLLUSION_LOOP', subjectHash, score: 60, evidenceRef: promotionId.slice(0, 64) } });
  }
}
