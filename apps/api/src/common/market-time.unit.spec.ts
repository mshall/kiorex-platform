import { marketClock, quietWindowEnd, zoneOffsetMinutes } from './market-time';

/** EDGE 47: Cairo daylight saving time. Egypt: +2 in winter, +3 from the last Friday of April 00:00 to the last Thursday of October 24:00 (2026: 24 Apr and 29/30 Oct). */
const Z = 'Africa/Cairo';
const utc = (s: string) => Date.parse(s);
describe('market time with Cairo DST', () => {
  it('offset is +120 in winter and +180 in summer, switching exactly at the transitions', () => {
    expect(zoneOffsetMinutes(Z, utc('2026-01-15T12:00:00Z'), 120)).toBe(120);
    expect(zoneOffsetMinutes(Z, utc('2026-07-15T12:00:00Z'), 120)).toBe(180);
    expect(zoneOffsetMinutes(Z, utc('2026-04-23T21:59:59Z'), 120)).toBe(120); // last second before 24 Apr 00:00 (+2)
    expect(zoneOffsetMinutes(Z, utc('2026-04-23T22:00:00Z'), 120)).toBe(180); // 24 Apr 01:00 local
    expect(zoneOffsetMinutes(Z, utc('2026-10-29T20:59:59Z'), 120)).toBe(180);
    expect(zoneOffsetMinutes(Z, utc('2026-10-29T21:00:00Z'), 120)).toBe(120); // 29 Oct 23:00 local after the clocks go back
  });
  it('an unknown zone falls back to the configured fixed offset instead of throwing', () => {
    expect(zoneOffsetMinutes('Not/AZone', utc('2026-07-15T12:00:00Z'), 120)).toBe(120);
  });
  it('quiet window 22:00-08:00 in SUMMER: 22:30 local (19:30Z) is quiet and ends at 08:00 local = 05:00Z (a fixed +2 would say 21:30 = not quiet and send at 22:30)', () => {
    expect(quietWindowEnd(utc('2026-07-15T19:30:00Z'), 22, 8)).toBe(utc('2026-07-16T05:00:00Z'));
    expect(quietWindowEnd(utc('2026-07-15T18:59:59Z'), 22, 8)).toBeNull(); // 21:59:59 local
    expect(quietWindowEnd(utc('2026-07-15T19:00:00Z'), 22, 8)).toBe(utc('2026-07-16T05:00:00Z')); // exactly 22:00 local is inside
    expect(quietWindowEnd(utc('2026-07-16T04:59:59Z'), 22, 8)).toBe(utc('2026-07-16T05:00:00Z'));
    expect(quietWindowEnd(utc('2026-07-16T05:00:00Z'), 22, 8)).toBeNull(); // 08:00 local sharp is outside (end exclusive)
  });
  it('winter is unchanged: 22:30 local is 20:30Z and ends 06:00Z', () => {
    expect(quietWindowEnd(utc('2026-01-15T20:30:00Z'), 22, 8)).toBe(utc('2026-01-16T06:00:00Z'));
  });
  it('the night the clocks go FORWARD (23->24 Apr 2026): a send at 23:00 local (+2) waits until 08:00 local (+3) = 05:00Z, not 06:00Z', () => {
    expect(quietWindowEnd(utc('2026-04-23T21:00:00Z'), 22, 8)).toBe(utc('2026-04-24T05:00:00Z'));
  });
  it('the night the clocks go BACK (29->30 Oct 2026): a send at 22:30 local (+3) waits until 08:00 local (+2) = 06:00Z, never 05:00Z (07:00 local, still quiet)', () => {
    expect(quietWindowEnd(utc('2026-10-29T19:30:00Z'), 22, 8)).toBe(utc('2026-10-30T06:00:00Z'));
  });
  it('a window that does not wrap midnight (13:00-15:00 local)', () => {
    expect(quietWindowEnd(utc('2026-07-15T09:00:00Z'), 13, 15)).toBeNull(); // 12:00 local
    expect(quietWindowEnd(utc('2026-07-15T10:00:00Z'), 13, 15)).toBe(utc('2026-07-15T12:00:00Z')); // 13:00 local .. ends 15:00 local = 12:00Z
  });
  it('start == end means no window at all', () => { expect(quietWindowEnd(utc('2026-07-15T19:30:00Z'), 0, 0)).toBeNull(); expect(quietWindowEnd(utc('2026-07-15T19:30:00Z'), 5, 5)).toBeNull(); });
  it('a window ending at midnight (22-0) ends at 00:00 local of the next day', () => {
    const end = quietWindowEnd(utc('2026-07-15T20:30:00Z'), 22, 0)!; // 23:30 local
    expect(end).toBe(utc('2026-07-15T21:00:00Z')); // 00:00 local on 16 Jul (+3)
  });
});

describe('marketClock (WhatsApp booking copy) shows Cairo wall-clock time', () => {
  it('summer 13:00Z is 16:00 in Cairo, winter 13:00Z is 15:00', () => {
    expect(marketClock('2026-07-15T13:00:00Z', 'en')).toMatch(/16:00$/);
    expect(marketClock('2026-01-15T13:00:00Z', 'en')).toMatch(/15:00$/);
  });
  it('the local date rolls over: 22:30Z in summer is 01:30 the NEXT day in Cairo', () => {
    expect(marketClock('2026-07-15T22:30:00Z', 'en')).toMatch(/^Thu 16 Jul 01:30$/);
  });
  it('Arabic digits are not used for the clock part (the day name is Arabic)', () => {
    expect(marketClock('2026-07-15T13:00:00Z', 'ar')).toMatch(/16:00$/);
  });
});
