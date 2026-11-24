import { addDays, daysBetween, localDay, marketTimezone, nextDayBoundary, startOfLocalDay } from './market-day';

const Z = 'Africa/Cairo';
describe('market-local days (GRW-P2-A daily cap rollover)', () => {
  it('the zone table', () => { expect(marketTimezone('EG')).toBe('Africa/Cairo'); expect(marketTimezone('eg')).toBe('Africa/Cairo'); expect(marketTimezone('ZZ')).toBe('UTC'); });
  it('a Cairo day starts at local midnight: 22:00 UTC is already the next day in winter (UTC+2)', () => {
    expect(localDay(new Date('2027-01-15T21:59:59Z'), Z)).toBe('2027-01-15'); expect(localDay(new Date('2027-01-15T22:00:00Z'), Z)).toBe('2027-01-16');
    expect(nextDayBoundary(new Date('2027-01-15T10:00:00Z'), Z).toISOString()).toBe('2027-01-15T22:00:00.000Z');
  });
  it('and 21:00 UTC in summer (UTC+3)', () => {
    expect(localDay(new Date('2026-07-15T20:59:59Z'), Z)).toBe('2026-07-15'); expect(localDay(new Date('2026-07-15T21:00:00Z'), Z)).toBe('2026-07-16');
    expect(nextDayBoundary(new Date('2026-07-15T10:00:00Z'), Z).toISOString()).toBe('2026-07-15T21:00:00.000Z');
  });
  it('the rollover on the two transition nights is the real local midnight (spring forward 24 Apr 2026: 23 hours; fall back at the end of Thu 29 Oct 2026: that day has 25 hours)', () => {
    const springStart = startOfLocalDay('2026-04-24', Z); const springEnd = nextDayBoundary(springStart, Z);
    expect(springStart.toISOString()).toBe('2026-04-23T22:00:00.000Z'); expect(springEnd.toISOString()).toBe('2026-04-24T21:00:00.000Z'); expect(springEnd.getTime() - springStart.getTime()).toBe(23 * 3600_000); // 00:00 at +2 to next 00:00 at +3
    const fallStart = startOfLocalDay('2026-10-29', Z); const fallEnd = nextDayBoundary(fallStart, Z);
    expect(fallEnd.getTime() - fallStart.getTime()).toBe(25 * 3600_000);
  });
  it('addDays and daysBetween are calendar arithmetic', () => {
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01'); expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(daysBetween(new Date('2027-01-30T12:00:00Z'), new Date('2027-02-02T12:00:00Z'), Z)).toEqual(['2027-01-30', '2027-01-31', '2027-02-01', '2027-02-02']);
  });
});
