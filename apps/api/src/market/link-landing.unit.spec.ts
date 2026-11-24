import { esc, landingHeaders, renderLanding, safeStoreUrl, safeWebOrigin, type LandingInput } from './link-landing';

const base: LandingInput = { kind: 'referral', value: 'AB12CD34', locale: 'en', cc: 'eg', webUrl: 'https://kiorex.com/?ref=AB12CD34', iosStoreUrl: 'https://apps.apple.com/app/id1', androidStoreUrl: 'https://play.google.com/store/apps/details?id=com.kiorex.app', nonce: 'n0nce', draftMarker: true };

describe('link landing page (GRW-P1-H)', () => {
  it('escapes everything and builds targets only from validated parts', () => {
    expect(esc(`<"'&\`>`)).toBe('&lt;&quot;&#39;&amp;&#96;&gt;');
    const html = renderLanding({ ...base, value: '"><script>x</script>' });
    expect(html).not.toContain('<script>x</script>');
  });
  it('no referrer parameter and no touch before consent: the base Play URL is plain and the fetch only exists inside the Allow handler', () => {
    const html = renderLanding(base);
    expect(html).toContain('href="https://play.google.com/store/apps/details?id=com.kiorex.app"');
    expect(html).not.toMatch(/href="[^"]*referrer=/);
    const script = html.slice(html.indexOf('<script'));
    expect(script.indexOf('fetch(')).toBeGreaterThan(script.indexOf("getElementById('allow').addEventListener"));
    expect(html).toContain('id="decline"'); // equal-weight decline
  });
  it('appointment links carry no consent block and no touch', () => {
    const html = renderLanding({ ...base, kind: 'appointment', value: 'apt123', webUrl: 'https://kiorex.com/appointments/apt123' });
    expect(html).not.toContain('id="allow"');
    expect(html).not.toContain('referrer-kind');
    expect(html).toContain('kiorex://appointment/apt123');
  });
  it('arabic page is rtl', () => { expect(renderLanding({ ...base, locale: 'ar' })).toContain('dir="rtl"'); });
  it('store and web destinations are allow-listed', () => {
    expect(safeStoreUrl('https://evil.example/app', 'ios')).toBeNull();
    expect(safeStoreUrl('http://apps.apple.com/app/id1', 'ios')).toBeNull();
    expect(safeStoreUrl('https://apps.apple.com.evil.example/x', 'ios')).toBeNull();
    expect(safeStoreUrl('https://user:pw@play.google.com/x', 'android')).toBeNull();
    expect(safeStoreUrl('https://play.google.com/store/apps/details?id=com.kiorex.app', 'android')).not.toBeNull();
    expect(safeWebOrigin('https://kiorex.com', true)).toBe('https://kiorex.com');
    expect(safeWebOrigin('http://localhost:5180', true)).toBeNull();
    expect(safeWebOrigin('http://localhost:5180', false)).toBe('http://localhost:5180');
    expect(safeWebOrigin('https://kiorex.com/path?x=1', true)).toBeNull();
  });
  it('security headers: nonce only CSP, no referrer, no store, noindex, no framing', () => {
    const h = landingHeaders('abc');
    expect(h['Content-Security-Policy']).toContain("script-src 'nonce-abc'");
    expect(h['Content-Security-Policy']).toContain("frame-ancestors 'none'");
    expect(h['Content-Security-Policy']).not.toContain('unsafe-inline');
    expect(h['Referrer-Policy']).toBe('no-referrer'); expect(h['Cache-Control']).toBe('no-store'); expect(h['X-Robots-Tag']).toContain('noindex');
  });
});
