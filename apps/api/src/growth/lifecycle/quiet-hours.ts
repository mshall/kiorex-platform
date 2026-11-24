import { quietUntil, type QuietHours } from '@kiorex/contracts/notify';

/** Policy quiet hours as LIFECYCLE_POLICY stores them ("21:00" to "09:00" in an IANA zone). */
export interface PolicyQuiet { start: string; end: string; timezone: string }
export const DEFAULT_QUIET: PolicyQuiet = { start: '21:00', end: '09:00', timezone: 'Africa/Cairo' };

const hourOf = (hhmm: string) => { const h = Number(hhmm.slice(0, 2)); return Number.isInteger(h) && h >= 0 && h <= 23 ? h : 0; };

/** A person's own window (whole local hours, NotificationPreference) overrides the policy window; the zone stays the policy zone. */
export function quietWindow(policy: PolicyQuiet = DEFAULT_QUIET, personal?: { start: number | null; end: number | null } | null): QuietHours {
  const own = personal && personal.start !== null && personal.end !== null ? personal : null;
  return { startHour: own ? own.start! : hourOf(policy.start), endHour: own ? own.end! : hourOf(policy.end), tzOffsetMinutes: 0, zone: policy.timezone };
}

/**
 * Epoch ms when the quiet window containing `at` ends (so the runner can reschedule), or null outside the window.
 * Uses `quietUntil(at, quiet, zone)` of contracts 1.12.0: the end is computed on the local calendar of the zone, so on the two nights a year Cairo changes its offset
 * the window ends at 09:00 local, not an hour early or late (item G-5 of the gap closure plan).
 */
export function quietEnd(at: number, q: QuietHours): number | null {
  return quietUntil(at, q, q.zone);
}
