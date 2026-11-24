import { DAY_MS, capCounts, inHoldout, stricterCaps, withinWindowBudget } from './frequency-cap';

const NOW = Date.parse('2027-03-10T12:00:00Z');
const ago = (h: number) => new Date(NOW - h * 3_600_000);

describe('frequency caps and holdout', () => {
  it('counts per rolling day and week; the future and older sends do not count', () => {
    expect(capCounts([ago(1), ago(23), ago(25), ago(24 * 6), ago(24 * 8), new Date(NOW + 3_600_000)], NOW)).toEqual({ day: 2, week: 4 });
    expect(capCounts([], NOW)).toEqual({ day: 0, week: 0 });
  });
  it('exactly 24 hours old is outside the day window', () => {
    expect(capCounts([new Date(NOW - DAY_MS)], NOW)).toEqual({ day: 0, week: 1 });
  });
  it('the stricter caps win', () => {
    expect(stricterCaps({ perDay: 2, perWeek: 3 }, { perDay: 1, perWeek: 5 })).toEqual({ perDay: 1, perWeek: 3 });
  });
  it('re-engagement budget: at most N in the rolling window', () => {
    expect(withinWindowBudget([ago(24)], NOW, 2, 90)).toBe(true);
    expect(withinWindowBudget([ago(24), ago(48)], NOW, 2, 90)).toBe(false);
    expect(withinWindowBudget([ago(24), ago(24 * 100)], NOW, 2, 90)).toBe(true);
  });
  it('holdout is deterministic and about the configured share', () => {
    expect(inHoldout('a', 'reengagement', 0)).toBe(false);
    expect(inHoldout('a', 'reengagement', 10_000)).toBe(true);
    expect(inHoldout('sub-1', 'reengagement', 500)).toBe(inHoldout('sub-1', 'reengagement', 500));
    let held = 0; for (let i = 0; i < 20_000; i++) if (inHoldout(`sub-${i}`, 'reengagement', 500)) held++;
    expect(held).toBeGreaterThan(20_000 * 0.04); expect(held).toBeLessThan(20_000 * 0.06);
    let other = 0; for (let i = 0; i < 2_000; i++) if (inHoldout(`sub-${i}`, 'reengagement', 500) !== inHoldout(`sub-${i}`, 'other', 500)) other++;
    expect(other).toBeGreaterThan(0); // the slice differs per journey
  });
});
