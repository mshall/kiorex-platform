import { buildSitemapIndex, buildUrlset, parseShardName, shardName, SITEMAP_HARD_MAX_URLS } from './sitemap.xml';

describe('sitemap XML', () => {
  it('urlset carries lastmod and xhtml hreflang alternates, and escapes XML', () => {
    const xml = buildUrlset([{ loc: 'https://kiorex.com/en/eg/doctor/a-b?x=1&y=2', lastmod: new Date('2026-11-20T10:00:00Z'), alternates: [{ hreflang: 'ar', href: 'https://kiorex.com/ar/eg/doctor/a-b' }, { hreflang: 'x-default', href: 'https://kiorex.com/ar/eg/doctor/a-b' }] }]);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">');
    expect(xml).toContain('<loc>https://kiorex.com/en/eg/doctor/a-b?x=1&amp;y=2</loc>');
    expect(xml).toContain('<lastmod>2026-11-20T10:00:00.000Z</lastmod>');
    expect(xml).toContain('<xhtml:link rel="alternate" hreflang="x-default" href="https://kiorex.com/ar/eg/doctor/a-b"/>');
  });
  it('omits lastmod when unknown and refuses a shard over the size limit', () => {
    expect(buildUrlset([{ loc: 'https://kiorex.com/en/eg' }])).not.toContain('lastmod');
    const many = Array.from({ length: 3 }, (_, i) => ({ loc: `https://kiorex.com/${i}` }));
    expect(() => buildUrlset(many, 2)).toThrow(/exceeds 2/);
    expect(() => buildUrlset([], SITEMAP_HARD_MAX_URLS + 1)).not.toThrow(); // the cap is min(maxUrls, hard max), an empty set is fine
    expect(() => buildUrlset(Array.from({ length: SITEMAP_HARD_MAX_URLS + 1 }, (_, i) => ({ loc: `https://k/${i}` })), 1_000_000)).toThrow();
  });
  it('index lists shard locations with lastmod', () => {
    const xml = buildSitemapIndex([{ loc: 'https://kiorex.com/sitemaps/doctor-eg-en-1.xml', lastmod: new Date('2026-11-21T00:00:00Z') }, { loc: 'https://kiorex.com/sitemaps/hub-eg-ar-1.xml' }]);
    expect(xml).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain('<sitemap><loc>https://kiorex.com/sitemaps/doctor-eg-en-1.xml</loc><lastmod>2026-11-21T00:00:00.000Z</lastmod></sitemap>');
  });
  it('shard names round-trip and reject anything else (path traversal, wrong shape)', () => {
    expect(parseShardName(shardName('care-district', 'EG', 'ar', 12))).toEqual({ type: 'care-district', cc: 'eg', locale: 'ar', n: 12 });
    for (const bad of ['../x.xml', 'doctor-eg-en-1.txt', 'doctor-eg-fr-1.xml', 'Doctor-eg-en-1.xml', 'doctor-egg-en-1.xml', 'doctor-eg-en-.xml']) expect(parseShardName(bad)).toBeNull();
  });
});
