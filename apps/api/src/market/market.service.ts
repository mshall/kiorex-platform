import { Injectable } from '@nestjs/common';
import { ApiError, forbidden } from '../common/errors';
import { FlagsService } from '../control-plane/control-plane-public';
import { PrismaService } from '../prisma/prisma.service';
import { MarketProfileService } from './market-profile.service';

const KEY = (cc: string) => `market.${cc.toLowerCase()}.live`;

/**
 * Market gate (launch-locked `market.<cc>.live`, ADR-024). A market is LIVE only while its flag is effective, i.e. not
 * switched OFF AND gate evidence recorded by a human in the super admin. Not live => country hidden from sign-up and
 * search; booking/slots/profile answer 403 FEATURE_DISABLED {key, scope}. Existing tenants/data are never deleted.
 */
@Injectable()
export class MarketService {
  constructor(private readonly prisma: PrismaService, private readonly flags: FlagsService, private readonly profiles: MarketProfileService) {}

  /** Markets that have a market.<cc>.live definition in the registry (EG seeded; more via the admin definitions endpoint). */
  async known(): Promise<string[]> {
    await this.profiles.ensureFresh(); // a market created by the wizard (MARKET_PROFILE) needs its flag definition, but its facts come from the configuration
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
  /**
   * The specialty subset a market chose in the onboarding wizard (step `specialties`), read from the PUBLISHED plan: `{ code, nameAr, nameEn }[]`, or null when the market has no plan (EG, SA and AE keep the
   * complete catalogue: no restriction). Cached for 15 seconds (the wizard publishes rarely); a missing or malformed step also means no restriction, never an empty list that hides a whole market.
   */
  private specCache = new Map<string, { at: number; v: { code: string; nameAr: string; nameEn: string }[] | null }>();
  async enabledSpecialties(cc: string): Promise<{ code: string; nameAr: string; nameEn: string }[] | null> {
    const key = cc.toUpperCase(); const hit = this.specCache.get(key);
    if (hit && Date.now() - hit.at < 15_000) return hit.v;
    const plan = await this.prisma.marketOnboardingPlan.findUnique({ where: { cc: key }, select: { status: true, steps: true } });
    const list = (plan?.status === 'PUBLISHED' ? (plan.steps as { specialties?: { enabled?: unknown } } | null)?.specialties?.enabled : undefined) as unknown;
    const v = Array.isArray(list) && list.length
      ? list.filter((x): x is { code: string; nameAr: string; nameEn: string } => !!x && typeof (x as { code?: unknown }).code === 'string').map((x) => ({ code: x.code, nameAr: String(x.nameAr ?? x.code), nameEn: String(x.nameEn ?? x.code) }))
      : null;
    this.specCache.set(key, { at: Date.now(), v: v && v.length ? v : null });
    return v && v.length ? v : null;
  }
  invalidateSpecialties(): void { this.specCache.clear(); }

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
