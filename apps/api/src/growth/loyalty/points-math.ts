/**
 * Points arithmetic of the loyalty ledger (P4-D). PURE: one source for the vectors the database function `loyalty_expirable_points` is tested against.
 * A lot-by-lot replay in time order: a credit (ACCRUE, TIER_BONUS) opens a lot with its expiry; a spend (CONVERT, REVERSE) takes from the oldest lot that still has points (FIFO; with a constant expiry period that is also the soonest to expire);
 * an EXPIRE entry closes every lot that had expired by the time it was written; what is left in lots expired at or before `now` is expirable. The service always expires an account before it accrues, converts or reads a balance.
 */
export interface PointsEntry { type: 'ACCRUE' | 'TIER_BONUS' | 'EXPIRE' | 'REVERSE' | 'CONVERT'; points: number; expiresAt?: Date | null; createdAt: Date; id?: string }
export const isCredit = (t: PointsEntry['type']) => t === 'ACCRUE' || t === 'TIER_BONUS';
export const signed = (e: Pick<PointsEntry, 'type' | 'points'>) => (isCredit(e.type) ? e.points : -e.points);
export const balanceOf = (entries: readonly PointsEntry[]) => entries.reduce((n, e) => n + signed(e), 0);

export function expirablePoints(entries: readonly PointsEntry[], now: Date): number {
  const rank = (t: PointsEntry['type']) => (t === 'EXPIRE' ? 0 : isCredit(t) ? 1 : 2); // at the same instant: expiries first, then credits, then spends (the service writes them in that order)
  const ordered = [...entries].sort((a, b) => (a.createdAt.getTime() - b.createdAt.getTime()) || (rank(a.type) - rank(b.type)) || String(a.id ?? '').localeCompare(String(b.id ?? '')));
  const lots: Array<{ left: number; exp: number }> = [];
  for (const e of ordered) {
    if (isCredit(e.type)) lots.push({ left: e.points, exp: e.expiresAt!.getTime() });
    else if (e.type === 'CONVERT' || e.type === 'REVERSE') { let need = e.points; for (const l of lots) { if (need <= 0) break; const k = Math.min(l.left, need); l.left -= k; need -= k; } }
    else for (const l of lots) if (l.exp <= e.createdAt.getTime()) l.left = 0;
  }
  return lots.filter((l) => l.exp <= now.getTime()).reduce((n, l) => n + l.left, 0);
}
/** The soonest point of value that will expire and how many points expire by then (for "expires soon" on the screen). */
export function nextExpiry(entries: readonly PointsEntry[], now: Date): { at: Date; points: number } | null {
  const credits = entries.filter((e) => isCredit(e.type) && e.expiresAt!.getTime() > now.getTime()).sort((a, b) => a.expiresAt!.getTime() - b.expiresAt!.getTime());
  if (!credits.length) return null;
  const at = credits[0].expiresAt!; const horizon = expirablePoints(entries, new Date(at.getTime()));
  return horizon > 0 ? { at, points: horizon } : null;
}
export const addMonthsUtc = (d: Date, months: number): Date => { const x = new Date(d.getTime()); x.setUTCMonth(x.getUTCMonth() + months); return x; };
export const dayMs = 86_400_000;
