/**
 * `LOYALTY_RULES` growth configuration (work package P4-D; maker-checker through the config console; a local kind until the contracts set that carries it is vendored: same pattern as LTV_POLICY).
 * Every amount and every tier threshold defaults to 0 and **0 means off**: a tier with `minCompletedBookings` 0 is not defined (nobody reaches it), `pointsRequired` 0 or `valueMinor` 0 or
 * `maxBlocksPerYear` 0 closes conversion, `annualCapPoints` 0 refuses accrual. So the shipped defaults accrue nothing, grant nothing and convert nothing until the founder sets numbers (NEEDS_HUMAN, counsel NH 11 and 18 and finance).
 * There is no key for cash, top-up, transfer, gift or withdrawal: points are not money.
 */
export const TIER_KEYS = ['SILVER', 'GOLD', 'PLATINUM'] as const;
export type TierKey = (typeof TIER_KEYS)[number];
export type Tier = 'NONE' | TierKey;
export interface TierRule { minCompletedBookings: number; bonusPoints: number }
export interface LoyaltyRules {
  enabled: boolean;
  pointsPerCompletedBooking: number;
  windowMonths: number;
  expiryMonths: number;
  annualCapPoints: number;
  tiers: Record<TierKey, TierRule>;
  conversion: { pointsRequired: number; valueMinor: number; maxBlocksPerYear: number };
}
export const LOYALTY_RULES_DEFAULT = (): LoyaltyRules => ({
  enabled: true, pointsPerCompletedBooking: 0, windowMonths: 12, expiryMonths: 12, annualCapPoints: 0,
  tiers: { SILVER: { minCompletedBookings: 0, bonusPoints: 0 }, GOLD: { minCompletedBookings: 0, bonusPoints: 0 }, PLATINUM: { minCompletedBookings: 0, bonusPoints: 0 } },
  conversion: { pointsRequired: 0, valueMinor: 0, maxBlocksPerYear: 0 },
});

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const int = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const TOP = ['enabled', 'pointsPerCompletedBooking', 'windowMonths', 'expiryMonths', 'annualCapPoints', 'tiers', 'conversion'];

/** Same contract as `LOYALTY_RULES.schema.json` of the unreleased contracts set (unknown keys rejected, every number bounded), plus one rule JSON Schema cannot say: defined tier thresholds must rise (SILVER < GOLD < PLATINUM). */
export function validateLoyaltyRules(payload: unknown): { errors: string[] } {
  const errors: string[] = [];
  if (!isObj(payload)) return { errors: ['/ must be an object'] };
  for (const k of Object.keys(payload)) if (!TOP.includes(k)) errors.push(`/${k} is not a known key`);
  if ('enabled' in payload && typeof payload.enabled !== 'boolean') errors.push('/enabled must be a boolean');
  if ('pointsPerCompletedBooking' in payload && !int(payload.pointsPerCompletedBooking, 0, 10_000)) errors.push('/pointsPerCompletedBooking must be an integer 0 to 10000');
  if ('windowMonths' in payload && !int(payload.windowMonths, 1, 24)) errors.push('/windowMonths must be an integer 1 to 24');
  if ('expiryMonths' in payload && !int(payload.expiryMonths, 1, 36)) errors.push('/expiryMonths must be an integer 1 to 36');
  if ('annualCapPoints' in payload && !int(payload.annualCapPoints, 0, 1_000_000)) errors.push('/annualCapPoints must be an integer 0 to 1000000');
  if ('tiers' in payload) {
    if (!isObj(payload.tiers)) errors.push('/tiers must be an object');
    else for (const [t, v] of Object.entries(payload.tiers)) {
      if (!(TIER_KEYS as readonly string[]).includes(t)) { errors.push(`/tiers/${t} is not a known tier`); continue; }
      if (!isObj(v)) { errors.push(`/tiers/${t} must be an object`); continue; }
      for (const [k, x] of Object.entries(v)) {
        if (k === 'minCompletedBookings') { if (!int(x, 0, 1000)) errors.push(`/tiers/${t}/minCompletedBookings must be an integer 0 to 1000`); }
        else if (k === 'bonusPoints') { if (!int(x, 0, 100_000)) errors.push(`/tiers/${t}/bonusPoints must be an integer 0 to 100000`); }
        else errors.push(`/tiers/${t}/${k} is not a known key`);
      }
    }
  }
  if ('conversion' in payload) {
    if (!isObj(payload.conversion)) errors.push('/conversion must be an object');
    else for (const [k, x] of Object.entries(payload.conversion)) {
      if (k === 'pointsRequired') { if (!int(x, 0, 1_000_000)) errors.push('/conversion/pointsRequired must be an integer 0 to 1000000'); }
      else if (k === 'valueMinor') { if (!int(x, 0, 2_000_000_000)) errors.push('/conversion/valueMinor must be an integer 0 to 2000000000'); }
      else if (k === 'maxBlocksPerYear') { if (!int(x, 0, 100)) errors.push('/conversion/maxBlocksPerYear must be an integer 0 to 100'); }
      else errors.push(`/conversion/${k} is not a known key`);
    }
  }
  if (!errors.length) {
    const merged = toLoyaltyRules(payload);
    const defined = TIER_KEYS.map((k) => ({ k, n: merged.tiers[k].minCompletedBookings })).filter((x) => x.n > 0);
    for (let i = 1; i < defined.length; i++) if (defined[i].n <= defined[i - 1].n) errors.push(`/tiers/${defined[i].k}/minCompletedBookings must be higher than ${defined[i - 1].k}`);
  }
  return { errors };
}

/** Missing keys fall back to the closed defaults, never to something more permissive. */
export function toLoyaltyRules(payload: unknown): LoyaltyRules {
  const d = LOYALTY_RULES_DEFAULT(); const p = (isObj(payload) ? payload : {}) as Partial<LoyaltyRules>;
  const tiers = { ...d.tiers };
  for (const t of TIER_KEYS) tiers[t] = { ...d.tiers[t], ...((p.tiers as Partial<Record<TierKey, TierRule>> | undefined)?.[t] ?? {}) };
  return { ...d, ...p, tiers, conversion: { ...d.conversion, ...(p.conversion ?? {}) } };
}

const tierSchema = { type: 'object', additionalProperties: false, properties: { minCompletedBookings: { type: 'integer', minimum: 0, maximum: 1000, description: 'Completed bookings in the window needed to reach the tier. 0 = the tier is not defined.' }, bonusPoints: { type: 'integer', minimum: 0, maximum: 100000, description: 'Points granted once per rolling year when the tier is first reached.' } } } as const;
/** JSON Schema shown by the config console (mirrors the contracts schema; the unit test keeps the two in step). */
export const LOYALTY_RULES_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'Growth config: LOYALTY_RULES', type: 'object', additionalProperties: false,
  properties: {
    enabled: { type: 'boolean', description: 'Master switch of the rule set (the launch-locked flag growth.loyalty still decides whether anything runs).' },
    pointsPerCompletedBooking: { type: 'integer', minimum: 0, maximum: 10000, description: 'Points added when a booking reaches COMPLETED. 0 = no accrual.' },
    windowMonths: { type: 'integer', minimum: 1, maximum: 24, description: 'Rolling window over which completed bookings count towards a tier. PROPOSED_DEFAULT 12.' },
    expiryMonths: { type: 'integer', minimum: 1, maximum: 36, description: 'Months a point lives (oldest first). PROPOSED_DEFAULT 12.' },
    annualCapPoints: { type: 'integer', minimum: 0, maximum: 1000000, description: 'Most points one person can earn in a rolling 365 days. 0 refuses accrual.' },
    tiers: { type: 'object', additionalProperties: false, properties: { SILVER: tierSchema, GOLD: tierSchema, PLATINUM: tierSchema } },
    conversion: { type: 'object', additionalProperties: false, properties: {
      pointsRequired: { type: 'integer', minimum: 0, maximum: 1000000, description: 'Points spent for one conversion block. 0 closes conversion.' },
      valueMinor: { type: 'integer', minimum: 0, maximum: 2000000000, description: 'Minor units of the reward lot one block becomes (a promotional lot, never cash). 0 closes conversion.' },
      maxBlocksPerYear: { type: 'integer', minimum: 0, maximum: 100, description: 'Blocks one person can convert in a rolling 365 days. 0 closes conversion.' },
    } },
  },
} as const;
