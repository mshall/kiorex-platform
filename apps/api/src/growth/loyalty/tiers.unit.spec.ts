import { toLoyaltyRules } from './loyalty-config';
import { bonusFor, nextTier, tierFor, windowStart } from './tiers';

const R = toLoyaltyRules({ tiers: { SILVER: { minCompletedBookings: 3, bonusPoints: 50 }, GOLD: { minCompletedBookings: 6, bonusPoints: 100 }, PLATINUM: { minCompletedBookings: 12, bonusPoints: 250 } } });
describe('tiers from completed-booking counts (GRW-P4-D)', () => {
  it.each([[0, 'NONE'], [1, 'NONE'], [2, 'NONE'], [3, 'SILVER'], [5, 'SILVER'], [6, 'GOLD'], [11, 'GOLD'], [12, 'PLATINUM'], [500, 'PLATINUM']])('%i completed bookings -> %s', (n, t) => expect(tierFor(n, R)).toBe(t));
  it('with the shipped defaults (every threshold 0) nobody has a tier, however many bookings', () => { const d = toLoyaltyRules({}); for (const n of [0, 1, 3, 100, 1000]) expect(tierFor(n, d)).toBe('NONE'); expect(nextTier('NONE', d)).toBeNull(); });
  it('a tier that is not defined is skipped: only GOLD defined, three bookings give nothing, four give GOLD', () => { const g = toLoyaltyRules({ tiers: { GOLD: { minCompletedBookings: 4 } } }); expect(tierFor(3, g)).toBe('NONE'); expect(tierFor(4, g)).toBe('GOLD'); expect(nextTier('NONE', g)).toEqual({ tier: 'GOLD', minCompletedBookings: 4 }); });
  it('next tier and progress', () => { expect(nextTier('NONE', R)).toEqual({ tier: 'SILVER', minCompletedBookings: 3 }); expect(nextTier('SILVER', R)).toEqual({ tier: 'GOLD', minCompletedBookings: 6 }); expect(nextTier('PLATINUM', R)).toBeNull(); });
  it('bonus per tier; none for NONE', () => { expect(bonusFor('NONE', R)).toBe(0); expect(bonusFor('GOLD', R)).toBe(100); });
  it('the window start is calendar months back in UTC', () => { expect(windowStart(new Date('2027-03-31T10:00:00Z'), 12).toISOString().slice(0, 10)).toBe('2026-03-31'); expect(windowStart(new Date('2027-01-15T00:00:00Z'), 12).toISOString().slice(0, 10)).toBe('2026-01-15'); });
});
