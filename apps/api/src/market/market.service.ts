import { Injectable } from '@nestjs/common';
import { ApiError, forbidden } from '../common/errors';
import { FlagsService } from '../control-plane/control-plane-public';
import { PrismaService } from '../prisma/prisma.service';

const KEY = (cc: string) => `market.${cc.toLowerCase()}.live`;

/**
 * Market gate (launch-locked `market.<cc>.live`, ADR-024). A market is LIVE only while its flag is effective, i.e. not
 * switched OFF AND gate evidence recorded by a human in the super admin. Not live => country hidden from sign-up and
 * search; booking/slots/profile answer 403 FEATURE_DISABLED {key, scope}. Existing tenants/data are never deleted.
 */
@Injectable()
export class MarketService {
  constructor(private readonly prisma: PrismaService, private readonly flags: FlagsService) {}

  /** Markets that have a market.<cc>.live definition in the registry (EG seeded; more via the admin definitions endpoint). */
  async known(): Promise<string[]> {
    const rows = await this.prisma.flagDefinition.findMany({ where: { key: { startsWith: 'market.', endsWith: '.live' } }, select: { key: true } });
    return rows.map((r) => r.key.split('.')[1].toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)).sort();
  }
  async isLive(cc: string): Promise<boolean> {
    if (!(await this.known()).includes(cc.toUpperCase())) return false; // unknown market is never live
    return this.flags.isEnabled(KEY(cc), { market: cc.toUpperCase() });
  }
  async liveMarkets(): Promise<string[]> {
    const out: string[] = [];
    for (const cc of await this.known()) if (await this.flags.isEnabled(KEY(cc), { market: cc })) out.push(cc);
    return out;
  }
  async list() {
    const out: { code: string; live: boolean; flag: string; state: string }[] = [];
    for (const cc of await this.known()) {
      const r = await this.flags.evaluate(KEY(cc), { market: cc });
      out.push({ code: cc, live: r.effective, flag: KEY(cc), state: r.effective ? 'LIVE' : r.reason });
    }
    return out;
  }
  async assertLive(cc: string): Promise<void> {
    if (!(await this.known()).includes(cc.toUpperCase())) throw new ApiError(404, 'MARKET_UNKNOWN', 'Unknown market');
    const r = await this.flags.evaluate(KEY(cc), { market: cc.toUpperCase() });
    if (!r.effective) throw forbidden('FEATURE_DISABLED', 'This market is not live yet', { key: KEY(cc), scope: r.scope ?? 'GATE', reason: r.reason });
  }
}
