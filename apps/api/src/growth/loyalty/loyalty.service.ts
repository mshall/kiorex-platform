import { Injectable, Logger } from '@nestjs/common';
import { FlagsService } from '../../control-plane/control-plane-public';
import { ApiError, unprocessable } from '../../common/errors';
import { newId } from '../../common/ids';
import { Prisma } from '../../prisma/generated/client';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { GrowthConfigService } from '../config/growth-config.service';
import { GROWTH_DEFAULT_MARKET, LOYALTY_FLAG } from '../growth-flags';
import type { LoyaltyPort } from '../growth-ports-public';
import { toLoyaltyRules, type LoyaltyRules, type Tier } from './loyalty-config';
import { LoyaltyEventsService } from './loyalty-events.service';
import { LoyaltyRedemptionAdapter } from './loyalty-redemption.adapter';
import { addMonthsUtc, dayMs, nextExpiry, type PointsEntry } from './points-math';
import { TIER_RANK, bonusFor, nextTier, tierFor, windowStart } from './tiers';

export type AccrualOutcome =
  | { status: 'ACCRUED'; accountId: string; points: number; tier: Tier; tierBonus: number }
  | { status: 'EXISTING'; accountId: string }
  | { status: 'SKIPPED'; reason: 'FLAG_OFF' | 'RULES_OFF' | 'NOT_COMPLETED' | 'DEPENDANT' | 'UNKNOWN_BOOKING' | 'ZERO_POINTS' | 'ANNUAL_CAP'; tier?: Tier };
export interface ConvertResult { lotId: string; mode: string; points: number; amountMinor: number; currency: string; balanceAfter: number }
type Locked = { id: string; sub: string; tier: string; pointsBalanceCache: number; market: string };

const yearAgo = (now: Date) => new Date(now.getTime() - 365 * dayMs);

/**
 * Loyalty points (GRW-P4-D). A SEPARATE append-only points ledger per person; points are not money. Rules, in order of the safety review:
 *  - accrual only for a booking that is COMPLETED (never a hold, a deposit or a confirmation), once per booking (idempotency key), the person's own bookings only (a dependant's never enter growth tables);
 *  - tier from the count of completed bookings in the rolling window, thresholds of 0 mean "no tier" (shipped defaults: nobody has one);
 *  - FIFO expiry, run under the account lock before every accrual, conversion and read of the balance; the balance cannot go negative (database trigger);
 *  - conversion into a reward lot of kind LOYALTY through the P2-B2 issuance service IN THE SAME TRANSACTION: if the reward caps refuse, nothing is spent;
 *  - a refund takes the points that booking earned back (the part already converted is recorded as a shortfall for ops; the issued lot is a normal promotional lot and is not clawed back here).
 * Switch: `growth.loyalty` (launch-locked) plus REWARD rules for the lots. Every number comes from LOYALTY_RULES and defaults to 0 = off.
 */
@Injectable()
export class LoyaltyService implements LoyaltyPort {
  private readonly log = new Logger('loyalty');
  constructor(private readonly prisma: PrismaService, private readonly config: GrowthConfigService, private readonly flags: FlagsService, private readonly adapter: LoyaltyRedemptionAdapter, private readonly events: LoyaltyEventsService) {}

  isOn(market = GROWTH_DEFAULT_MARKET): Promise<boolean> { return this.flags.isEnabled(LOYALTY_FLAG, { market }).catch(() => false); }
  async rules(market = GROWTH_DEFAULT_MARKET, at?: Date): Promise<{ rules: LoyaltyRules; versionId: string; source: string }> {
    const r = await this.config.resolve('LOYALTY_RULES', { market, at });
    return { rules: toLoyaltyRules(r.payload), versionId: r.versionId, source: r.source };
  }

  // ───────────────────────── account and ledger primitives (all inside a transaction) ─────────────────────────
  private async lockAccount(tx: Tx, sub: string, market: string, create: boolean): Promise<Locked | null> {
    if (create) await tx.loyaltyAccount.upsert({ where: { market_sub: { market, sub } }, create: { id: newId('lac'), sub, market }, update: {} });
    const rows = await tx.$queryRaw<Locked[]>(Prisma.sql`SELECT "id","sub","tier","pointsBalanceCache","market" FROM "LoyaltyAccount" WHERE "market" = ${market} AND "sub" = ${sub} FOR UPDATE`);
    return rows[0] ?? null;
  }
  private async lockById(tx: Tx, id: string): Promise<Locked | null> {
    const rows = await tx.$queryRaw<Locked[]>(Prisma.sql`SELECT "id","sub","tier","pointsBalanceCache","market" FROM "LoyaltyAccount" WHERE "id" = ${id} FOR UPDATE`);
    return rows[0] ?? null;
  }
  /** Moves every point that expired and is still unspent out of the balance (FIFO, see loyalty_expirable_points). Idempotent per cumulative amount. */
  async expireLocked(tx: Tx, accountId: string, now: Date): Promise<number> {
    const x = (await tx.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT loyalty_expirable_points(${accountId}, ${now}::timestamptz) AS n`))[0]?.n ?? 0;
    if (x <= 0) return 0;
    const gone = (await tx.loyaltyAccrualEntry.aggregate({ where: { accountId, type: 'EXPIRE' }, _sum: { points: true } }))._sum.points ?? 0;
    await tx.loyaltyAccrualEntry.create({ data: { id: newId('lae'), accountId, type: 'EXPIRE', points: x, idempotencyKey: `loyalty:expire:${accountId}:${gone + x}`, reasonCode: 'POINTS_EXPIRED', actor: 'system:loyalty', createdAt: now } });
    return x;
  }
  private async earnedInYear(tx: Tx, accountId: string, now: Date): Promise<number> {
    return (await tx.loyaltyAccrualEntry.aggregate({ where: { accountId, type: { in: ['ACCRUE', 'TIER_BONUS'] }, createdAt: { gt: yearAgo(now) } }, _sum: { points: true } }))._sum.points ?? 0;
  }
  private completedCount(tx: Tx, sub: string, rules: LoyaltyRules, now: Date): Promise<number> {
    return tx.bookingIntent.count({ where: { sub, dependantId: null, status: 'COMPLETED', terminalAt: { gte: windowStart(now, rules.windowMonths), lte: now } } });
  }

  // ───────────────────────── accrual (the booking hook) ─────────────────────────
  async onBookingCompleted(bookingId: string, now = new Date()): Promise<void> { await this.accrue(bookingId, now); }

  async accrue(bookingId: string, now = new Date()): Promise<AccrualOutcome> {
    const b = await this.prisma.bookingIntent.findUnique({ where: { id: bookingId }, select: { id: true, sub: true, dependantId: true, status: true } });
    if (!b) return { status: 'SKIPPED', reason: 'UNKNOWN_BOOKING' };
    if (b.dependantId) return { status: 'SKIPPED', reason: 'DEPENDANT' };
    if (b.status !== 'COMPLETED') return { status: 'SKIPPED', reason: 'NOT_COMPLETED' };
    const market = GROWTH_DEFAULT_MARKET;
    if (!(await this.isOn(market))) return { status: 'SKIPPED', reason: 'FLAG_OFF' };
    const { rules } = await this.rules(market, undefined);
    if (!rules.enabled) return { status: 'SKIPPED', reason: 'RULES_OFF' };
    return this.prisma.$transaction(async (tx) => {
      const acc = (await this.lockAccount(tx, b.sub, market, true))!;
      const key = `loyalty:accrue:${bookingId}`;
      const dup = await tx.loyaltyAccrualEntry.findUnique({ where: { idempotencyKey: key }, select: { id: true } });
      if (dup) return { status: 'EXISTING' as const, accountId: acc.id };
      await this.expireLocked(tx, acc.id, now);
      // tier first: it depends on completed bookings only, so it moves even while points are 0
      const count = await this.completedCount(tx, b.sub, rules, now);
      const tier = tierFor(count, rules);
      let tierBonus = 0;
      if (tier !== acc.tier) {
        await tx.loyaltyAccount.update({ where: { id: acc.id }, data: { tier, tierSince: now } });
        await tx.auditLog.create({ data: { actor: 'system:loyalty', action: 'growth.loyalty.tier_changed', resource: 'LoyaltyAccount', resourceId: acc.id, metadata: { from: acc.tier, to: tier, completedInWindow: count } } });
        const bonus = bonusFor(tier, rules);
        if (TIER_RANK[tier] > TIER_RANK[acc.tier as Tier] && bonus > 0) {
          const had = await tx.loyaltyAccrualEntry.count({ where: { accountId: acc.id, type: 'TIER_BONUS', reasonCode: `TIER_${tier}`, createdAt: { gt: yearAgo(now) } } });
          const earned = await this.earnedInYear(tx, acc.id, now);
          if (!had && rules.annualCapPoints > 0 && earned + bonus <= rules.annualCapPoints) {
            await tx.loyaltyAccrualEntry.create({ data: { id: newId('lae'), accountId: acc.id, type: 'TIER_BONUS', points: bonus, bookingId, idempotencyKey: `loyalty:tier:${acc.id}:${tier}:${bookingId}`, expiresAt: addMonthsUtc(now, rules.expiryMonths), reasonCode: `TIER_${tier}`, actor: 'system:loyalty', createdAt: now } });
            await this.events.emit(tx, 'LoyaltyPointsAccrued', 'LoyaltyAccount', acc.id, { accountRef: acc.id, market, entryType: 'TIER_BONUS', points: bonus, tier, at: now.toISOString() }, `tier:${acc.id}:${tier}:${bookingId}`);
            tierBonus = bonus;
          }
        }
      }
      const points = rules.pointsPerCompletedBooking;
      if (points <= 0) return { status: 'SKIPPED' as const, reason: 'ZERO_POINTS' as const, tier };
      const earned = await this.earnedInYear(tx, acc.id, now);
      if (rules.annualCapPoints <= 0 || earned + tierBonus + points > rules.annualCapPoints) return { status: 'SKIPPED' as const, reason: 'ANNUAL_CAP' as const, tier };
      await tx.loyaltyAccrualEntry.create({ data: { id: newId('lae'), accountId: acc.id, type: 'ACCRUE', points, bookingId, idempotencyKey: key, expiresAt: addMonthsUtc(now, rules.expiryMonths), reasonCode: 'BOOKING_COMPLETED', actor: 'system:loyalty', createdAt: now } });
      await this.events.emit(tx, 'LoyaltyPointsAccrued', 'LoyaltyAccount', acc.id, { accountRef: acc.id, market, entryType: 'ACCRUE', points, tier, at: now.toISOString() }, `accrue:${bookingId}`);
      return { status: 'ACCRUED' as const, accountId: acc.id, points, tier, tierBonus };
    }, { timeout: 20_000 });
  }

  // ───────────────────────── refund reversal ─────────────────────────
  /** A refund of the booking: its accrued points are taken back (REVERSE). What was already converted cannot be taken from the balance: it is written as a shortfall and audited. Works with the flag OFF (it only removes value). */
  async onBookingRefunded(bookingId: string, now = new Date()): Promise<void> { await this.reverseForBooking(bookingId, now); }

  async reverseForBooking(bookingId: string, now = new Date()): Promise<{ reversed: number; shortfall: number }> {
    const earned = await this.prisma.loyaltyAccrualEntry.findUnique({ where: { idempotencyKey: `loyalty:accrue:${bookingId}` } });
    if (!earned) return { reversed: 0, shortfall: 0 };
    return this.prisma.$transaction(async (tx) => {
      const acc = (await this.lockById(tx, earned.accountId))!;
      const key = `loyalty:reverse:${bookingId}`;
      const done = await tx.loyaltyAccrualEntry.findUnique({ where: { idempotencyKey: key } });
      if (done) return { reversed: done.points, shortfall: done.shortfallPoints };
      const marker = await tx.auditLog.findFirst({ where: { action: 'growth.loyalty.reverse_shortfall', resource: 'LoyaltyAccount', resourceId: acc.id, metadata: { path: ['bookingRef'], equals: bookingId } }, select: { id: true } });
      if (marker) return { reversed: 0, shortfall: earned.points };
      await this.expireLocked(tx, acc.id, now);
      const balance = (await tx.loyaltyAccount.findUniqueOrThrow({ where: { id: acc.id }, select: { pointsBalanceCache: true } })).pointsBalanceCache;
      const take = Math.min(earned.points, balance); const shortfall = earned.points - take;
      if (take > 0) await tx.loyaltyAccrualEntry.create({ data: { id: newId('lae'), accountId: acc.id, type: 'REVERSE', points: take, bookingId, idempotencyKey: key, shortfallPoints: shortfall, reasonCode: 'BOOKING_REFUNDED', actor: 'system:loyalty', createdAt: now } });
      if (shortfall > 0) await tx.auditLog.create({ data: { actor: 'system:loyalty', action: 'growth.loyalty.reverse_shortfall', resource: 'LoyaltyAccount', resourceId: acc.id, metadata: { bookingRef: bookingId, shortfallPoints: shortfall, reversedPoints: take } } });
      return { reversed: take, shortfall };
    }, { timeout: 20_000 });
  }

  // ───────────────────────── conversion into a reward lot ─────────────────────────
  /** One block of `conversion.pointsRequired` points becomes one LOYALTY reward lot of `conversion.valueMinor`. `requestKey` makes a retry return the same lot. Everything or nothing. */
  async convert(sub: string, requestKey: string, now = new Date()): Promise<ConvertResult> {
    const market = GROWTH_DEFAULT_MARKET;
    if (!(await this.isOn(market))) throw new ApiError(403, 'FEATURE_DISABLED', 'Loyalty is not available', { key: LOYALTY_FLAG });
    const { rules } = await this.rules(market);
    const c = rules.conversion;
    if (!rules.enabled || c.pointsRequired <= 0 || c.valueMinor <= 0 || c.maxBlocksPerYear <= 0) throw unprocessable('LOYALTY_CONVERSION_OFF', 'Points cannot be converted right now');
    const pre = await this.adapter.policy(); // read before the transaction opens (it must not wait for a second pooled connection while holding one)
    return this.prisma.$transaction(async (tx) => {
      const acc = await this.lockAccount(tx, sub, market, false);
      if (!acc) throw unprocessable('LOYALTY_INSUFFICIENT_POINTS', 'You do not have enough points');
      const key = `loyalty:convert:${acc.id}:${requestKey}`;
      const prior = await tx.loyaltyAccrualEntry.findUnique({ where: { idempotencyKey: key } });
      if (prior?.lotId) { const lot = await this.adapter.lot(tx, prior.lotId); return { lotId: lot.id, mode: lot.mode, points: prior.points, amountMinor: lot.amountMinor, currency: lot.currency, balanceAfter: (await tx.loyaltyAccount.findUniqueOrThrow({ where: { id: acc.id } })).pointsBalanceCache }; }
      await this.expireLocked(tx, acc.id, now);
      const balance = (await tx.loyaltyAccount.findUniqueOrThrow({ where: { id: acc.id } })).pointsBalanceCache;
      if (balance < c.pointsRequired) throw unprocessable('LOYALTY_INSUFFICIENT_POINTS', 'You do not have enough points', { balance, required: c.pointsRequired });
      const blocks = await tx.loyaltyAccrualEntry.count({ where: { accountId: acc.id, type: 'CONVERT', createdAt: { gt: yearAgo(now) } } });
      if (blocks >= c.maxBlocksPerYear) throw unprocessable('LOYALTY_CONVERSION_REFUSED', 'You have reached the yearly conversion limit', { reason: 'YEARLY_LIMIT' });
      const r = await this.adapter.issueLoyaltyLot(tx, { sub, accountId: acc.id, amountMinor: c.valueMinor, key: requestKey, pre, now });
      if (r.status === 'SKIPPED') throw unprocessable('LOYALTY_CONVERSION_REFUSED', 'This conversion is not available right now', { reason: r.reason });
      await tx.loyaltyAccrualEntry.create({ data: { id: newId('lae'), accountId: acc.id, type: 'CONVERT', points: c.pointsRequired, lotId: r.lotId, idempotencyKey: key, reasonCode: 'CONVERTED_TO_LOT', actor: `user:${acc.id}`, createdAt: now } });
      const lot = await this.adapter.lot(tx, r.lotId);
      await this.events.emit(tx, 'LoyaltyPointsConverted', 'LoyaltyAccount', acc.id, { accountRef: acc.id, market, points: c.pointsRequired, lotRef: r.lotId, amountMinor: lot.amountMinor, currency: lot.currency, at: now.toISOString() }, `convert:${acc.id}:${requestKey}`);
      return { lotId: r.lotId, mode: r.mode, points: c.pointsRequired, amountMinor: lot.amountMinor, currency: lot.currency, balanceAfter: balance - c.pointsRequired };
    }, { timeout: 30_000, maxWait: 30_000 });
  }

  // ───────────────────────── the patient's own view ─────────────────────────
  async me(sub: string, now = new Date()) {
    const market = GROWTH_DEFAULT_MARKET;
    const { rules } = await this.rules(market);
    const acc = await this.prisma.loyaltyAccount.findUnique({ where: { market_sub: { market, sub } } });
    const completed = await this.prisma.bookingIntent.count({ where: { sub, dependantId: null, status: 'COMPLETED', terminalAt: { gte: windowStart(now, rules.windowMonths), lte: now } } });
    const tier = tierFor(completed, rules);
    const entries = acc ? await this.prisma.loyaltyAccrualEntry.findMany({ where: { accountId: acc.id }, orderBy: { createdAt: 'asc' }, select: { id: true, type: true, points: true, expiresAt: true, createdAt: true } }) : [];
    const pts: PointsEntry[] = entries.map((e) => ({ id: e.id, type: e.type as PointsEntry['type'], points: e.points, expiresAt: e.expiresAt, createdAt: e.createdAt }));
    const lapsed = (await this.prisma.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT loyalty_expirable_points(${acc?.id ?? ''}, ${now}::timestamptz) AS n`))[0]?.n ?? 0;
    const balance = Math.max(0, (acc?.pointsBalanceCache ?? 0) - lapsed);
    const nxt = nextTier(tier, rules);
    const c = rules.conversion; const open = rules.enabled && c.pointsRequired > 0 && c.valueMinor > 0 && c.maxBlocksPerYear > 0;
    const blocksUsed = acc ? await this.prisma.loyaltyAccrualEntry.count({ where: { accountId: acc.id, type: 'CONVERT', createdAt: { gt: yearAgo(now) } } }) : 0;
    const soon = nextExpiry(pts, now);
    return {
      tier, tierSince: acc?.tierSince?.toISOString() ?? null, window: { months: rules.windowMonths, completed },
      next: nxt ? { tier: nxt.tier, minCompletedBookings: nxt.minCompletedBookings, remaining: Math.max(0, nxt.minCompletedBookings - completed) } : null,
      points: { balance, expiringSoon: soon && soon.points > 0 ? { points: Math.min(soon.points, balance), at: soon.at.toISOString() } : null },
      conversion: { open, pointsRequired: c.pointsRequired, valueMinor: c.valueMinor, currency: 'EGP', blocksLeftThisYear: open ? Math.max(0, c.maxBlocksPerYear - blocksUsed) : 0, canConvert: open && balance >= c.pointsRequired && blocksUsed < c.maxBlocksPerYear },
      notMoney: true,
    };
  }
  async history(sub: string, take = 30) {
    const acc = await this.prisma.loyaltyAccount.findUnique({ where: { market_sub: { market: GROWTH_DEFAULT_MARKET, sub } }, select: { id: true } });
    if (!acc) return { items: [] };
    const rows = await this.prisma.loyaltyAccrualEntry.findMany({ where: { accountId: acc.id }, orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(take, 1), 100), select: { id: true, type: true, points: true, expiresAt: true, createdAt: true } });
    return { items: rows.map((r) => ({ id: r.id, type: r.type, points: r.points, direction: r.type === 'ACCRUE' || r.type === 'TIER_BONUS' ? 'IN' : 'OUT', expiresAt: r.expiresAt?.toISOString() ?? null, at: r.createdAt.toISOString() })) };
  }

  // ───────────────────────── housekeeping (daily job) ─────────────────────────
  /** Expires lapsed points and re-evaluates tiers whose window moved. Idempotent; processed in small batches. */
  async housekeeping(now = new Date()): Promise<{ accountsExpired: number; pointsExpired: number; tiersChanged: number }> {
    const { rules } = await this.rules(GROWTH_DEFAULT_MARKET);
    const due = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT a."id" FROM "LoyaltyAccount" a WHERE a."pointsBalanceCache" > 0 AND EXISTS (SELECT 1 FROM "LoyaltyAccrualEntry" e WHERE e."accountId" = a."id" AND e."type" IN ('ACCRUE','TIER_BONUS') AND e."expiresAt" <= ${now}) ORDER BY a."id" LIMIT 500`);
    let pointsExpired = 0; let accountsExpired = 0;
    for (const { id } of due) {
      const n = await this.prisma.$transaction(async (tx) => { const a = await this.lockById(tx, id); return a ? this.expireLocked(tx, id, now) : 0; }, { timeout: 20_000 });
      if (n > 0) { pointsExpired += n; accountsExpired++; }
    }
    let tiersChanged = 0;
    if (rules.enabled) {
      const accs = await this.prisma.loyaltyAccount.findMany({ where: { tier: { not: 'NONE' } }, select: { id: true, sub: true, tier: true }, take: 1000, orderBy: { id: 'asc' } });
      for (const a of accs) {
        const count = await this.prisma.bookingIntent.count({ where: { sub: a.sub, dependantId: null, status: 'COMPLETED', terminalAt: { gte: windowStart(now, rules.windowMonths), lte: now } } });
        const t = tierFor(count, rules);
        if (t !== a.tier) { await this.prisma.loyaltyAccount.update({ where: { id: a.id }, data: { tier: t, tierSince: now } }); tiersChanged++; }
      }
    }
    if (pointsExpired || tiersChanged) this.log.log(`loyalty housekeeping: ${pointsExpired} points expired on ${accountsExpired} accounts, ${tiersChanged} tiers changed`);
    return { accountsExpired, pointsExpired, tiersChanged };
  }
}
