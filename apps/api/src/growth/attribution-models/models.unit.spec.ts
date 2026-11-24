import { aggregateModel, totalsOf } from './aggregate';
import { dataDriven } from './data-driven';
import { buildIdentityResolver, assertJoinKey } from './identity-link';
import { ATTRIBUTION_MODELS, apportion, creditPath, DEFAULT_MODEL, ONE_MILLION, PATH_MODELS, type PathTouch } from './models';
import { buildPaths, capPath, pathHashOf, type ConvertingPath, type RawTouch } from './path-builder';
import { inWindow, windowDaysFor, checkWindows, DEFAULT_WINDOWS } from './windows';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 1, 12, 0, 0);
const touch = (kind: string, daysBefore: number, ref = '', campaignId = ''): PathTouch => ({ at: T0 - daysBefore * DAY, kind, ref, campaignId });
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

describe('apportion (largest remainder)', () => {
  it('sums to the total exactly, deterministic, ties to the lower index', () => {
    expect(apportion(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(apportion(ONE_MILLION, [1, 1, 1])).toEqual([333334, 333333, 333333]);
    expect(apportion(0, [3, 4])).toEqual([0, 0]);
    expect(apportion(7, [0, 0, 0])).toEqual([0, 0, 7]);
  });
  it('holds for 2,000 random vectors', () => {
    let s = 12345; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 2000; i++) { const n = 1 + Math.floor(rnd() * 12); const w = Array.from({ length: n }, () => rnd() * 10); const total = Math.floor(rnd() * 100000); const out = apportion(total, w); expect(sum(out)).toBe(total); expect(out.every((x) => x >= 0)).toBe(true); }
  });
});

describe('path-local models, hand-computed', () => {
  // path: ORGANIC (10 d before), DIRECT (3 d before), CAMPAIGN (1 d before), DIRECT (0 d)
  const path = [touch('ORGANIC_SEARCH', 10), touch('DIRECT', 3), touch('CAMPAIGN', 1), touch('DIRECT', 0)];
  it('LAST_TOUCH, FIRST_TOUCH, LAST_NON_DIRECT', () => {
    expect(creditPath('LAST_TOUCH', path, T0)).toEqual([0, 0, 0, ONE_MILLION]);
    expect(creditPath('FIRST_TOUCH', path, T0)).toEqual([ONE_MILLION, 0, 0, 0]);
    expect(creditPath('LAST_NON_DIRECT', path, T0)).toEqual([0, 0, ONE_MILLION, 0]);
    expect(creditPath('LAST_NON_DIRECT', [touch('DIRECT', 2), touch('DIRECT', 0)], T0)).toEqual([0, ONE_MILLION]);
  });
  it('LINEAR is equal shares', () => expect(creditPath('LINEAR', path, T0)).toEqual([250000, 250000, 250000, 250000]));
  it('POSITION_BASED is 40 / 20 shared / 40, with the one and two touch cases', () => {
    expect(creditPath('POSITION_BASED', path, T0)).toEqual([400000, 100000, 100000, 400000]);
    expect(creditPath('POSITION_BASED', [touch('DIRECT', 0)], T0)).toEqual([ONE_MILLION]);
    expect(creditPath('POSITION_BASED', [touch('DIRECT', 1), touch('CAMPAIGN', 0)], T0)).toEqual([500000, 500000]);
    expect(creditPath('POSITION_BASED', [touch('A', 3), touch('B', 2), touch('C', 1), touch('D', 0.5), touch('E', 0)], T0)).toEqual([400000, 66667, 66667, 66666, 400000].map((x, i) => (i === 1 ? 66667 : x)).slice(0, 5));
  });
  it('TIME_DECAY halves the weight every 7 days', () => {
    const w = creditPath('TIME_DECAY', [touch('A', 14), touch('B', 7), touch('C', 0)], T0); // raw 0.25 : 0.5 : 1 => 1/7 : 2/7 : 4/7
    expect(w).toEqual([142857, 285714, 571429]);
    expect(sum(w)).toBe(ONE_MILLION);
  });
  it('every path model sums to exactly one conversion on 500 random paths', () => {
    let s = 99; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    const kinds = ['DIRECT', 'ORGANIC_SEARCH', 'PROVIDER_LINK', 'CAMPAIGN', 'REFERRAL'];
    for (let i = 0; i < 500; i++) {
      const n = 1 + Math.floor(rnd() * 9); const p = Array.from({ length: n }, (_, j) => touch(kinds[Math.floor(rnd() * 5)]!, (n - j) * rnd() * 5));
      p.sort((a, b) => a.at - b.at);
      for (const m of PATH_MODELS) { const w = creditPath(m, p, T0); expect(w.length).toBe(n); expect(sum(w)).toBe(ONE_MILLION); expect(w.every((x) => x >= 0)).toBe(true); }
    }
  });
  it('the default report model is POSITION_BASED and the list is closed', () => {
    expect(DEFAULT_MODEL).toBe('POSITION_BASED');
    expect([...ATTRIBUTION_MODELS]).toEqual(['LAST_TOUCH', 'LAST_NON_DIRECT', 'FIRST_TOUCH', 'LINEAR', 'TIME_DECAY', 'POSITION_BASED', 'DATA_DRIVEN']);
  });
});

describe('aggregate: no model loses or invents a conversion or a minor unit of revenue', () => {
  const mk = (i: number, kinds: string[], revenueMinor: number): ConvertingPath => ({ conversionId: `b${i}`, at: T0 + i * 3_600_000, revenueMinor, touches: kinds.map((k, j) => ({ at: T0 + i * 3_600_000 - (kinds.length - j) * DAY, kind: k, ref: k === 'CAMPAIGN' ? 'spring' : '', campaignId: k === 'CAMPAIGN' ? 'c1' : '' })) });
  const paths: ConvertingPath[] = [mk(1, ['ORGANIC_SEARCH', 'DIRECT'], 4000), mk(2, ['CAMPAIGN'], 4001), mk(3, ['PROVIDER_LINK', 'CAMPAIGN', 'DIRECT'], 3999), mk(4, [], 4000), mk(5, ['REFERRAL', 'DIRECT', 'ORGANIC_SEARCH', 'CAMPAIGN'], 7)];
  const revenue = paths.reduce((s, p) => s + p.revenueMinor, 0);
  for (const m of PATH_MODELS) {
    it(`${m} reconciles to ${paths.length} conversions and the revenue facts`, () => {
      const rows = aggregateModel(m, paths, 'Africa/Cairo');
      const t = totalsOf(rows); expect(t.conversionsPpm).toBe(paths.length * ONE_MILLION); expect(t.revenueMinor).toBe(revenue);
    });
  }
  it('a conversion without any touch is credited to UNATTRIBUTED', () => {
    const rows = aggregateModel('POSITION_BASED', [paths[3]!], 'Africa/Cairo'); expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ sourceKind: 'UNATTRIBUTED', conversionsPpm: ONE_MILLION, revenueMinor: 4000, paths: 1 });
  });
  it('rows are keyed by the market day, not the UTC day', () => {
    // 22:30 UTC on 1 Nov is 00:30 on 2 Nov in Cairo (UTC+2 in November)
    const late: ConvertingPath = { conversionId: 'x', at: Date.UTC(2026, 10, 1, 22, 30), revenueMinor: 100, touches: [{ at: Date.UTC(2026, 10, 1, 20), kind: 'DIRECT', ref: '', campaignId: '' }] };
    expect(aggregateModel('LAST_TOUCH', [late], 'Africa/Cairo')[0]!.day).toBe('2026-11-02');
    expect(aggregateModel('LAST_TOUCH', [late], 'UTC')[0]!.day).toBe('2026-11-01');
  });
});

describe('windows: day N inclusive, market day boundary', () => {
  const zone = 'Africa/Cairo';
  const conv = Date.UTC(2026, 10, 30, 10, 0); // 30 Nov 12:00 Cairo
  it('a touch on local day 30 before counts, day 31 does not (whatever the hour)', () => {
    const d30 = Date.UTC(2026, 9, 31, 0, 30); // 31 Oct 02:30 Cairo, 30 local days before 30 Nov
    const d30early = Date.UTC(2026, 9, 30, 22, 30); // 31 Oct 00:30 Cairo: still local day -30
    const d31 = Date.UTC(2026, 9, 30, 21, 30); // 30 Oct 23:30 Cairo: local day -31
    const t = (at: number): PathTouch => ({ at, kind: 'ORGANIC_SEARCH', ref: '', campaignId: '' });
    expect(inWindow(t(d30), conv, zone)).toBe(true); expect(inWindow(t(d30early), conv, zone)).toBe(true); expect(inWindow(t(d31), conv, zone)).toBe(false);
  });
  it('campaign touches use 7 days, provider links 30, and a touch after the conversion never counts', () => {
    expect(windowDaysFor('CAMPAIGN')).toBe(7); expect(windowDaysFor('PROVIDER_LINK')).toBe(30); expect(windowDaysFor('DIRECT')).toBe(30);
    const t = (kind: string, d: number): PathTouch => ({ at: conv - d * DAY, kind, ref: '', campaignId: '' });
    expect(inWindow(t('CAMPAIGN', 7), conv, zone)).toBe(true); expect(inWindow(t('CAMPAIGN', 8), conv, zone)).toBe(false);
    expect(inWindow(t('DIRECT', -0.01), conv, zone)).toBe(false);
  });
  it('rejects absurd windows', () => { expect(() => checkWindows({ ...DEFAULT_WINDOWS, webAppDays: 0 })).toThrow(); expect(() => checkWindows({ ...DEFAULT_WINDOWS, campaignDays: 91 })).toThrow(); expect(checkWindows(DEFAULT_WINDOWS)).toBe(DEFAULT_WINDOWS); });
});

describe('cross-device joining (sub and visitorKey only)', () => {
  const rt = (id: string, sub: string | null, visitorKey: string | null, daysBefore: number, kind = 'ORGANIC_SEARCH'): RawTouch => ({ id, sub, visitorKey, at: T0 - daysBefore * DAY, kind, ref: '', campaignId: '' });
  it('refuses every other join key', () => {
    for (const bad of ['ip', 'ipHash', 'uaClass', 'phone', 'email', 'deviceId', 'fingerprint', 'clickIdHash']) expect(() => assertJoinKey(bad)).toThrow(/sub or visitorKey/);
    expect(() => assertJoinKey('sub')).not.toThrow(); expect(() => assertJoinKey('visitorKey')).not.toThrow();
  });
  it('a pre-login visitor touch joins the person through a recorded link; an unlinked visitor does not', () => {
    const touches = [rt('1', null, 'v1', 9, 'ORGANIC_SEARCH'), rt('2', 'u1', 'v1', 5, 'CAMPAIGN'), rt('3', 'u1', null, 1, 'DIRECT'), rt('4', null, 'v2', 4, 'REFERRAL')];
    const { converting } = buildPaths(touches, [{ id: 'b1', sub: 'u1', at: T0, revenueMinor: 4000 }], 'Africa/Cairo');
    expect(converting[0]!.touches.map((t) => t.kind)).toEqual(['ORGANIC_SEARCH', 'CAMPAIGN', 'DIRECT']);
  });
  it('a visitorKey shared by two subs joins neither (no leakage between people)', () => {
    const r = buildIdentityResolver([rt('1', 'u1', 'v1', 3), rt('2', 'u2', 'v1', 2), rt('3', null, 'v1', 1)]);
    expect(r(rt('3', null, 'v1', 1))).toBe('v:v1');
    const { converting } = buildPaths([rt('1', 'u1', 'v1', 3), rt('2', 'u2', 'v1', 2), rt('3', null, 'v1', 1, 'DIRECT')], [{ id: 'b', sub: 'u1', at: T0, revenueMinor: 1 }], 'Africa/Cairo');
    expect(converting[0]!.touches).toHaveLength(1);
  });
  it('a touch before the previous conversion of the same person is not reused', () => {
    const touches = [rt('1', 'u1', null, 20), rt('2', 'u1', null, 2)];
    const { converting } = buildPaths(touches, [{ id: 'a', sub: 'u1', at: T0 - 10 * DAY, revenueMinor: 1 }, { id: 'b', sub: 'u1', at: T0, revenueMinor: 1 }], 'Africa/Cairo');
    expect(converting.map((c) => c.touches.length)).toEqual([1, 1]);
  });
  it('path cap keeps the first and the last touches; hash covers kinds only', () => {
    const p = Array.from({ length: 80 }, (_, i) => i); const c = capPath(p); expect(c).toHaveLength(50); expect(c[0]).toBe(0); expect(c.at(-1)).toBe(79);
    expect(pathHashOf(['A', 'B'])).toBe(pathHashOf(['A', 'B'])); expect(pathHashOf(['A', 'B'])).not.toBe(pathHashOf(['B', 'A'])); expect(pathHashOf(['A'])).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('data-driven (Markov removal effect)', () => {
  const conv = (i: number, kinds: string[]): ConvertingPath => ({ conversionId: `c${i}`, at: T0, revenueMinor: 100, touches: kinds.map((k, j) => ({ at: T0 - (kinds.length - j) * DAY, kind: k, ref: '', campaignId: '' })) });
  it('says insufficient volume under 1,000 conversions', () => {
    const r = dataDriven(Array.from({ length: 999 }, (_, i) => conv(i, ['A', 'B'])), []); expect(r).toEqual({ ok: false, reason: 'INSUFFICIENT_VOLUME', conversions: 999, needed: 1000 });
  });
  it('credits the node whose removal kills the conversions; weights sum to one per path', () => {
    // A is needed for every conversion, B is decoration: 600 A>B converting, 600 A converting, 400 B-only non converting
    const cps = [...Array.from({ length: 600 }, (_, i) => conv(i, ['A', 'B'])), ...Array.from({ length: 600 }, (_, i) => conv(1000 + i, ['A']))];
    const nulls = Array.from({ length: 400 }, () => ({ kinds: ['B'] }));
    const r = dataDriven(cps, nulls); expect(r.ok).toBe(true); if (!r.ok) return;
    expect(r.effect.A!).toBeGreaterThan(r.effect.B!); expect(r.effect.A!).toBeCloseTo(0.8, 6); // P(full) = 0.75; without A only the 25 percent B-start paths convert, at 0.6
    const w = r.weightsFor(['A', 'B']); expect(w[0]! + w[1]!).toBeCloseTo(1, 9); expect(w[0]!).toBeGreaterThan(w[1]!);
    const rows = aggregateModel('DATA_DRIVEN', cps, 'Africa/Cairo', undefined, undefined, r); expect(totalsOf(rows).conversionsPpm).toBe(cps.length * ONE_MILLION); expect(totalsOf(rows).revenueMinor).toBe(cps.length * 100);
  });
  it('folds nodes seen in fewer than k = 10 paths into OTHER', () => {
    const cps = [...Array.from({ length: 1000 }, (_, i) => conv(i, ['A', 'B'])), ...Array.from({ length: 5 }, (_, i) => conv(2000 + i, ['RARE', 'A']))];
    const r = dataDriven(cps, [{ kinds: ['B'] }, ...Array.from({ length: 20 }, () => ({ kinds: ['B'] }))]); expect(r.ok).toBe(true); if (!r.ok) return;
    expect(r.folded).toEqual(['RARE']); expect(r.nodes).toContain('OTHER'); expect(r.nodes).not.toContain('RARE');
  });
  it('is deterministic', () => {
    const cps = Array.from({ length: 1100 }, (_, i) => conv(i, i % 3 ? ['A', 'B'] : ['B', 'A', 'C'])); const n = Array.from({ length: 300 }, (_, i) => ({ kinds: i % 2 ? ['A'] : ['C', 'B'] }));
    const a = dataDriven(cps, n), b = dataDriven(cps, n); expect(a.ok && b.ok && JSON.stringify(a.share) === JSON.stringify(b.share)).toBe(true);
  });
});

describe('performance: a 500,000 touch fixture rolls up in well under 60 s', () => {
  it('builds paths and computes every path model for 500k touches and 100k conversions', () => {
    const kinds = ['DIRECT', 'ORGANIC_SEARCH', 'PROVIDER_LINK', 'CAMPAIGN', 'REFERRAL'];
    const touches: RawTouch[] = []; const convs: { id: string; sub: string; at: number; revenueMinor: number }[] = [];
    for (let p = 0; p < 100_000; p++) {
      for (let j = 0; j < 5; j++) touches.push({ id: `t${p}_${j}`, sub: `u${p}`, visitorKey: null, at: T0 - (5 - j) * DAY, kind: kinds[(p + j) % 5]!, ref: '', campaignId: '' });
      convs.push({ id: `b${p}`, sub: `u${p}`, at: T0, revenueMinor: 4000 + (p % 7) });
    }
    const t0 = Date.now(); const { converting } = buildPaths(touches, convs, 'Africa/Cairo');
    let ppm = 0, rev = 0; for (const m of PATH_MODELS) { const rows = aggregateModel(m, converting, 'Africa/Cairo'); const t = totalsOf(rows); ppm += t.conversionsPpm; rev += t.revenueMinor; }
    expect(Date.now() - t0).toBeLessThan(60_000); expect(ppm).toBe(PATH_MODELS.length * 100_000 * ONE_MILLION); expect(rev).toBe(PATH_MODELS.length * convs.reduce((s, c) => s + c.revenueMinor, 0));
  }, 120_000);
});
