import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { auditPages, jsonLdIssues, JSONLD_ALLOWED_TYPES, JSONLD_FORBIDDEN_KEYS, locsOf, parseHead, type AuditPage } from './seo-audit';

const HOST = 'https://kiorex.test';
const page = (url: string, over: Partial<{ title: string; desc: string; canonical: string; robots: string; alts: [string, string][]; jsonLd: unknown[]; body: string; lang: string; dir: string }> = {}): AuditPage => {
  const loc = /\/(ar|en)\//.exec(url)![1]!;
  const alts = over.alts ?? [['ar', url.replace('/en/', '/ar/')], ['en', url.replace('/ar/', '/en/')], ['x-default', url.replace('/en/', '/ar/')]];
  const html = `<!doctype html><html lang="${over.lang ?? loc}" dir="${over.dir ?? (loc === 'ar' ? 'rtl' : 'ltr')}"><head><meta charset="utf-8"><title>${over.title ?? `Title ${url}`}</title><meta name="description" content="${over.desc ?? `Desc ${url}`}"><meta name="robots" content="${over.robots ?? 'index,follow'}"><link rel="canonical" href="${over.canonical ?? url}">${alts.map(([l, h]) => `<link rel="alternate" hreflang="${l}" href="${h}">`).join('')}<meta property="og:title" content="t"><meta property="og:description" content="d"><meta property="og:url" content="${over.canonical ?? url}"><meta property="og:image" content="${HOST}/og.png"><meta name="twitter:card" content="summary_large_image"><style>a{}</style>${(over.jsonLd ?? []).map((j) => `<script type="application/ld+json">${JSON.stringify(j)}</script>`).join('')}</head><body><div id="root"><h1>H</h1>${over.body ?? ''}</div></body></html>`;
  return { url, status: 200, headers: {}, html };
};
const pair = (path: string, o: Parameters<typeof page>[1] = {}) => [page(`${HOST}/ar/eg${path}`, o), page(`${HOST}/en/eg${path}`, o)];
const urlsOf = (ps: AuditPage[]) => ps.map((p) => p.url);
const codes = (xs: { code: string }[]) => [...new Set(xs.map((x) => x.code))].sort();

describe('SEO audit', () => {
  it('a consistent pair of pages has no issue', async () => {
    const ps = [...pair('', { title: 'A', desc: 'a' }), ...pair('/doctors/cardiology', { title: 'B', desc: 'b' })];
    // distinct titles per locale are required, so give each page its own
    const fixed = ps.map((p, i) => ({ ...p, html: p.html.replace(/<title>[^<]*<\/title>/, `<title>T${i}</title>`).replace(/(name="description" content=")[^"]*/, `$1D${i}`) }));
    expect(await auditPages(fixed, { host: HOST, sitemapUrls: urlsOf(fixed) })).toEqual([]);
  });
  it('flags canonical, hreflang, robots, lang and head problems', async () => {
    const [ar, en] = pair('/x');
    const bad = { ...en, html: en.html.replace(`<link rel="canonical" href="${en.url}">`, '<link rel="canonical" href="https://elsewhere.test/">').replace('index,follow', 'noindex,follow').replace(/<link rel="alternate" hreflang="x-default"[^>]*>/, '').replace('lang="en" dir="ltr"', 'lang="ar" dir="rtl"').replace('<meta name="twitter:card" content="summary_large_image">', '') };
    const c = codes(await auditPages([ar!, bad], { host: HOST, sitemapUrls: [ar!.url] }));
    expect(c).toEqual(expect.arrayContaining(['CANONICAL', 'SITEMAP_NOINDEX', 'HREFLANG_MISSING', 'LANG_DIR', 'TWITTER_CARD', 'OG_URL', 'HREFLANG_NOT_IN_SITEMAP']));
  });
  it('flags non-reciprocal hreflang and non-200 sitemap URLs', async () => {
    const [ar, en] = pair('/y');
    const oneWay = { ...ar!, html: ar!.html.replace(`href="${en!.url}"`, `href="${HOST}/en/eg/other"`) };
    expect(codes(await auditPages([oneWay, en!], { host: HOST, sitemapUrls: urlsOf([ar!, en!]) }))).toContain('HREFLANG_RECIPROCAL');
    expect(codes(await auditPages([{ ...en!, status: 404 }], { host: HOST, sitemapUrls: [en!.url] }))).toEqual(['STATUS']);
  });
  it('flags duplicate titles inside one locale and long titles or descriptions', async () => {
    const a = page(`${HOST}/en/eg/a`, { title: 'Same', desc: 'same desc' }); const b = page(`${HOST}/en/eg/b`, { title: 'Same', desc: 'same desc' });
    const long = page(`${HOST}/en/eg/c`, { title: 'x'.repeat(70), desc: 'y'.repeat(200) });
    const out = await auditPages([a, b, long], { host: HOST, sitemapUrls: urlsOf([a, b, long]) });
    expect(codes(out)).toEqual(expect.arrayContaining(['DUPLICATE_TITLE', 'DUPLICATE_DESCRIPTION', 'TITLE_LONG', 'DESCRIPTION_LONG']));
  });
  it('validates JSON-LD: forbidden fields, foreign types, bad ratings, parse errors, links outside the host', async () => {
    const bad = page(`${HOST}/en/eg/z`, { jsonLd: [{ '@context': 'https://schema.org', '@type': 'Physician', name: 'x', telephone: '+20100', url: 'https://evil.test/x' }, { '@context': 'https://schema.org', '@type': 'Product' }, { '@context': 'https://schema.org', '@type': 'AggregateRating', ratingValue: 7, reviewCount: 0 }] });
    const broken = { ...page(`${HOST}/en/eg/w`), html: page(`${HOST}/en/eg/w`).html.replace('</head>', '<script type="application/ld+json">{nope</script></head>') };
    const out = await auditPages([bad, broken], { host: HOST, sitemapUrls: urlsOf([bad, broken]) });
    const msgs = out.filter((i) => i.code.startsWith('JSONLD')).map((i) => i.message).join('|');
    expect(msgs).toMatch(/telephone is forbidden/);
    expect(msgs).toMatch(/Product is not allowed/);
    expect(msgs).toMatch(/AggregateRating is not valid/);
    expect(msgs).toMatch(/points outside/);
    expect(out.map((i) => i.code)).toContain('JSONLD_PARSE');
    expect(jsonLdIssues({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1 }] }, HOST)).toContain('BreadcrumbList needs at least two items');
  });
  it('finds broken and redirecting internal links, and skips SPA and private paths', async () => {
    const p = page(`${HOST}/en/eg/links`, { body: '<a href="/en/eg/gone">x</a><a href="/en/eg/moved?page=2#t">y</a><a href="/en/eg/ok">z</a><a href="/search?q=a">s</a><a href="/doctors/1?book=1">b</a>' });
    const asked: string[] = [];
    const out = await auditPages([p], { host: HOST, sitemapUrls: [p.url], statusOf: async (path) => { asked.push(path); return path === '/en/eg/gone' ? 404 : path === '/en/eg/moved' ? 301 : 200; } });
    expect(out.filter((i) => i.code === 'BROKEN_LINK')).toHaveLength(1);
    expect(out.filter((i) => i.code === 'REDIRECTING_LINK')).toHaveLength(1);
    expect(asked.sort()).toEqual(['/en/eg/gone', '/en/eg/moved', '/en/eg/ok']);
  });
  it('Core Web Vitals hygiene: image size and alt, one eager image, blocking resources', async () => {
    const p = page(`${HOST}/en/eg/cwv`, { body: '<img src="https://i.test/a.jpg" alt="a" width="96" height="96" loading="eager" fetchpriority="high"><img src="https://i.test/b.jpg" alt="b" width="9" height="9" loading="eager"><img src="https://i.test/c.jpg" width="1">' });
    const html = p.html.replace('</head>', '<link rel="stylesheet" href="/x.css"><script src="/x.js"></script></head>');
    const c = codes(await auditPages([{ ...p, html }], { host: HOST, sitemapUrls: [p.url] }));
    expect(c).toEqual(expect.arrayContaining(['CWV_IMG_DIMENSIONS', 'IMG_ALT', 'CWV_EAGER_IMAGES', 'CWV_BLOCKING_CSS', 'CWV_BLOCKING_JS']));
  });
  it('parses sitemap locs and head tags', () => {
    expect(locsOf('<urlset><url><loc>https://a.test/x?a=1&amp;b=2</loc></url></urlset>')).toEqual(['https://a.test/x?a=1&b=2']);
    const h = parseHead(page(`${HOST}/ar/eg/p`, { title: 'عنوان &amp; x' }).html);
    expect(h.title).toBe('عنوان & x');
    expect(h.h1).toEqual(['H']);
  });
  it('keeps the JSON-LD rule lists identical to the web template builders', () => {
    const src = readFileSync(join(__dirname, '../../../web/src/public/seo/jsonld.ts'), 'utf8');
    const list = (name: string) => [...new RegExp(`${name} = \\[([^\\]]+)\\]`).exec(src)![1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(list('ALLOWED_TYPES')).toEqual([...JSONLD_ALLOWED_TYPES]);
    expect(list('FORBIDDEN_KEYS')).toEqual([...JSONLD_FORBIDDEN_KEYS]);
  });
});
