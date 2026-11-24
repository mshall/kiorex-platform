/**
 * SEO audit against a RUNNING site (GRW-P1-F): crawls /sitemap.xml and every shard, fetches each URL and runs the same checks the CI test uses
 * (src/public-site/seo-audit.ts): status codes, head tags, canonical and hreflang consistency, JSON-LD validity and privacy, duplicate titles, broken
 * internal links and Core Web Vitals hygiene. Exit code 1 when any `error` is found.
 *
 *   npm run seo:audit -w apps/api -- --base http://localhost:4000 [--host https://kiorex.com] [--limit 500] [--no-links]
 *
 * `--base` is where to fetch from; `--host` is the canonical host the pages are expected to declare (default: SITE_CANONICAL_HOST or --base).
 * A non-production site (SITE_ENVIRONMENT != production) lists nothing in its sitemap, so the audit reports that instead of passing silently.
 */
import { auditPages, locsOf, type AuditPage } from '../src/public-site/seo-audit';

const arg = (n: string, d = ''): string => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? (process.argv[i + 1] ?? d) : d; };
const base = (arg('base') || 'http://localhost:4000').replace(/\/+$/, '');
const host = (arg('host') || process.env.SITE_CANONICAL_HOST || base).replace(/\/+$/, '');
const limit = Number(arg('limit', '5000'));
const links = !process.argv.includes('--no-links');

const rewrite = (u: string): string => u.replace(host, base);

async function main(): Promise<void> {
  const idx = await fetch(`${base}/sitemap.xml`);
  if (!idx.ok) throw new Error(`/sitemap.xml answered ${idx.status}`);
  const shards = locsOf(await idx.text());
  if (!shards.length) { console.error('The sitemap index is empty: the site is not production-indexable (SITE_ENVIRONMENT) or has no public pages. Nothing to audit.'); process.exit(2); }
  const urls: string[] = [];
  for (const s of shards) { const r = await fetch(rewrite(s)); if (!r.ok) throw new Error(`${s} answered ${r.status}`); urls.push(...locsOf(await r.text())); }
  const pages: AuditPage[] = [];
  for (const u of urls.slice(0, limit)) {
    const r = await fetch(rewrite(u));
    pages.push({ url: u, status: r.status, headers: Object.fromEntries(r.headers.entries()), html: await r.text() });
  }
  const issues = await auditPages(pages, { host, sitemapUrls: urls, ...(links ? { statusOf: async (p: string) => (await fetch(`${base}${p}`, { redirect: 'manual' })).status } : {}) });
  const errors = issues.filter((i) => i.severity === 'error');
  for (const i of issues) console.log(`${i.severity.toUpperCase().padEnd(5)} ${i.code.padEnd(24)} ${i.url}  ${i.message}`);
  console.log(`\n${pages.length} pages from ${shards.length} sitemap files: ${errors.length} errors, ${issues.length - errors.length} warnings`);
  process.exit(errors.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
