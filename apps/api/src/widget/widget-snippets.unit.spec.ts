import { snippetsFor } from './widget-snippets';

describe('widget embed snippets (GRW-P1-G)', () => {
  const base = { base: 'https://book.kiorex.com/', slug: 'dr-amira', locale: 'ar' as const };
  it('rolling script and iframe point at the real SDK and embed URLs of the widget host', () => {
    const s = snippetsFor(base);
    expect(s.script).toContain('<script src="https://book.kiorex.com/v1/sdk.js" async></script>');
    expect(s.script).toContain('data-kx-widget data-org="dr-amira"');
    expect(s.iframe).toContain('src="https://book.kiorex.com/v1/embed/dr-amira?locale=ar"');
    expect(s.scriptPinned).toBeNull();
  });
  it('pinned variant carries the SRI hash and crossorigin', () => {
    const s = snippetsFor({ ...base, sdkPath: '/v1/0123456789abcdef/sdk.js', integrity: 'sha384-AAAA' });
    expect(s.scriptPinned).toContain('src="https://book.kiorex.com/v1/0123456789abcdef/sdk.js" integrity="sha384-AAAA" crossorigin="anonymous"');
  });
  it('values are escaped', () => {
    const s = snippetsFor({ ...base, slug: 'x"><script>', doctor: 'd"<' });
    expect(s.script).not.toContain('<script>alert');
    expect(s.script).toContain('&quot;&gt;&lt;script&gt;');
  });
});
