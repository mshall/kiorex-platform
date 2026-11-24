import { growthCanonicalJson } from '@kiorex/contracts';
import { sha256Hex } from '../growth-secrets';

/** The money-relevant payload of a campaign: what an approval covers. Name, UTM content and creatives are not in it, so editing them never invalidates an approval. */
export interface MoneyPayload { budgetTotalMinor: number; budgetDailyMinor: number; currency: string; channels: readonly string[]; startsAt: Date | string | null; endsAt: Date | string | null; eligibility: unknown }
export const moneyPayload = (c: MoneyPayload) => ({
  budgetTotalMinor: c.budgetTotalMinor, budgetDailyMinor: c.budgetDailyMinor, currency: c.currency, channels: [...c.channels].sort(),
  startsAt: c.startsAt ? new Date(c.startsAt).toISOString() : null, endsAt: c.endsAt ? new Date(c.endsAt).toISOString() : null, eligibility: c.eligibility ?? {},
});
export const moneyHash = (c: MoneyPayload) => sha256Hex(growthCanonicalJson(moneyPayload(c)));
