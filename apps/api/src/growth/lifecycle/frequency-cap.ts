import { createHmac } from 'node:crypto';

/** Frequency caps and holdout (GRW-P2-E). PURE. Only MARKETING counts; all channels share one count (one logical send fans out to several channels). */
export interface Caps { perDay: number; perWeek: number }
export const DAY_MS = 86_400_000;

export function capCounts(sentAt: readonly Date[], now: number): { day: number; week: number } {
  let day = 0; let week = 0;
  for (const d of sentAt) { const age = now - d.getTime(); if (age < 0) continue; if (age < DAY_MS) day++; if (age < 7 * DAY_MS) week++; }
  return { day, week };
}

/** The stricter of two cap sets (the lifecycle policy and the preference centre defaults), never the looser. */
export const stricterCaps = (a: Caps, b: Caps): Caps => ({ perDay: Math.min(a.perDay, b.perDay), perWeek: Math.min(a.perWeek, b.perWeek) });

/** Re-engagement budget: at most `max` sends per rolling `windowDays` (default 2 per 90 days). */
export const withinWindowBudget = (sentAt: readonly Date[], now: number, max: number, windowDays: number) => sentAt.filter((d) => now - d.getTime() >= 0 && now - d.getTime() < windowDays * DAY_MS).length < max;

/**
 * Deterministic holdout slice: bucket = uint32(HMAC-SHA256(salt, `${journeyKey}:${sub}`)) mod 10000 < holdoutBps. The same person stays in or out for a journey, on every
 * instance and every run. 0 = nobody held out.
 */
export function inHoldout(sub: string, journeyKey: string, holdoutBps: number, salt = 'kx-lifecycle-holdout'): boolean {
  if (!(holdoutBps > 0)) return false;
  const h = createHmac('sha256', salt).update(`${journeyKey}:${sub}`).digest();
  return h.readUInt32BE(0) % 10_000 < Math.min(holdoutBps, 10_000);
}
