import { composeDocument, escapeHtml, robotsMeta, safeJson } from './head';

const base = { locale: 'ar' as const, cc: 'eg', canonical: 'https://kiorex.com/ar/eg', alternates: [{ hreflang: 'ar', href: 'https://kiorex.com/ar/eg' }], indexable: true, title: 'T "q" <b>', description: 'D & d', ogImage: 'https://kiorex.com/og-image.png', siteName: 'Kiorex', jsonLd: [{ '@type': 'Thing', name: '</script><script>alert(1)</script>' }], bodyHtml: '<h1>x</h1>', state: { locale: 'ar' as const, cc: 'eg', type: 'home', path: '/ar/eg', query: { page: 1, sort: null }, data: { kind: 'not-found' as const, reason: '</script>' } }, assets: { css: 'a{b:c}', script: '/_p/assets/e.js', modulePreloads: [], fontPreloads: ['/_p/assets/f.woff2'] } };

describe('document composer', () => {
  it('escapes attributes and cannot be broken out of by data inside JSON-LD or the hydration state', () => {
    const { html } = composeDocument(base);
    expect(html).toContain('<title>T &quot;q&quot; &lt;b&gt;</title>');
    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect((html.match(/<\/script>/g) ?? []).length).toBe(3); // ld+json, state, entry: no injected closer
    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('<link rel="preload" as="font" type="font/woff2" href="/_p/assets/f.woff2" crossorigin>');
    expect(html).toContain('<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">');
  });
  it('noindex when not indexable or forced; english is ltr; the style hash matches the inline CSS', () => {
    expect(composeDocument({ ...base, indexable: false }).html).toContain('content="noindex,follow"');
    expect(composeDocument({ ...base, forceNoindex: true }).html).toContain('content="noindex,follow"');
    const { html, styleHash } = composeDocument({ ...base, locale: 'en' });
    expect(html).toContain('<html lang="en" dir="ltr">');
    expect(styleHash).toBe(require('node:crypto').createHash('sha256').update('a{b:c}').digest('base64'));
  });
  it('helpers', () => {
    expect(escapeHtml(`<a href="x">'&`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
    expect(safeJson({ a: '<>&\u2028' })).not.toMatch(/[<>&\u2028]/);
    expect(robotsMeta(false)).toBe('noindex,follow');
  });
});
