/**
 * Patient lifecycle stages (GRW-P2-E). NON-CLINICAL by construction: derived only from registration, booking and attendance timestamps and counts, never from
 * what the visit was for. PURE (no clock, no database): the caller passes `now`.
 */
export const LIFECYCLE_STAGES = ['REGISTERED', 'ACTIVATED', 'BOOKED', 'ATTENDED', 'RETAINED', 'DORMANT', 'CHURNED'] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

export interface StageThresholds { dormantDays: number; churnedDays: number; retainedAttendedMin: number; retainedWindowDays: number }
/** PROPOSED_DEFAULT (KX-27): dormant at 180 days without a booking, churned at 365, retained = 2 or more attended visits in 12 months. Policy may override. */
export const DEFAULT_STAGE_THRESHOLDS: StageThresholds = { dormantDays: 180, churnedDays: 365, retainedAttendedMin: 2, retainedWindowDays: 365 };

export interface StageFacts {
  registeredAt: Date;
  /** Latest booking intent the person started (held, pending, confirmed or later). */
  lastBookingAt: Date | null;
  lastAttendedAt: Date | null;
  /** Bookings started at all (an intent that never confirmed still counts as ACTIVATED). */
  intentCount: number;
  /** Bookings that reached the clinic (confirmed or later, even if cancelled later: the booking existed). */
  bookedCount: number;
  /** Attended visits inside the retained window. */
  attendedInWindow: number;
  attendedTotal: number;
  /** A confirmed future booking exists: the person is not dormant while one is on the calendar. */
  hasUpcoming: boolean;
}

const DAY = 86_400_000;
export const daysBetween = (from: Date, to: Date) => Math.floor((to.getTime() - from.getTime()) / DAY);

export function deriveStage(f: StageFacts, now: Date, t: StageThresholds = DEFAULT_STAGE_THRESHOLDS): LifecycleStage {
  const lastActivity = [f.lastBookingAt, f.lastAttendedAt, f.registeredAt].filter((d): d is Date => !!d).reduce((a, b) => (a.getTime() >= b.getTime() ? a : b));
  const idle = daysBetween(lastActivity, now);
  if (!f.hasUpcoming) {
    if (idle >= t.churnedDays) return 'CHURNED';
    if (idle >= t.dormantDays) return 'DORMANT';
  }
  if (f.attendedInWindow >= t.retainedAttendedMin) return 'RETAINED';
  if (f.attendedTotal >= 1) return 'ATTENDED';
  if (f.bookedCount >= 1) return 'BOOKED';
  if (f.intentCount >= 1) return 'ACTIVATED';
  return 'REGISTERED';
}

/** Stage order for funnel views (a person can move back to DORMANT and forward again; this is only for presentation). */
export const stageRank = (s: LifecycleStage) => LIFECYCLE_STAGES.indexOf(s);

export interface StageChange { from: LifecycleStage | null; to: LifecycleStage; changed: boolean }
export const stageChange = (from: LifecycleStage | null, to: LifecycleStage): StageChange => ({ from, to, changed: from !== to });
