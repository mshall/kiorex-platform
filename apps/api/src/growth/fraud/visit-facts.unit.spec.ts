import { visitMinutesBetween, visitTimesDetail } from './visit-facts';

describe('visit facts (Clinic check-in and completion times)', () => {
  const t = (m: number) => new Date(Date.UTC(2027, 0, 1, 10, m)).toISOString();
  it('whole minutes between the two times', () => { expect(visitMinutesBetween(t(0), t(4))).toBe(4); expect(visitMinutesBetween(t(0), t(0))).toBe(0); });
  it('missing, malformed, reversed or over-24-hour times give nothing', () => {
    for (const [a, b] of [[undefined, t(4)], [t(0), undefined], ['yesterday', t(4)], [t(10), t(4)], [t(0), 7], [t(0), new Date(Date.UTC(2027, 0, 2, 11)).toISOString()]] as const) expect(visitMinutesBetween(a, b)).toBeUndefined();
  });
  it('only CHECKED_IN checkedInAt and COMPLETED checkedInAt and completedAt are kept (no other field)', () => {
    expect(visitTimesDetail('CHECKED_IN', { checkedInAt: t(0), completedAt: t(9), patient: 'x' })).toEqual({ checkedInAt: t(0) });
    expect(visitTimesDetail('COMPLETED', { checkedInAt: t(0), completedAt: t(9), note: 'x' })).toEqual({ checkedInAt: t(0), completedAt: t(9) });
    expect(visitTimesDetail('COMPLETED', { checkedInAt: 'bad' })).toBeNull();
  });
});
