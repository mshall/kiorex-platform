import { Injectable } from '@nestjs/common';
import { Prisma } from '../../prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GROWTH_DEFAULT_MARKET } from '../growth-flags';
import { maskBreakdown, maskCount, maskTotal } from '../corporate/corporate-privacy';
import { TIER_KEYS } from './loyalty-config';
import { LoyaltyService } from './loyalty.service';
import { tierFor } from './tiers';

/**
 * What the ops console sees of loyalty (GRW-P4-D): the active rules, how many people sit in each tier and how many points are outstanding, issued, expired and converted in the last 30 days. Every cell is a count or a
 * sum masked below k = 10 (a masked cell is null and `suppressed` lists it); there is no per-person row, no booking, no provider and no way to look a person up here.
 */
@Injectable()
export class LoyaltyAdminService {
  constructor(private readonly prisma: PrismaService, private readonly loyalty: LoyaltyService) {}

  async rules() {
    const { rules, versionId, source } = await this.loyalty.rules(GROWTH_DEFAULT_MARKET);
    const allZero = rules.pointsPerCompletedBooking === 0 && rules.annualCapPoints === 0 && TIER_KEYS.every((k) => rules.tiers[k].minCompletedBookings === 0) && rules.conversion.pointsRequired === 0;
    return { rules, versionId, source, defaultsOnly: source !== 'ACTIVE', allZero, flagOn: await this.loyalty.isOn() };
  }

  /** What tier a person with N completed bookings in the window would have under the active rules (a calculator, no person involved). */
  async previewTier(completed: number) { const { rules } = await this.loyalty.rules(GROWTH_DEFAULT_MARKET); return { completed, tier: tierFor(completed, rules) }; }

  async summary(now = new Date()) {
    const since = new Date(now.getTime() - 30 * 86_400_000);
    const [accounts, tiers, outstanding, flow, parts] = await Promise.all([
      this.prisma.loyaltyAccount.count({ where: { market: GROWTH_DEFAULT_MARKET } }),
      this.prisma.loyaltyAccount.groupBy({ by: ['tier'], where: { market: GROWTH_DEFAULT_MARKET }, _count: { _all: true } }),
      this.prisma.$queryRaw<{ n: bigint; s: bigint | null }[]>(Prisma.sql`SELECT count(*) AS n, sum("pointsBalanceCache") AS s FROM "LoyaltyAccount" WHERE "market" = ${GROWTH_DEFAULT_MARKET} AND "pointsBalanceCache" > 0`),
      this.prisma.$queryRaw<{ type: string; n: bigint; s: bigint }[]>(Prisma.sql`SELECT "type", count(DISTINCT "accountId") AS n, sum("points") AS s FROM "LoyaltyAccrualEntry" WHERE "createdAt" >= ${since} GROUP BY "type"`),
      this.prisma.partnershipProgram.groupBy({ by: ['status'], where: { market: GROWTH_DEFAULT_MARKET }, _count: { _all: true }, _sum: { budgetMinor: true } }),
    ]);
    const tierCells = Object.fromEntries(['NONE', ...TIER_KEYS].map((t) => [t, tiers.find((x) => x.tier === t)?._count._all ?? 0])) as Record<string, number>;
    const f = (t: string) => flow.find((x) => x.type === t);
    const cell = (t: string) => { const r = f(t); return { people: r ? maskCount(Number(r.n)) : 0, points: r ? maskTotal(Number(r.s), Number(r.n)) : 0 }; };
    const earned = flow.filter((x) => x.type === 'ACCRUE' || x.type === 'TIER_BONUS'); const earnedPeople = earned.reduce((n, x) => n + Number(x.n), 0);
    const out = {
      k: 10, accounts: maskCount(accounts), tiers: maskBreakdown(tierCells),
      points: { outstanding: maskTotal(Number(outstanding[0]?.s ?? 0), Number(outstanding[0]?.n ?? 0)), holders: maskCount(Number(outstanding[0]?.n ?? 0)) },
      last30Days: { earned: { people: maskCount(earnedPeople), points: maskTotal(earned.reduce((n, x) => n + Number(x.s), 0), earnedPeople) }, expired: cell('EXPIRE'), reversed: cell('REVERSE'), converted: cell('CONVERT') },
      partnerships: Object.fromEntries(parts.map((p) => [p.status, { programs: p._count._all, budgetMinor: p._sum.budgetMinor ?? 0 }])),
      suppressed: [] as string[],
    };
    const walk = (o: unknown, path: string) => { if (o === null) out.suppressed.push(path); else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, path ? `${path}.${k}` : k); };
    walk({ accounts: out.accounts, tiers: out.tiers, points: out.points, last30Days: out.last30Days }, '');
    return out;
  }
}
