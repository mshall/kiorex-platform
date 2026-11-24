import { MockSearchEngine, SearchEngineService, UnconfiguredRealSearchEngine, verificationCfg } from './search-engines';

const KEYS = ['SITE_GOOGLE_SITE_VERIFICATION', 'SITE_BING_SITE_VERIFICATION', 'SITE_GOOGLE_VERIFICATION_FILE', 'SITE_BING_AUTH_USER', 'SITE_SEARCH_ENGINE_MODE'];
const saved: Record<string, string | undefined> = {};
beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

describe('search engine verification and integration scaffolding', () => {
  it('nothing is rendered or served without configuration', () => {
    expect(verificationCfg()).toEqual({ googleMeta: null, bingMeta: null, googleFile: null, bingAuthXml: null });
  });
  it('tokens come from configuration and are validated (no markup injection)', () => {
    process.env.SITE_GOOGLE_SITE_VERIFICATION = 'abc123_DEF-456xyz';
    process.env.SITE_BING_SITE_VERIFICATION = '"><script>alert(1)</script>';
    process.env.SITE_GOOGLE_VERIFICATION_FILE = 'google0123456789abcdef.html';
    process.env.SITE_BING_AUTH_USER = '0123456789ABCDEF0123456789ABCDEF';
    const v = verificationCfg();
    expect(v.googleMeta).toBe('abc123_DEF-456xyz');
    expect(v.bingMeta).toBeNull();
    expect(v.googleFile).toEqual({ name: 'google0123456789abcdef.html', body: 'google-site-verification: google0123456789abcdef.html' });
    expect(v.bingAuthXml).toContain('<user>0123456789ABCDEF0123456789ABCDEF</user>');
    process.env.SITE_GOOGLE_VERIFICATION_FILE = '../../etc/passwd';
    expect(verificationCfg().googleFile).toBeNull();
  });
  it('mock mode is the default: submissions are recorded, performance rows are labelled as samples', async () => {
    const s = new SearchEngineService();
    expect(s.mode).toBe('mock');
    const r = await s.submitSitemap();
    expect(r.map((x) => [x.engine, x.mode, x.accepted])).toEqual([['google', 'mock', true], ['bing', 'mock', true]]);
    expect(r[0]!.note).toMatch(/MOCK/);
    expect(s.recent()).toHaveLength(2);
    const perf = await s.performance();
    expect(perf.length).toBeGreaterThan(0);
    expect(perf.every((p) => p.sample)).toBe(true);
  });
  it('real mode refuses instead of pretending (NEEDS_HUMAN)', async () => {
    process.env.SITE_SEARCH_ENGINE_MODE = 'real';
    const s = new SearchEngineService();
    expect(s.mode).toBe('real');
    await expect(s.submitSitemap()).rejects.toThrow(/not implemented/);
    await expect(new UnconfiguredRealSearchEngine('bing').performance()).rejects.toThrow(/NEEDS_HUMAN/);
    expect(await new MockSearchEngine('google').performance()).toHaveLength(6);
  });
});
