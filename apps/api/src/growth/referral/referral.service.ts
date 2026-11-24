import { Injectable } from '@nestjs/common';
import { REFERRAL_CODE_PATTERN } from '@kiorex/contracts';
import { ApiError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { GROWTH_DEFAULT_MARKET } from '../growth-flags';
import { GrowthLimiter } from '../growth-limiter';
import { RewardEventsService } from '../rewards/reward-events.service';
import { RewardLedgerService } from '../rewards/reward-ledger.service';
import { RewardPolicyService } from '../rewards/reward-policy.service';
import { generateReferralCode, inviteDeepLink, inviteUrl, shareText } from './referral-code';
import { ReferralIdentityService } from './referral-identity.service';

const CHANNELS = ['LINK', 'WHATSAPP_SHARE', 'SMS', 'COPY'] as const;
export type InviteChannel = (typeof CHANNELS)[number];

/** A patient's own referral code, invite links and counts (GRW-P2-B1). The referrer sees COUNTS only: who joined, where they booked and what they paid never reach this response. */
@Injectable()
export class ReferralService {
  constructor(private readonly prisma: PrismaService, private readonly identity: ReferralIdentityService, private readonly events: RewardEventsService, private readonly policy: RewardPolicyService, private readonly limiter: GrowthLimiter, private readonly ledger: RewardLedgerService) {}

  /** One active code per patient, issued on first use (idempotent, collision-safe). The code is also registered as a REFERRAL acquisition source so a consented landing touch can carry it. */
  async ensureCode(sub: string, market = GROWTH_DEFAULT_MARKET) {
    const found = await this.prisma.referralCode.findUnique({ where: { market_sub: { market, sub } } });
    if (found) return found;
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const created = await this.prisma.$transaction(async (tx) => {
          const c = await tx.referralCode.create({ data: { market, sub, code: generateReferralCode() } });
          await tx.growthAcquisitionSource.upsert({ where: { market_sourceKind_sourceRef: { market, sourceKind: 'REFERRAL', sourceRef: c.code } }, create: { market, sourceKind: 'REFERRAL', sourceRef: c.code }, update: {} });
          await this.events.emit(tx, 'ReferralCodeIssued', 'ReferralCode', c.id, { codeRef: c.id, market, code: c.code, issuedAt: c.createdAt.toISOString() }, c.id);
          return c;
        });
        return created;
      } catch (e) {
        if ((e as { code?: string }).code !== 'P2002') throw e;
        const raced = await this.prisma.referralCode.findUnique({ where: { market_sub: { market, sub } } });
        if (raced) return raced; // another request of the same patient won the race
      }
    }
    throw new ApiError(503, 'REFERRAL_CODE_UNAVAILABLE', 'A referral code could not be issued, try again');
  }

  async me(u: { sub: string; phone?: string; locale?: string }) {
    const { rules } = await this.policy.referralRules();
    await this.identity.recordPhone(u.sub, u.phone);
    const code = await this.ensureCode(u.sub);
    const [invited, signedUp, qualified, last30, year] = await Promise.all([
      this.prisma.referralShare.count({ where: { codeId: code.id } }),
      this.prisma.referralRelationship.count({ where: { referrerSub: u.sub, status: { in: ['SIGNED_UP', 'BOOKED', 'QUALIFIED'] } } }),
      this.prisma.referralRelationship.count({ where: { referrerSub: u.sub, status: 'QUALIFIED' } }),
      this.prisma.referralRelationship.count({ where: { referrerSub: u.sub, status: 'QUALIFIED', qualifiedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } }),
      this.prisma.referralRelationship.count({ where: { referrerSub: u.sub, status: 'QUALIFIED', qualifiedAt: { gte: new Date(Date.now() - 365 * 86_400_000) } } }),
    ]);
    const locale = u.locale === 'en' ? 'en' : 'ar';
    const open = await this.ledger.openLots(this.prisma, { owners: [u.sub], now: new Date() }); // existing balances stay visible whatever the switches say
    return {
      code: code.code, status: code.status, inviteUrl: inviteUrl(code.code, { locale }), deepLink: inviteDeepLink(code.code),
      counts: { invited, signedUp, qualified },
      capsRemaining: { last30Days: Math.max(0, rules.caps.perReferrer30Days - last30), thisYear: Math.max(0, rules.caps.perReferrerYear - year) },
      rewards: { activeCount: open.length, activeMinor: open.reduce((s, l) => s + l.availableMinor, 0), currency: 'EGP' },
    };
  }

  /** Records a share (counts only, no recipient) and returns the link and the share text. Rate limited per patient. */
  async createInvite(u: { sub: string; locale?: string }, i: { channel?: string; locale?: string }) {
    if (i.channel !== undefined && !(CHANNELS as readonly string[]).includes(i.channel)) throw new ApiError(400, 'GROWTH_INVALID_REQUEST', 'channel must be one of LINK, WHATSAPP_SHARE, SMS, COPY');
    await this.limiter.take('referral-invite', u.sub.slice(0, 24), 30, 3600_000);
    const code = await this.ensureCode(u.sub);
    if (code.status !== 'ACTIVE') throw new ApiError(403, 'REFERRAL_CODE_SUSPENDED', 'Your invite link is not available');
    await this.prisma.referralShare.create({ data: { codeId: code.id, channel: i.channel ?? 'LINK' } });
    const locale = i.locale === 'en' || i.locale === 'ar' ? i.locale : u.locale === 'en' ? 'en' : 'ar';
    return { inviteUrl: inviteUrl(code.code, { locale }), code: code.code, shareText: shareText(code.code, { locale }) };
  }

  /** Neutral lookup for the public invite page: is this code usable? The answer never says who owns it and treats unknown, suspended and malformed alike. */
  async usable(code: string): Promise<boolean> {
    if (!REFERRAL_CODE_PATTERN.test(code)) return false;
    return !!(await this.prisma.referralCode.findFirst({ where: { code, status: 'ACTIVE' }, select: { id: true } }));
  }
}
