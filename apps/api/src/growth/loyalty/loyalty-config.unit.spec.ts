import { LOYALTY_RULES_DEFAULT, LOYALTY_RULES_SCHEMA, TIER_KEYS, toLoyaltyRules, validateLoyaltyRules } from './loyalty-config';
import { GROWTH_DEFAULT_PAYLOADS } from '../config/growth-defaults';
import { LOCAL_CONFIG_KINDS, validateGrowthConfig } from '../config/growth-config.service';

describe('LOYALTY_RULES (GRW-P4-D)', () => {
  it('every amount and every tier threshold defaults to 0, and the shipped defaults are valid', () => {
    const d = LOYALTY_RULES_DEFAULT();
    expect(d.pointsPerCompletedBooking).toBe(0); expect(d.annualCapPoints).toBe(0);
    for (const t of TIER_KEYS) expect(d.tiers[t]).toEqual({ minCompletedBookings: 0, bonusPoints: 0 });
    expect(d.conversion).toEqual({ pointsRequired: 0, valueMinor: 0, maxBlocksPerYear: 0 });
    expect(validateLoyaltyRules(d).errors).toEqual([]);
    expect(GROWTH_DEFAULT_PAYLOADS.LOYALTY_RULES).toEqual(d);
  });
  it('is a local, announced, maker-checker kind that the config service validates', () => {
    expect(LOCAL_CONFIG_KINDS).toContain('LOYALTY_RULES');
    expect(validateGrowthConfig('LOYALTY_RULES', { pointsPerCompletedBooking: 10 }).valid).toBe(true);
    expect(validateGrowthConfig('LOYALTY_RULES', { cashOut: true }).valid).toBe(false);
  });
  it.each([
    [{ surprise: 1 }, 'not a known key'], [{ cashOut: true }, 'not a known key'], [{ topUp: 5 }, 'not a known key'], [{ transfer: true }, 'not a known key'], [{ pointsPerCompletedBooking: -1 }, 'integer'], [{ pointsPerCompletedBooking: 1.5 }, 'integer'],
    [{ windowMonths: 0 }, '1 to 24'], [{ expiryMonths: 37 }, '1 to 36'], [{ annualCapPoints: 1_000_001 }, 'integer'], [{ tiers: { DIAMOND: {} } }, 'not a known tier'], [{ tiers: { GOLD: { minCompletedBookings: 1001 } } }, '0 to 1000'],
    [{ tiers: { GOLD: { cash: 1 } } }, 'not a known key'], [{ conversion: { cashValue: 1 } }, 'not a known key'], [{ conversion: { valueMinor: 0.5 } }, 'integer'], [{ conversion: { maxBlocksPerYear: 101 } }, '0 to 100'], ['x', 'object'],
  ])('rejects %j', (payload, why) => { const e = validateLoyaltyRules(payload).errors; expect(e.length).toBeGreaterThan(0); expect(e.join(' ')).toContain(why); });
  it('defined tier thresholds must rise; an undefined tier (0) is skipped in the order check', () => {
    expect(validateLoyaltyRules({ tiers: { SILVER: { minCompletedBookings: 3 }, GOLD: { minCompletedBookings: 6 }, PLATINUM: { minCompletedBookings: 12 } } }).errors).toEqual([]);
    expect(validateLoyaltyRules({ tiers: { SILVER: { minCompletedBookings: 5 }, GOLD: { minCompletedBookings: 5 } } }).errors.join()).toContain('must be higher');
    expect(validateLoyaltyRules({ tiers: { SILVER: { minCompletedBookings: 5 }, PLATINUM: { minCompletedBookings: 4 } } }).errors.join()).toContain('must be higher');
    expect(validateLoyaltyRules({ tiers: { GOLD: { minCompletedBookings: 4 } } }).errors).toEqual([]);
  });
  it('missing keys fall back to the closed defaults, never to something more permissive', () => {
    const r = toLoyaltyRules({ conversion: { valueMinor: 5000 }, tiers: { GOLD: { minCompletedBookings: 4 } } });
    expect(r.conversion).toEqual({ pointsRequired: 0, valueMinor: 5000, maxBlocksPerYear: 0 }); expect(r.tiers.SILVER.minCompletedBookings).toBe(0); expect(r.tiers.GOLD).toEqual({ minCompletedBookings: 4, bonusPoints: 0 }); expect(toLoyaltyRules(null)).toEqual(LOYALTY_RULES_DEFAULT());
  });
  it('the console schema and the validator know the same keys', () => {
    expect(Object.keys(LOYALTY_RULES_SCHEMA.properties).sort()).toEqual(['annualCapPoints', 'conversion', 'enabled', 'expiryMonths', 'pointsPerCompletedBooking', 'tiers', 'windowMonths']);
    expect(Object.keys(LOYALTY_RULES_SCHEMA.properties.conversion.properties).sort()).toEqual(['maxBlocksPerYear', 'pointsRequired', 'valueMinor']);
    expect(Object.keys(LOYALTY_RULES_SCHEMA.properties.tiers.properties)).toEqual([...TIER_KEYS]);
  });
});
