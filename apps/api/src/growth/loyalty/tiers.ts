import { TIER_KEYS, type LoyaltyRules, type Tier, type TierKey } from './loyalty-config';

/**
 * Tiers from completed-booking counts (P4-D). PURE. A tier is reached when the count of COMPLETED bookings of the person (their own, never a dependant's) inside the rolling window is at least
 * the tier's `minCompletedBookings`; a threshold of 0 means the tier is not defined, so with the shipped defaults nobody has a tier. The highest reached tier wins.
 */
export const TIER_RANK: Record<Tier, number> = { NONE: 0, SILVER: 1, GOLD: 2, PLATINUM: 3 };

export function tierFor(completedInWindow: number, rules: Pick<LoyaltyRules, 'tiers'>): Tier {
  let out: Tier = 'NONE';
  for (const k of TIER_KEYS) { const n = rules.tiers[k].minCompletedBookings; if (n > 0 && completedInWindow >= n) out = k; }
  return out;
}
/** The next defined tier above `tier` with its threshold, or null when none is defined above. */
export function nextTier(tier: Tier, rules: Pick<LoyaltyRules, 'tiers'>): { tier: TierKey; minCompletedBookings: number } | null {
  for (const k of TIER_KEYS) { const n = rules.tiers[k].minCompletedBookings; if (n > 0 && TIER_RANK[k] > TIER_RANK[tier]) return { tier: k, minCompletedBookings: n }; }
  return null;
}
export const bonusFor = (tier: Tier, rules: Pick<LoyaltyRules, 'tiers'>): number => (tier === 'NONE' ? 0 : rules.tiers[tier].bonusPoints);
/** Start of the rolling window (calendar months back from `now`, UTC). */
export function windowStart(now: Date, months: number): Date { const d = new Date(now.getTime()); d.setUTCMonth(d.getUTCMonth() - months); return d; }
