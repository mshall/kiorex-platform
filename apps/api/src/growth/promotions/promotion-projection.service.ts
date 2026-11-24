import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';

const STATUSES = new Set(['DRAFT', 'SUBMITTED', 'IN_REVIEW', 'APPROVED', 'ACTIVE', 'PAUSED', 'EXHAUSTED', 'EXPIRED', 'REJECTED', 'ARCHIVED']);
const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.slice(0, max) : '');

/**
 * The Kiorex projection of a provider-owned promotion (ADR-041: the Clinic is the owner). Fed by the signed `PROVIDER_PROMOTION_UPDATED` event; one row per (promotionId, version); an older event never overwrites a
 * newer one (compared on the event time); an unknown status is ignored. The projection holds PUBLIC advertising text and rules only: no budget balance, no wallet, no patient.
 */
@Injectable()
export class PromotionProjectionService {
  private readonly log = new Logger('promotion-projection');
  constructor(private readonly prisma: PrismaService) {}

  async applyUpdated(data: Record<string, any>, market = 'EG'): Promise<'APPLIED' | 'IGNORED'> {
    const promotionId = str(data.promotionId, 64), orgRef = str(data.orgRef, 64), status = str(data.status, 20);
    const version = Number(data.version); const at = data.at && !Number.isNaN(Date.parse(data.at)) ? new Date(data.at) : new Date();
    if (!promotionId || !orgRef || !Number.isInteger(version) || version < 1 || !STATUSES.has(status)) return 'IGNORED';
    const d = data.discount ?? {}; const copy = data.patientCopy ?? {};
    const row = {
      market, orgRef, status, eligibility: (data.eligibility ?? {}) as Prisma.InputJsonValue, budgetCapMinor: BigInt(Number.isInteger(data.budgetCapMinor) && data.budgetCapMinor > 0 ? data.budgetCapMinor : 0), fundingMode: data.fundingMode === 'WALLET_THEN_INVOICE' ? 'WALLET_THEN_INVOICE' : 'WALLET_ONLY',
      nameAr: str(data.name?.ar, 120), nameEn: str(data.name?.en, 120), scope: (data.scope ?? {}) as Prisma.InputJsonValue, discount: { kind: d.kind, value: d.value, ...(d.maxPerBookingMinor ? { maxPerBookingMinor: d.maxPerBookingMinor } : {}) } as Prisma.InputJsonValue,
      patientCopyAr: str(copy.ar), patientCopyEn: str(copy.en), contentHash: str(data.contentHash, 64), startsAt: data.startsAt ? new Date(data.startsAt) : null, endsAt: data.endsAt ? new Date(data.endsAt) : null, lastEventAt: at,
    };
    const cur = await this.prisma.sponsoredPromotionProjection.findUnique({ where: { promotionId_version: { promotionId, version } } });
    if (cur && cur.lastEventAt > at) return 'IGNORED';
    await this.prisma.sponsoredPromotionProjection.upsert({ where: { promotionId_version: { promotionId, version } }, create: { promotionId, version, ...row }, update: row });
    // a newer version replaces the older ones for offering: the older versions stop being quotable (their reservations settle on the version they cited)
    if (status === 'ACTIVE' || status === 'IN_REVIEW' || status === 'DRAFT') await this.prisma.sponsoredPromotionProjection.updateMany({ where: { promotionId, version: { lt: version }, status: { in: ['ACTIVE', 'PAUSED', 'EXHAUSTED', 'APPROVED'] } }, data: { status: 'ARCHIVED' } });
    return 'APPLIED';
  }
}
