import { Injectable } from '@nestjs/common';
import { addressHash } from '../../common/privacy-hash';
import { PrismaService } from '../../prisma/prisma.service';

export const SUPPRESSION_CHANNELS = ['WHATSAPP', 'SMS', 'EMAIL', 'PUSH', 'ALL'] as const;
export const SUPPRESSION_REASONS = ['STOP', 'BOUNCE', 'COMPLAINT', 'WITHDRAWAL', 'MANUAL'] as const;

/**
 * Marketing suppression list (STOP and إلغاء, bounces, complaints, withdrawal). Only a KEYED HASH of the phone number or e-mail address is stored
 * (matching works across accounts and channels, the raw value is never kept). Suppression blocks MARKETING only; transactional, security and clinical
 * messages are never suppressed by it. Lifting needs an explicit action (a fresh opt-in), it never expires on its own.
 */
@Injectable()
export class SuppressionService {
  constructor(private readonly prisma: PrismaService) {}

  async add(i: { address: string; channel?: string; reason?: string; source?: string; market?: string }) {
    const channel = (SUPPRESSION_CHANNELS as readonly string[]).includes(i.channel ?? '') ? i.channel! : 'ALL';
    const reason = (SUPPRESSION_REASONS as readonly string[]).includes(i.reason ?? '') ? i.reason! : 'MANUAL';
    const h = addressHash(i.address); const market = i.market ?? 'EG';
    return this.prisma.communicationSuppression.upsert({
      where: { market_channel_addressHash: { market, channel, addressHash: h } },
      create: { market, channel, addressHash: h, reason, source: i.source ?? 'system' },
      update: { liftedAt: null, reason, source: i.source ?? 'system' }, // a repeat STOP after a lift suppresses again
    });
  }

  async lift(address: string, channel = 'ALL', market = 'EG') {
    const r = await this.prisma.communicationSuppression.updateMany({ where: { market, channel, addressHash: addressHash(address), liftedAt: null }, data: { liftedAt: new Date() } });
    return r.count > 0;
  }

  /**
   * A FRESH explicit opt-in lifts a suppression the person caused themselves (STOP, withdrawal) on that channel. Bounces, complaints and manual
   * entries are never lifted by a consent: they say the address cannot or must not be written to. Returns how many rows were lifted.
   */
  async liftOwnOptOut(addresses: Array<string | null | undefined>, channel: string, market = 'EG'): Promise<number> {
    const hashes = addresses.filter((a): a is string => !!a).map(addressHash);
    if (!hashes.length) return 0;
    const r = await this.prisma.communicationSuppression.updateMany({ where: { market, channel, addressHash: { in: hashes }, reason: { in: ['STOP', 'WITHDRAWAL'] }, liftedAt: null }, data: { liftedAt: new Date() } });
    return r.count;
  }

  /** GRW-P2-E: the same check by keyed hash (the lifecycle gate and ops tools hold hashes, never raw addresses). */
  async isHashSuppressed(hashes: string[], channel: string, market = 'EG'): Promise<boolean> {
    if (!hashes.length) return false;
    return (await this.prisma.communicationSuppression.count({ where: { market, addressHash: { in: hashes }, channel: { in: [channel, 'ALL'] }, liftedAt: null } })) > 0;
  }

  /** True when the address is suppressed for this channel (a row for the channel or for ALL, not lifted). */
  async isSuppressed(addresses: Array<string | null | undefined>, channel: string, market = 'EG'): Promise<boolean> {
    const hashes = addresses.filter((a): a is string => !!a).map(addressHash);
    if (!hashes.length) return false;
    return (await this.prisma.communicationSuppression.count({ where: { market, addressHash: { in: hashes }, channel: { in: [channel, 'ALL'] }, liftedAt: null } })) > 0;
  }
}
