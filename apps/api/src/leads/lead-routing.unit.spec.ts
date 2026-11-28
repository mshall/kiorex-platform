import { DEFAULT_ROUTING_CONFIG, addWorkingMinutes, nextInRotation, slaOf, validateRoutingConfig, workingMinutesBetween } from './lead-routing';

const cairo = { zone: 'Africa/Cairo', fallbackMinutes: 120 };
const W = DEFAULT_ROUTING_CONFIG.workWeek; // Sun-Thu 09:00-17:00
const at = (iso: string) => new Date(iso); // Cairo is UTC+2 in January 2027 (no DST)

describe('nextInRotation', () => {
  it('rotates in sorted order and wraps', () => {
    const subs = ['c', 'a', 'b'];
    expect(nextInRotation(subs, null)).toBe('a');
    expect(nextInRotation(subs, 'a')).toBe('b');
    expect(nextInRotation(subs, 'b')).toBe('c');
    expect(nextInRotation(subs, 'c')).toBe('a');
  });
  it('survives a last owner who left the list, and an empty list', () => {
    expect(nextInRotation(['a', 'd'], 'b')).toBe('d');
    expect(nextInRotation(['a', 'd'], 'z')).toBe('a');
    expect(nextInRotation([], 'a')).toBeNull();
    expect(nextInRotation(['a', 'a'], 'a')).toBe('a');
  });
  it('is fair: 3 users, 9 turns, 3 each', () => {
    let last: string | null = null; const n: Record<string, number> = {};
    for (let i = 0; i < 9; i++) { last = nextInRotation(['u3', 'u1', 'u2'], last); n[last!] = (n[last!] ?? 0) + 1; }
    expect(n).toEqual({ u1: 3, u2: 3, u3: 3 });
  });
});

describe('working time (Sun-Thu 09:00-17:00 Cairo)', () => {
  it('counts only working hours inside a day', () => {
    // Sunday 10 Jan 2027 10:00 Cairo = 08:00Z -> 14:00 Cairo = 12:00Z
    expect(workingMinutesBetween(at('2027-01-10T08:00:00Z'), at('2027-01-10T12:00:00Z'), W, cairo)).toBe(240);
    // before opening and after closing do not count
    expect(workingMinutesBetween(at('2027-01-10T03:00:00Z'), at('2027-01-10T20:00:00Z'), W, cairo)).toBe(480);
  });
  it('skips the weekend (Friday and Saturday) and the night', () => {
    // Thursday 14 Jan 16:00 Cairo (14:00Z) -> Sunday 17 Jan 10:00 Cairo (08:00Z): 1h Thursday + 1h Sunday
    expect(workingMinutesBetween(at('2027-01-14T14:00:00Z'), at('2027-01-17T08:00:00Z'), W, cairo)).toBe(120);
    // all of Friday and Saturday
    expect(workingMinutesBetween(at('2027-01-15T00:00:00Z'), at('2027-01-16T23:00:00Z'), W, cairo)).toBe(0);
  });
  it('adds working minutes across the weekend', () => {
    // Thursday 16:00 Cairo + 4 working hours = Thursday 1h, then Sunday 09:00 + 3h = 12:00 Cairo = 10:00Z
    expect(addWorkingMinutes(at('2027-01-14T14:00:00Z'), 240, W, cairo).toISOString()).toBe('2027-01-17T10:00:00.000Z');
    // submitted Saturday: the clock starts Sunday 09:00 Cairo (07:00Z)
    expect(addWorkingMinutes(at('2027-01-16T10:00:00Z'), 60, W, cairo).toISOString()).toBe('2027-01-17T08:00:00.000Z');
  });
  it('follows the Cairo daylight saving offset (UTC+3 in July)', () => {
    // Sunday 4 Jul 2027 09:00 Cairo = 06:00Z, 4 working hours later = 13:00 Cairo = 10:00Z
    expect(addWorkingMinutes(at('2027-07-04T06:00:00Z'), 240, W, cairo).toISOString()).toBe('2027-07-04T10:00:00.000Z');
    expect(workingMinutesBetween(at('2027-07-04T06:00:00Z'), at('2027-07-04T10:00:00Z'), W, cairo)).toBe(240);
  });
});

describe('slaOf', () => {
  const c = DEFAULT_ROUTING_CONFIG; const created = at('2027-01-10T07:00:00Z'); // Sunday 09:00 Cairo
  const base = { status: 'NEW', createdAt: created, lastTouchedAt: null as Date | null };
  it('OK before 4 working hours, REMIND after 4, ESCALATED after 8', () => {
    expect(slaOf(base, c, at('2027-01-10T10:59:00Z'), cairo).state).toBe('OK');
    expect(slaOf(base, c, at('2027-01-10T11:00:00Z'), cairo).state).toBe('REMIND');
    expect(slaOf(base, c, at('2027-01-10T14:59:00Z'), cairo).state).toBe('REMIND');
    expect(slaOf(base, c, at('2027-01-10T15:00:00Z'), cairo).state).toBe('ESCALATED');
  });
  it('a lead created on Friday is not late on Saturday', () => {
    expect(slaOf({ ...base, createdAt: at('2027-01-15T08:00:00Z') }, c, at('2027-01-16T20:00:00Z'), cairo).state).toBe('OK');
  });
  it('a human touch restarts the clock; a status other than NEW or switched-off reminders have no clock', () => {
    const t = slaOf({ ...base, lastTouchedAt: at('2027-01-10T14:00:00Z') }, c, at('2027-01-10T15:00:00Z'), cairo);
    expect(t.state).toBe('OK'); expect(t.since.toISOString()).toBe('2027-01-10T14:00:00.000Z');
    expect(slaOf({ ...base, status: 'CONTACTED' }, c, at('2027-02-10T15:00:00Z'), cairo).state).toBe('OFF');
    expect(slaOf(base, { ...c, reminders: { ...c.reminders, enabled: false } }, at('2027-02-10T15:00:00Z'), cairo).state).toBe('OFF');
  });
});

describe('validateRoutingConfig', () => {
  it('accepts the defaults and normalises', () => {
    const v = validateRoutingConfig({ ...DEFAULT_ROUTING_CONFIG, roundRobin: { ...DEFAULT_ROUTING_CONFIG.roundRobin, eligibleSubs: ['b', 'a', 'a'] } });
    expect(v.ok && v.config.roundRobin.eligibleSubs).toEqual(['a', 'b']);
  });
  it('refuses unknown keys, bad numbers, an escalation before the reminder and an inverted work day', () => {
    const bad = (m: object) => validateRoutingConfig({ ...DEFAULT_ROUTING_CONFIG, ...m });
    expect(bad({ typo: 1 }).ok).toBe(false);
    expect(bad({ reminders: { ...DEFAULT_ROUTING_CONFIG.reminders, remindAfterWorkingHours: 0 } }).ok).toBe(false);
    expect(bad({ reminders: { ...DEFAULT_ROUTING_CONFIG.reminders, remindAfterWorkingHours: 6, escalateAfterWorkingHours: 2 } }).ok).toBe(false);
    expect(bad({ workWeek: { days: [0, 0], startHour: 9, endHour: 17 } }).ok).toBe(false);
    expect(bad({ workWeek: { days: [0], startHour: 17, endHour: 9 } }).ok).toBe(false);
    expect(bad({ roundRobin: { ...DEFAULT_ROUTING_CONFIG.roundRobin, eligibleSubs: ['<script>'] } }).ok).toBe(false);
    expect(validateRoutingConfig(null).ok).toBe(false);
  });
});
