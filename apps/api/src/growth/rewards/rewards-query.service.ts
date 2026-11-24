import { DEFAULT_MARKET, marketCurrency } from '../../market/market-core-public';
import { Injectable } from '@nestjs/common';
import { ApiError } from '../../common/errors';
import { decryptField } from '../../common/crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RewardLedgerService } from './reward-ledger.service';
import { RewardPolicyService } from './reward-policy.service';
import { RewardRedemptionService, type RedemptionContext } from './reward-redemption.service';

const SERVICE_TEXT: Record<string, { en: string; ar: string }> = { IN_CLINIC: { en: 'clinic visits', ar: 'زيارات العيادة' }, VIDEO: { en: 'video visits', ar: 'زيارات الفيديو' }, HOME_VISIT: { en: 'home visits', ar: 'الزيارات المنزلية' } };
/** Plain scope text (no health word beyond the closed non-clinical service kinds): where the value can be spent, never why it was given. */
export function scopeText(scope: Record<string, unknown>, locale: 'ar' | 'en'): string {
  const kinds = (scope.serviceKinds as string[] | undefined) ?? [];
  const spec = (scope.specialtyAllowlist as string[] | undefined) ?? [];
  if (!kinds.length && !spec.length) return locale === 'ar' ? 'على أي حجز في كيوريكس' : 'On any Kiorex booking';
  const k = kinds.map((x) => SERVICE_TEXT[x]?.[locale]).filter(Boolean).join(locale === 'ar' ? ' و' : ', ');
  return (locale === 'ar' ? `على ${k || 'حجوزات محددة'}` : `On ${k || 'selected bookings'}`) + (spec.length ? (locale === 'ar' ? ' (تخصصات محددة)' : ' (selected specialties)') : '');
}

/** Read models of the patient wallet-less voucher list and the credit summary, the one-time coupon reveal and the checkout quote. Every method is scoped to the caller's own sub. */
@Injectable()
export class RewardsQueryService {
  constructor(private readonly prisma: PrismaService, private readonly ledger: RewardLedgerService, private readonly redemption: RewardRedemptionService, private readonly policy: RewardPolicyService) {}

  async rewards(sub: string, o: { take?: number; cursor?: string } = {}) {
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

  /** The coupon code is shown exactly once: the seal is cleared in the same statement that reads it; afterwards only the keyed hash exists and nobody, including support, can show it again. */
  async reveal(sub: string, lotId: string): Promise<{ code: string }> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ couponCodeSealed: string | null }[]>`SELECT "couponCodeSealed" FROM "RewardLot" WHERE "id" = ${lotId} AND COALESCE("ownerSub","sub") = ${sub} AND "mode" = 'COUPON' FOR UPDATE`;
      const sealed = rows[0]?.couponCodeSealed;
      if (!sealed) throw new ApiError(409, 'COUPON_ALREADY_REVEALED', 'This code was already shown. Use the voucher from your list at checkout.');
      await tx.rewardLot.update({ where: { id: lotId }, data: { couponCodeSealed: null, couponRevealedAt: new Date() } });
      return { code: decryptField(sealed) };
    });
  }

  async credit(sub: string, locale: 'ar' | 'en') {
    const now = new Date();
    const open = await this.ledger.openLots(this.prisma, { owners: [sub], now, mode: 'CREDIT' });
    const h = await this.prisma.rewardHousehold.findFirst({ where: { ownerSub: sub }, include: { members: { where: { endedAt: null } } } });
    return {
      openBalanceMinor: open.reduce((s, l) => s + l.availableMinor, 0), currency: (open[0] as { currency?: string } | undefined)?.currency ?? (marketCurrency(DEFAULT_MARKET) || 'EGP'),
      lots: open.map((l) => ({ id: l.id, kind: l.kind, remainingMinor: l.availableMinor, expiresAt: l.expiresAt, scopeText: scopeText(l.scope, locale), funding: l.funding })),
      household: h ? { ownerIsMe: true, members: h.members.length } : null,
    };
  }

  async quote(sub: string, i: { amountMinor: number; bookingRef?: string; careType?: string; couponCode?: string; lotId?: string }) {
    const ctx: RedemptionContext = { sub, amountMinor: i.amountMinor, serviceKind: (['IN_CLINIC', 'VIDEO', 'HOME_VISIT'].includes(i.careType ?? '') ? i.careType : 'IN_CLINIC') as RedemptionContext['serviceKind'], couponCode: i.couponCode, lotId: i.lotId };
    if (i.bookingRef) {
      const b = await this.prisma.bookingIntent.findFirst({ where: { id: i.bookingRef, sub } });
      if (!b) throw new ApiError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
      const p = await this.prisma.provider.findUnique({ where: { id: b.providerId }, select: { specialty: true } });
      Object.assign(ctx, { serviceKind: bookingServiceKind(b), specialty: p?.specialty ?? null, dependantId: b.dependantId });
    }
    return this.redemption.quoteLines(ctx);
  }
}

export const bookingServiceKind = (b: { serviceLocation: string; telehealth: unknown }): 'IN_CLINIC' | 'VIDEO' | 'HOME_VISIT' => (b.serviceLocation === 'HOME' ? 'HOME_VISIT' : b.telehealth ? 'VIDEO' : 'IN_CLINIC');
