import { buildRobots } from './robots';
import { buildAasaFree } from './robots.testutil';

describe('robots.txt generation', () => {
  it('production: allow public namespaces and assets, disallow private paths, reference the sitemap index', () => {
    const t = buildRobots({ indexable: true, canonicalHost: 'https://kiorex.com/', locales: ['ar', 'en'] });
    expect(t).toContain('User-agent: *');
    expect(t).toContain('Allow: /ar/');
    expect(t).toContain('Allow: /en/');
    expect(t).toContain('Allow: /_p/');
    for (const p of ['/api/', '/auth/', '/account', '/appointments', '/checkout/', '/records', '/pharmacy', '/telemedicine', '/search', '/visit-status/']) expect(t).toContain(`Disallow: ${p}`);
    expect(t).toContain('Sitemap: https://kiorex.com/sitemap.xml');
    expect(t).not.toMatch(/^Disallow: \/$/m);
    expect(buildAasaFree(t)).toBe(true);
  });
  it('anything that is not production blocks all crawling and publishes no sitemap', () => {
    const t = buildRobots({ indexable: false, canonicalHost: 'https://www.staging.kiorex.com', locales: ['ar', 'en'] });
    expect(t).toMatch(/^User-agent: \*$/m);
    expect(t).toMatch(/^Disallow: \/$/m);
    expect(t).not.toContain('Allow:');
    expect(t).not.toContain('Sitemap:');
  });
});
