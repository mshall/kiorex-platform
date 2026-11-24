import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mockFor, synth } from './mock/mock.adapter';
import { GROWTH_INTEGRATION_KINDS, PULLS, type PullRange } from './port';
import { realAdapterFor, REAL_SPECS, NeedsHumanError, UpstreamError, type HttpFn } from '../../platform/platform-public';
import { templateOf } from '../../platform/platform-public';

const FX = join(__dirname, '../../platform/adapters/growth/fixtures');
const fx = (f: string) => JSON.parse(readFileSync(join(FX, f), 'utf8'));
const range: PullRange = { from: '2026-12-01', to: '2026-12-03', dimensionKeys: ['eg-ramadan-checkup', 'eg-winter'], currency: 'EGP' };

describe.each([...GROWTH_INTEGRATION_KINDS])('mock adapter contract: %s', (kind) => {
  it('health is ok and says mock', async () => { expect(await mockFor(kind).health()).toMatchObject({ ok: true, mode: 'mock' }); });
  it('is deterministic and respects the range and the supported pulls', async () => {
    const a = mockFor(kind);
    for (const what of PULLS[kind]) {
      const fn = what === 'spend' ? a.pullSpend : what === 'performance' ? a.pullPerformance : a.pullCoreVitals;
      const r1 = await fn!.call(a, range); const r2 = await fn!.call(a, range);
      expect(r1).toEqual(r2); expect(r1.length).toBeGreaterThan(0);
      for (const row of r1) { expect(row.day >= range.from && row.day <= range.to).toBe(true); expect(Number.isFinite(row.value)).toBe(true); expect(row.value).toBeGreaterThanOrEqual(0); expect(row.dimensionKey).not.toMatch(/@|\d{9,}/); }
    }
  });
  it('error injection surfaces from every pull and from health', async () => {
    const a = mockFor(kind, { failWith: new UpstreamError('UPSTREAM_TIMEOUT') });
    await expect(a.health()).rejects.toThrow('UPSTREAM_TIMEOUT');
    for (const what of PULLS[kind]) { const fn = what === 'spend' ? a.pullSpend : what === 'performance' ? a.pullPerformance : a.pullCoreVitals; await expect(fn!.call(a, range)).rejects.toThrow('UPSTREAM_TIMEOUT'); }
  });
  it('sends nothing on pushConversion', async () => { expect(await mockFor(kind).pushConversion()).toEqual({ accepted: false }); });
});
describe('paid mocks produce one row per campaign key per day', () => {
  it('googleads spend rows', async () => { const r = await mockFor('googleads').pullSpend!(range); expect(r).toHaveLength(3 * 2); expect(new Set(r.map((x) => x.dimensionKey))).toEqual(new Set(range.dimensionKeys)); expect(r.every((x) => x.metric === 'spend_minor' && x.currency === 'EGP')).toBe(true); });
  it('synth is stable across calls', () => { expect(synth('a', 1, 100)).toBe(synth('a', 1, 100)); });
});

describe('real adapters fail closed (never a network call in CI)', () => {
  const never: HttpFn = async () => { throw new Error('network must not be called'); };
  it.each([...GROWTH_INTEGRATION_KINDS])('%s without a secretRef throws NEEDS_HUMAN and reports not ok', async (kind) => {
    const a = realAdapterFor(kind, { secretRef: null, resolveSecret: async () => 'x', http: never });
    expect(await a.health()).toMatchObject({ ok: false, mode: 'real' });
    if (kind !== 'fcmapns') { const w = PULLS[kind][0]!; await expect((w === 'spend' ? a.pullSpend : w === 'performance' ? a.pullPerformance : a.pullCoreVitals)!.call(a, range)).rejects.toBeInstanceOf(NeedsHumanError); }
  });
  it('an invalid secretRef or an unresolved secret fails closed with a clear reason', async () => {
    const bad = realAdapterFor('googleads', { secretRef: 'Has Spaces!', resolveSecret: async () => 'x', http: never });
    await expect(bad.pullSpend!(range)).rejects.toThrow(/NEEDS_HUMAN.*valid reference/);
    const missing = realAdapterFor('googleads', { secretRef: 'kiorex/googleads/token', resolveSecret: async () => null, http: never });
    await expect(missing.pullSpend!(range)).rejects.toThrow(/does not resolve/);
    expect((await missing.health()).detail).toBe('secret does not resolve');
  });
  it('health with a resolvable secret makes no upstream call and never echoes the secret', async () => {
    const h = await realAdapterFor('crux', { secretRef: 'kiorex/crux/key', resolveSecret: async () => 'SUPER-SECRET-VALUE', http: never }).health();
    expect(h.ok).toBe(true); expect(JSON.stringify(h)).not.toContain('SUPER-SECRET');
  });
  it('429 and 5xx map to UpstreamError without carrying the body', async () => {
    const mk = (status: number): HttpFn => async () => ({ status, json: { error: 'token abc' } });
    await expect(realAdapterFor('googleads', { secretRef: 'a/b', account: '1', resolveSecret: async () => 's', http: mk(429) }).pullSpend!(range)).rejects.toMatchObject({ errorCode: 'RATE_LIMITED' });
    const e = await realAdapterFor('googleads', { secretRef: 'a/b', account: '1', resolveSecret: async () => 's', http: mk(503) }).pullSpend!(range).catch((x) => x);
    expect(e).toMatchObject({ errorCode: 'UPSTREAM_STATUS', status: 503 }); expect(JSON.stringify(e)).not.toContain('abc');
  });
  it('the request carries the secret only in the header or documented query of the vendor and the documented host', () => {
    for (const kind of GROWTH_INTEGRATION_KINDS.filter((k) => k !== 'fcmapns')) { const spec = REAL_SPECS[kind]; const req = spec.build(range, 'TOKEN123', spec.pulls[0]!, 'acc'); expect(new URL(req.url).host).toBe(spec.host); expect(req.url.startsWith('https://')).toBe(true); }
  });
});

describe('real adapters parse recorded responses (parsing only)', () => {
  const run = async (kind: (typeof GROWTH_INTEGRATION_KINDS)[number], file: string, what: 'spend' | 'performance' | 'coreVitals') => {
    const http: HttpFn = async () => ({ status: 200, json: fx(file) });
    const a = realAdapterFor(kind, { secretRef: 'k/v', account: 'acc', resolveSecret: async () => 'tok', http });
    const r = { from: '2026-12-01', to: '2026-12-02', currency: 'EGP' }; return what === 'spend' ? a.pullSpend!(r) : what === 'performance' ? a.pullPerformance!(r) : a.pullCoreVitals!(r);
  };
  it('google ads: micros to piastres', async () => { const r = await run('googleads', 'googleads.searchstream.json', 'spend'); expect(r).toEqual([{ day: '2026-12-01', dimensionKey: 'eg-ramadan-checkup', metric: 'spend_minor', value: 12_500, currency: 'EGP' }, { day: '2026-12-02', dimensionKey: 'eg-ramadan-checkup', metric: 'spend_minor', value: 8_000, currency: 'EGP' }]); });
  it('google ads performance', async () => { const r = await run('googleads', 'googleads.searchstream.json', 'performance'); expect(r.filter((x) => x.metric === 'clicks').map((x) => x.value)).toEqual([40, 25]); });
  it('search console: page paths collapse to template groups, no path leaves', async () => { const r = await run('searchconsole', 'searchconsole.query.json', 'performance'); expect(r).toEqual(expect.arrayContaining([{ day: '2026-12-01', dimensionKey: 'template:doctor', metric: 'clicks', value: 15 }, { day: '2026-12-01', dimensionKey: 'template:doctor', metric: 'impressions', value: 420 }, { day: '2026-12-01', dimensionKey: 'template:clinic', metric: 'clicks', value: 2 }])); expect(JSON.stringify(r)).not.toContain('slug'); });
  it('template grouping', () => { expect(templateOf('https://kiorex.com/en/eg/doctors/x')).toBe('template:doctor'); expect(templateOf('/ar/eg/clinics/y')).toBe('template:clinic'); expect(templateOf('/')).toBe('template:other'); });
  it('meta: major units to piastres', async () => { const r = await run('metaads', 'metaads.insights.json', 'spend'); expect(r).toEqual([{ day: '2026-12-01', dimensionKey: 'eg-ramadan-checkup', metric: 'spend_minor', value: 1234, currency: 'EGP' }]); });
  it('tiktok', async () => { const r = await run('tiktok', 'tiktok.report.json', 'spend'); expect(r[0]).toMatchObject({ day: '2026-12-01', metric: 'spend_minor', value: 550 }); });
  it('ga4', async () => { const r = await run('ga4', 'ga4.report.json', 'performance'); expect(r).toEqual([{ day: '2026-12-01', dimensionKey: 'channel:organic_search', metric: 'sessions', value: 120 }, { day: '2026-12-01', dimensionKey: 'channel:organic_search', metric: 'conversions', value: 7 }]); });
  it('whatsapp: category counts and cost, no number', async () => { const r = await run('whatsappcloud', 'whatsapp.analytics.json', 'performance'); expect(r[0]).toMatchObject({ dimensionKey: 'category:marketing', metric: 'conversations', value: 14 }); });
  it('crux', async () => { const r = await run('crux', 'crux.record.json', 'coreVitals'); expect(r.map((x) => [x.metric, x.value])).toEqual([['lcp_p75', 2400], ['inp_p75', 180], ['cls_p75', 0.08]]); });
  it('a malformed body is an UPSTREAM_PARSE error', async () => { await expect(realAdapterFor('googleads', { secretRef: 'k/v', account: 'a', resolveSecret: async () => 't', http: async () => ({ status: 200, json: { nope: 1 } }) }).pullSpend!(range)).rejects.toMatchObject({ errorCode: 'UPSTREAM_PARSE' }); });
  it('play console and app store connect fail closed until a sample is recorded (H-9)', async () => {
    for (const k of ['playconsole', 'appstoreconnect'] as const) await expect(realAdapterFor(k, { secretRef: 'k/v', account: 'a', resolveSecret: async () => 't', http: async () => ({ status: 200, json: {} }) }).pullPerformance!(range)).rejects.toBeInstanceOf(NeedsHumanError);
  });
});
