import type { PrismaService } from '../../prisma/prisma.service';

/** BookingEvent kind that stores the Clinic's visit times (contracts 1.13.0: optional `checkedInAt` on CHECKED_IN and COMPLETED, `completedAt` on COMPLETED). Times only, no person, no content. */
export const VISIT_TIMES_KIND = 'VISIT_TIMES';
const DAY_MIN = 24 * 60;

const asDate = (v: unknown): Date | null => { if (typeof v !== 'string') return null; const t = Date.parse(v); return Number.isNaN(t) ? null : new Date(t); };

/** Whole minutes between check-in and completion; undefined when either time is missing, malformed, out of order or implausible (over 24 hours: a forgotten check-out is not a visit length). */
export function visitMinutesBetween(checkedInAt: unknown, completedAt: unknown): number | undefined {
  const a = asDate(checkedInAt); const b = asDate(completedAt);
  if (!a || !b) return undefined;
  const m = Math.floor((b.getTime() - a.getTime()) / 60_000);
  return m < 0 || m > DAY_MIN ? undefined : m;
}

/** The detail to store for a CHECKED_IN or COMPLETED event, or null when it carries no usable time. */
export function visitTimesDetail(type: string, data: Record<string, unknown>): { checkedInAt?: string; completedAt?: string } | null {
  const out: { checkedInAt?: string; completedAt?: string } = {};
  const ci = asDate(data.checkedInAt); const co = type === 'COMPLETED' ? asDate(data.completedAt) : null;
  if (ci) out.checkedInAt = ci.toISOString();
  if (co) out.completedAt = co.toISOString();
  return out.checkedInAt || out.completedAt ? out : null;
}

/** Visit minutes of a booking from the stored times (latest check-in time and latest completion time), undefined while the Clinic has not sent both. */
export async function visitMinutesOf(prisma: Pick<PrismaService, 'bookingEvent'>, bookingId: string): Promise<number | undefined> {
  const rows = await prisma.bookingEvent.findMany({ where: { bookingId, kind: VISIT_TIMES_KIND }, orderBy: { createdAt: 'desc' }, take: 10, select: { detail: true } });
  let ci: unknown; let co: unknown;
  for (const r of rows) { const d = (r.detail ?? {}) as Record<string, unknown>; ci ??= d.checkedInAt; co ??= d.completedAt; }
  return visitMinutesBetween(ci, co);
}

/**
 * Did the visit get past check-in? Unchanged rule of the referral engine: a STATE transition to CHECKED_IN or COMPLETED (so a completion counts as a check-in; making it stricter would flag every clinic that
 * completes straight from CONFIRMED, and is left to the fraud owner), or a check-in time the Clinic sent.
 */
export async function hadCheckIn(prisma: Pick<PrismaService, 'bookingEvent'>, bookingId: string): Promise<boolean> {
  if (await prisma.bookingEvent.findFirst({ where: { bookingId, kind: 'STATE', toStatus: { in: ['CHECKED_IN', 'COMPLETED'] } }, select: { id: true } })) return true;
  const rows = await prisma.bookingEvent.findMany({ where: { bookingId, kind: VISIT_TIMES_KIND }, take: 10, select: { detail: true } });
  return rows.some((r) => !!asDate(((r.detail ?? {}) as Record<string, unknown>).checkedInAt));
}
