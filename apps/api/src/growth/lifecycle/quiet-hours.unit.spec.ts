import { quietEnd, quietWindow, defaultQuiet } from './quiet-hours';

const iso = (s: string) => Date.parse(s);

/**
 * G-5: Cairo changes its offset twice a year (2027: Friday 30 April 00:00 -> 01:00, and at the end of Thursday 28 October 24:00 -> 23:00). A window computed with a fixed offset
 * ends an hour late in spring and an hour early in autumn. With the zone, the window ends at 09:00 local wall time on both nights.
 */
describe('quiet hours across the Cairo offset-change nights', () => {
  const q = quietWindow(defaultQuiet());
  it('is outside the window during the day', () => {
    expect(quietEnd(iso('2027-03-10T10:00:00Z'), q)).toBeNull(); // 12:00 local
    expect(quietEnd(iso('2027-03-10T18:59:00Z'), q)).toBeNull(); // 20:59 local
  });
  it('ordinary winter night: 21:00 local starts, 09:00 local (07:00 UTC) ends', () => {
    expect(quietEnd(iso('2027-03-10T19:00:00Z'), q)).toBe(iso('2027-03-11T07:00:00Z'));
    expect(quietEnd(iso('2027-03-11T05:00:00Z'), q)).toBe(iso('2027-03-11T07:00:00Z'));
  });
  it('ordinary summer night: 09:00 local is 06:00 UTC', () => {
    expect(quietEnd(iso('2027-07-10T19:00:00Z'), q)).toBe(iso('2027-07-11T06:00:00Z')); // 22:00 local (+3)
  });
  it('spring change (night of 29 to 30 April 2027): the window that started at +2 ends at 09:00 local = 06:00 UTC, not 07:00', () => {
    expect(quietEnd(iso('2027-04-29T21:30:00Z'), q)).toBe(iso('2027-04-30T06:00:00Z')); // 23:30 local on the 29th
  });
  it('autumn change (night of 28 to 29 October 2027): the window that started at +3 ends at 09:00 local = 07:00 UTC, not 06:00', () => {
    expect(quietEnd(iso('2027-10-28T20:00:00Z'), q)).toBe(iso('2027-10-29T07:00:00Z')); // 23:00 local on the 28th (+3)
    expect(quietEnd(iso('2027-10-29T01:00:00Z'), q)).toBe(iso('2027-10-29T07:00:00Z')); // 03:00 local after the change (+2)
  });
  it('the 2026 changes behave the same (24 April and 29 October)', () => {
    expect(quietEnd(iso('2026-04-23T21:30:00Z'), q)).toBe(iso('2026-04-24T06:00:00Z'));
    expect(quietEnd(iso('2026-10-29T20:00:00Z'), q)).toBe(iso('2026-10-30T07:00:00Z'));
  });
  it('the person own whole-hour window overrides the policy window and keeps the zone', () => {
    const own = quietWindow(defaultQuiet(), { start: 22, end: 7 });
    expect(own).toMatchObject({ startHour: 22, endHour: 7, zone: 'Africa/Cairo' });
    expect(quietEnd(iso('2027-03-10T19:30:00Z'), own)).toBeNull(); // 21:30 local is outside 22 to 07
    expect(quietEnd(iso('2027-03-10T20:30:00Z'), own)).toBe(iso('2027-03-11T05:00:00Z'));
  });
  it('a window that starts and ends at the same hour is no window', () => {
    expect(quietEnd(iso('2027-03-10T20:00:00Z'), quietWindow(defaultQuiet(), { start: 9, end: 9 }))).toBeNull();
  });
});
