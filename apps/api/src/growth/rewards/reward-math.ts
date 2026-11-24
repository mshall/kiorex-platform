import { createHash } from 'node:crypto';

/**
 * Pure arithmetic of the patient reward ledger (GRW-P2-B2). No I/O. Every number here is reproduced by the shared vectors
 * (`@kiorex/contracts` fixtures/credit-ledger-vectors.json) in reward-math.unit.spec.ts, so the patient ledger and the provider wallet agree on first-expiring-first,
 * expiry and reversal arithmetic without sharing code (ADR-048: two separate credit systems).
 */

export interface FifoLot { id: string; remainingMinor: number; expiresAt: Date | string; scoped?: boolean }
export interface FifoPick { lotId: string; minor: number }

const ms = (d: Date | string) => (d instanceof Date ? d : new Date(d)).getTime();

/**
 * Order of use: scoped lots first (a scoped campaign credit is spent where it applies before an unscoped one), then first expiring, then lot id (stable). Expired lots are skipped.
 * Returns the picks that add up to `consumeMinor`, or null when the usable lots hold less (never a partial answer).
 */
export function consumeFifo(lots: readonly FifoLot[], consumeMinor: number, now: Date | string = new Date()): FifoPick[] | null {
  if (!Number.isInteger(consumeMinor) || consumeMinor < 0) throw new RangeError('consumeMinor must be a non-negative integer');
  const t = ms(now);
  const usable = lots.filter((l) => l.remainingMinor > 0 && ms(l.expiresAt) > t)
    .sort((a, b) => Number(!!b.scoped) - Number(!!a.scoped) || ms(a.expiresAt) - ms(b.expiresAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let left = consumeMinor; const out: FifoPick[] = [];
  for (const l of usable) {
    if (left === 0) break;
    const take = Math.min(left, l.remainingMinor);
    out.push({ lotId: l.id, minor: take }); left -= take;
  }
  return left === 0 ? out : null;
}
export const availableOf = (lots: readonly FifoLot[], now: Date | string = new Date()) => lots.filter((l) => ms(l.expiresAt) > ms(now)).reduce((s, l) => s + Math.max(0, l.remainingMinor), 0);

/** What the expiry job writes for one lot at `at`: the unspent, unreserved remainder (an open reservation stays reserved until its payment resolves). */
export function expireAmount(i: { issuedMinor: number; redeemedMinor: number; reservedMinor?: number; expiresAt: Date | string; at: Date | string }): number {
  if (ms(i.at) < ms(i.expiresAt)) return 0;
  return Math.max(0, i.issuedMinor - i.redeemedMinor - (i.reservedMinor ?? 0));
}

/** Reversal of a lot after its qualifying booking was refunded: the unredeemed part is reversed, the redeemed part is a recoverable loss. */
export function reversalSplit(i: { issuedMinor: number; redeemedMinor: number }): { reverseMinor: number; recoverableLossMinor: number } {
  const redeemed = Math.min(Math.max(0, i.redeemedMinor), i.issuedMinor);
  return { reverseMinor: i.issuedMinor - redeemed, recoverableLossMinor: redeemed };
}

/** Largest amount credit may pay on one amount: min(available, share of the amount, amount minus the card minimum). Never below zero. */
export function maxRedeemable(i: { availableMinor: number; amountMinor: number; redemptionMaxBp: number; minPayableMinor: number }): number {
  const share = Math.floor((i.amountMinor * Math.min(Math.max(i.redemptionMaxBp, 0), 10_000)) / 10_000);
  // the card always keeps at least one minor unit: the PSP path never sees a zero charge
  const room = i.amountMinor - Math.max(i.minPayableMinor, 1);
  return Math.max(0, Math.min(i.availableMinor, share, room));
}

/**
 * Idempotency key of one ledger entry. The database pattern is `rwd:<type>:<opaque>` with the opaque part 1 to 64 of A-Za-z0-9_- (contracts REWARD_IDEMPOTENCY_KEY_PATTERN):
 * the parts are hashed, so the same operation always maps to the same key and any two different operations to different keys.
 */
export function entryKey(type: string, ...parts: Array<string | number>): string {
  const t = type.toLowerCase();
  if (!/^[a-z0-9_-]{1,40}$/.test(t)) throw new TypeError(`entryKey: bad type ${type}`);
  const h = createHash('sha256').update(parts.join('|'), 'utf8').digest('base64url').slice(0, 43);
  return `rwd:${t}:${h}`;
}

/** Annual window used by the per-user cap: a rolling 365 days ending at `now`. */
export const yearStart = (now: Date) => new Date(now.getTime() - 365 * 86_400_000);
export const addMonths = (d: Date, months: number): Date => { const x = new Date(d.getTime()); x.setUTCMonth(x.getUTCMonth() + months); return x; };
