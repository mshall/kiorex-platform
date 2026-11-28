/**
 * Pure rules of the join-request routing (founder decision 28 Nov 2026): round-robin owner for new requests and the SLA clock of a request that is still NEW.
 * No I/O here: unit tested. Nothing in this file is a price, a fee or legal wording.
 */
import { zoneOffsetMinutes } from '../common/market-time';

/** Console roles that can own a join request: the Kiorex ops roles and the two Kiorly-only roles (ADR-062). */
export const ROUTING_ROLES: readonly string[] = ['ops_admin', 'super_admin', 'kiorly_ops', 'kiorly_admin'];

export interface RoutingConfig {
  roundRobin: {
    enabled: boolean;
    /** Empty = every active eligible console user. Otherwise only these subs (still must be active). */
    eligibleSubs: string[];
    /** A console user not seen for longer than this is inactive and is skipped. */
    activeWithinDays: number;
  };
  reminders: {
    enabled: boolean;
    /** The owner is reminded after this many WORKING hours without a human touch (default 4). */
    remindAfterWorkingHours: number;
    /** Super admins are told after this many working hours (default 8 = one working day of the calendar below). */
    escalateAfterWorkingHours: number;
  };
  workWeek: { days: number[]; startHour: number; endHour: number };
}

/** Defaults: Sunday to Thursday, 09:00 to 17:00 in the market time zone (Africa/Cairo by default; a weekend is Friday and Saturday). Editable by a super admin. */
export const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
  roundRobin: { enabled: true, eligibleSubs: [], activeWithinDays: 30 },
  reminders: { enabled: true, remindAfterWorkingHours: 4, escalateAfterWorkingHours: 8 },
  workWeek: { days: [0, 1, 2, 3, 4], startHour: 9, endHour: 17 },
};

export type RoutingValidation = { ok: true; config: RoutingConfig } | { ok: false; errors: Record<string, string> };

const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isNum = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

/** Strict validation of a saved document. Unknown keys are refused so that a typo cannot silently switch a rule off. */
export function validateRoutingConfig(raw: unknown): RoutingValidation {
  const errors: Record<string, string> = {};
  const o = (raw ?? {}) as Record<string, any>;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, errors: { config: 'not_an_object' } };
  for (const k of Object.keys(o)) if (!['roundRobin', 'reminders', 'workWeek'].includes(k)) errors[k] = 'unknown';
  const rr = o.roundRobin ?? {}; const rm = o.reminders ?? {}; const ww = o.workWeek ?? {};
  if (typeof rr.enabled !== 'boolean') errors['roundRobin.enabled'] = 'required';
  if (!Array.isArray(rr.eligibleSubs) || rr.eligibleSubs.length > 100 || rr.eligibleSubs.some((s: unknown) => typeof s !== 'string' || !/^[A-Za-z0-9_.:@-]{1,120}$/.test(s))) errors['roundRobin.eligibleSubs'] = 'invalid';
  if (!isInt(rr.activeWithinDays, 1, 365)) errors['roundRobin.activeWithinDays'] = 'invalid';
  if (typeof rm.enabled !== 'boolean') errors['reminders.enabled'] = 'required';
  if (!isNum(rm.remindAfterWorkingHours, 0.25, 200)) errors['reminders.remindAfterWorkingHours'] = 'invalid';
  if (!isNum(rm.escalateAfterWorkingHours, 0.25, 400)) errors['reminders.escalateAfterWorkingHours'] = 'invalid';
  if (isNum(rm.remindAfterWorkingHours, 0.25, 200) && isNum(rm.escalateAfterWorkingHours, 0.25, 400) && rm.escalateAfterWorkingHours < rm.remindAfterWorkingHours) errors['reminders.escalateAfterWorkingHours'] = 'before_reminder';
  if (!Array.isArray(ww.days) || ww.days.length < 1 || ww.days.length > 7 || ww.days.some((d: unknown) => !isInt(d, 0, 6)) || new Set(ww.days).size !== ww.days.length) errors['workWeek.days'] = 'invalid';
  if (!isInt(ww.startHour, 0, 23)) errors['workWeek.startHour'] = 'invalid';
  if (!isInt(ww.endHour, 1, 24)) errors['workWeek.endHour'] = 'invalid';
  if (isInt(ww.startHour, 0, 23) && isInt(ww.endHour, 1, 24) && ww.endHour <= ww.startHour) errors['workWeek.endHour'] = 'before_start';
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    config: {
      roundRobin: { enabled: rr.enabled, eligibleSubs: [...new Set<string>(rr.eligibleSubs)].sort(), activeWithinDays: rr.activeWithinDays },
      reminders: { enabled: rm.enabled, remindAfterWorkingHours: rm.remindAfterWorkingHours, escalateAfterWorkingHours: rm.escalateAfterWorkingHours },
      workWeek: { days: [...ww.days].sort((a: number, b: number) => a - b), startHour: ww.startHour, endHour: ww.endHour },
    },
  };
}

/**
 * Round-robin: the next eligible sub AFTER the one that had the previous turn, in a fixed (sorted) order, wrapping around. A sub that left the list does not break the
 * rotation: the next one in order after its position takes the turn. Empty list: null.
 */
export function nextInRotation(eligibleSubs: readonly string[], lastSub: string | null | undefined): string | null {
  const list = [...new Set(eligibleSubs)].sort();
  if (!list.length) return null;
  if (!lastSub) return list[0]!;
  return list.find((s) => s > lastSub) ?? list[0]!;
}

// ───────────────────────────── working time ─────────────────────────────

export interface Clock { zone: string; fallbackMinutes: number }
const DAY = 86_400_000;
const offsetAt = (clock: Clock, at: number) => zoneOffsetMinutes(clock.zone, at, clock.fallbackMinutes) * 60_000;

/** UTC instant of local wall-clock `hour` (0 to 24) on the local calendar day that starts at `dayStartUtcLocal` (a "local midnight" expressed as if it were UTC). DST aware. */
function localHourToUtc(clock: Clock, localMidnightAsUtc: number, hour: number): number {
  const wall = localMidnightAsUtc + hour * 3_600_000;
  let utc = wall - offsetAt(clock, wall);
  for (let i = 0; i < 2; i++) utc = wall - offsetAt(clock, utc);
  return utc;
}

/** Each working window [start, end) in UTC that intersects [from, to], day by day in the market zone. */
function windows(from: number, to: number, w: RoutingConfig['workWeek'], clock: Clock): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (to <= from) return out;
  const localFrom = from + offsetAt(clock, from);
  let day = Math.floor(localFrom / DAY) * DAY; // local midnight as if UTC
  for (let i = 0; i < 800; i++, day += DAY) {
    const s = localHourToUtc(clock, day, w.startHour); const e = localHourToUtc(clock, day, w.endHour);
    if (s >= to) break;
    const weekday = new Date(day).getUTCDay();
    if (!w.days.includes(weekday)) continue;
    if (e <= from) continue;
    out.push([Math.max(s, from), Math.min(e, to)]);
  }
  return out;
}

/** Working minutes between two instants (0 when `to` is not after `from`). */
export function workingMinutesBetween(from: Date | number, to: Date | number, w: RoutingConfig['workWeek'], clock: Clock): number {
  const f = +from; const t = +to;
  return Math.round(windows(f, t, w, clock).reduce((n, [a, b]) => n + (b - a), 0) / 60_000);
}

/** The instant at which `minutes` working minutes have passed since `from`. */
export function addWorkingMinutes(from: Date | number, minutes: number, w: RoutingConfig['workWeek'], clock: Clock): Date {
  let remaining = minutes * 60_000; const start = +from;
  const horizon = start + 800 * DAY;
  const localFrom = start + offsetAt(clock, start);
  let day = Math.floor(localFrom / DAY) * DAY;
  for (let i = 0; i < 800; i++, day += DAY) {
    if (!w.days.includes(new Date(day).getUTCDay())) continue;
    const s = Math.max(localHourToUtc(clock, day, w.startHour), start); const e = localHourToUtc(clock, day, w.endHour);
    if (e <= s) continue;
    if (e - s >= remaining) return new Date(s + remaining);
    remaining -= e - s;
  }
  return new Date(horizon);
}

export type SlaState = 'OK' | 'REMIND' | 'ESCALATED' | 'OFF';
export interface Sla { state: SlaState; since: Date; workingMinutes: number; remindAt: Date | null; escalateAt: Date | null }

/** The reminder clock of a request that is still NEW: starts at the last human touch (or at creation) and counts working time only. Any other status has no clock. */
export function slaOf(l: { status: string; createdAt: Date; lastTouchedAt: Date | null }, c: RoutingConfig, now: Date, clock: Clock): Sla {
  const since = l.lastTouchedAt && l.lastTouchedAt > l.createdAt ? l.lastTouchedAt : l.createdAt;
  if (l.status !== 'NEW' || !c.reminders.enabled) return { state: 'OFF', since, workingMinutes: 0, remindAt: null, escalateAt: null };
  const workingMinutes = workingMinutesBetween(since, now, c.workWeek, clock);
  const remindAt = addWorkingMinutes(since, c.reminders.remindAfterWorkingHours * 60, c.workWeek, clock);
  const escalateAt = addWorkingMinutes(since, c.reminders.escalateAfterWorkingHours * 60, c.workWeek, clock);
  const state: SlaState = workingMinutes >= c.reminders.escalateAfterWorkingHours * 60 ? 'ESCALATED' : workingMinutes >= c.reminders.remindAfterWorkingHours * 60 ? 'REMIND' : 'OK';
  return { state, since, workingMinutes, remindAt, escalateAt };
}
