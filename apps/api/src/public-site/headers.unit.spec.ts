import { contentSecurityPolicy, etagMatches, etagOf, publicCacheControl, securityHeaders, sha256Base64 } from './headers';

describe('public site headers (ADR-038: public pages are never framed)', () => {
  it('frame-ancestors none and X-Frame-Options DENY by default; the CSP is hash based for inline style, no unsafe-inline, no inline script', () => {
    const h = securityHeaders({ styleHashes: [sha256Base64('a{b:c}')] });
    expect(h['X-Frame-Options']).toBe('DENY');
    expect(h['Content-Security-Policy']).toContain("frame-ancestors 'none'");
    expect(h['Content-Security-Policy']).toMatch(/style-src 'self' 'sha256-[A-Za-z0-9+/=]+'/);
    expect(h['Content-Security-Policy']).not.toContain('unsafe-inline');
    expect(h['Content-Security-Policy']).toContain("script-src 'self';");
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(h['Strict-Transport-Security']).toMatch(/max-age=31536000/);
  });
  it('only an explicit ancestor list (the widget host, ADR-044) lifts the frame ban', () => {
    const h = securityHeaders({ styleHashes: [], frameAncestors: ['https://clinic.example'] });
    expect(h['Content-Security-Policy']).toContain('frame-ancestors https://clinic.example');
    expect(h['X-Frame-Options']).toBeUndefined();
    expect(contentSecurityPolicy({ styleHashes: [] })).toContain("frame-ancestors 'none'");
  });
  it('Cache-Control is CloudFront friendly: shared max-age with stale-while-revalidate, browsers revalidate', () => {
    expect(publicCacheControl({ sMaxAge: 300, staleWhileRevalidate: 3600 })).toBe('public, max-age=0, s-maxage=300, stale-while-revalidate=3600');
  });
  it('ETag is weak and stable; If-None-Match uses weak comparison, lists and *', () => {
    const e = etagOf('<html>a</html>');
    expect(e).toBe(etagOf('<html>a</html>'));
    expect(e).not.toBe(etagOf('<html>b</html>'));
    expect(e).toMatch(/^W\/"/);
    expect(etagMatches(e, e)).toBe(true);
    expect(etagMatches(`"x", ${e}`, e)).toBe(true);
    expect(etagMatches(e.replace('W/', ''), e)).toBe(true);
    expect(etagMatches('*', e)).toBe(true);
    expect(etagMatches('W/"other"', e)).toBe(false);
    expect(etagMatches(undefined, e)).toBe(false);
  });
});
