import { breaches, parseCruxRows, parseLighthouseSummary, percentile75 } from './vitals';
import { SEO_AUTOMATION_DEFAULTS } from './seo-automation-config';

// recorded shape of apps/web/scripts/lighthouse-audit.mjs summary.json (a trimmed real run)
const SUMMARY = [
  { factor: 'mobile', locale: 'ar', page: 'doctor', perf: 97, a11y: 100, bp: 96, seo: 100, lcp: 1710, cls: 0, tbt: 40, fcp: 1200, problems: [] },
  { factor: 'mobile', locale: 'en', page: 'doctor', perf: 93, a11y: 100, bp: 96, seo: 100, lcp: 2320, cls: 0.02, tbt: 90, fcp: 1300, problems: [] },
  { factor: 'mobile', locale: 'ar', page: 'clinic', perf: 88, a11y: 98, bp: 96, seo: 100, lcp: 2900, cls: 0.14, tbt: 260, fcp: 1500, problems: ['x'] },
  { factor: 'desktop', locale: 'ar', page: 'doctor', perf: 100, lcp: 700, cls: 0, tbt: 0 },
  { factor: 'mobile', locale: 'ar', page: 'unknown-page', perf: 50, lcp: 9999, cls: 1, tbt: 9999 },
  { factor: 'mobile', locale: 'ar', page: 'home', perf: 'bad', lcp: null, cls: NaN, tbt: 10 },
];
const CRUX = [
  { dimensionKey: 'template:doctor', metric: 'lcp_p75', value: 2400 }, { dimensionKey: 'template:doctor', metric: 'inp_p75', value: 190 }, { dimensionKey: 'template:doctor', metric: 'cls_p75', value: 8 },
  { dimensionKey: 'template:clinic', metric: 'lcp_p75', value: 3200 }, { dimensionKey: 'channel:x', metric: 'lcp_p75', value: 1 }, { dimensionKey: 'template:all', metric: 'foo', value: 1 },
];

describe('vitals parsing', () => {
  it('percentile75 uses nearest rank and ignores non-finite values', () => {
    expect(percentile75([])).toBeNull(); expect(percentile75([5])).toBe(5); expect(percentile75([1, 2, 3, 4])).toBe(3); expect(percentile75([4, NaN, 1, 3, 2])).toBe(3);
  });
  it('lab: mobile rows only, per template, p75, the worst score, malformed rows skipped', () => {
    const p = parseLighthouseSummary(SUMMARY);
    expect(p.filter((x) => x.templateKind === 'doctor').map((x) => [x.metric, x.p75, x.sampleSize])).toEqual(expect.arrayContaining([['lcp_ms', 2320, 2], ['cls', 0.02, 2], ['tbt_ms', 90, 2], ['perf_score', 93, 2]]));
    expect(p.find((x) => x.templateKind === 'clinic' && x.metric === 'perf_score')!.p75).toBe(88);
    expect(p.some((x) => x.templateKind === 'unknown-page')).toBe(false);
    expect(p.find((x) => x.templateKind === 'home' && x.metric === 'tbt_ms')!.p75).toBe(10);
    expect(p.some((x) => x.templateKind === 'home' && x.metric === 'lcp_ms')).toBe(false);
    expect(parseLighthouseSummary({})).toEqual([]); expect(parseLighthouseSummary(null)).toEqual([]);
  });
  it('field: CrUX rows by template, cls from hundredths, other dimensions and metrics ignored', () => {
    const f = parseCruxRows(CRUX, 120);
    expect(f).toEqual([
      { templateKind: 'doctor', metric: 'lcp_ms', p75: 2400, source: 'FIELD', sampleSize: 120 }, { templateKind: 'doctor', metric: 'inp_ms', p75: 190, source: 'FIELD', sampleSize: 120 },
      { templateKind: 'doctor', metric: 'cls', p75: 0.08, source: 'FIELD', sampleSize: 120 }, { templateKind: 'clinic', metric: 'lcp_ms', p75: 3200, source: 'FIELD', sampleSize: 120 },
    ]);
  });
  it('budgets: lab and field breaches against the config (the lighthouserc numbers)', () => {
    const b = SEO_AUTOMATION_DEFAULTS().vitals;
    const lab = breaches(parseLighthouseSummary(SUMMARY), b);
    expect(lab.map((x) => `${x.templateKind}.${x.metric}`).sort()).toEqual(['clinic.cls', 'clinic.lcp_ms', 'clinic.perf_score', 'clinic.tbt_ms']);
    const field = breaches(parseCruxRows(CRUX), b);
    expect(field.map((x) => `${x.templateKind}.${x.metric}`)).toEqual(['clinic.lcp_ms']);
    expect(breaches([], b)).toEqual([]);
  });
});
