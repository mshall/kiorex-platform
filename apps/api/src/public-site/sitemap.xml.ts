import type { Alternate } from './url-policy';

/**
 * Sitemap XML builders (sitemaps.org 0.9 plus xhtml:link hreflang alternates, Google localized-versions guidance). Pure and size-checked:
 * at most `maxUrls` URLs per file (default 10,000, well under Google's 50,000 and 50 MB).
 */
export const SITEMAP_HARD_MAX_URLS = 50_000;
export const SITEMAP_HARD_MAX_BYTES = 50 * 1024 * 1024;

export interface SitemapUrl { loc: string; lastmod?: Date | null; alternates?: Alternate[] }
export interface SitemapRef { loc: string; lastmod?: Date | null }

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const iso = (d: Date | null | undefined): string => (d && !Number.isNaN(d.getTime()) ? `<lastmod>${d.toISOString()}</lastmod>` : '');

export function buildUrlset(urls: readonly SitemapUrl[], maxUrls = 10_000): string {
  if (urls.length > Math.min(maxUrls, SITEMAP_HARD_MAX_URLS)) throw new Error(`sitemap shard exceeds ${maxUrls} URLs`);
  const body = urls.map((u) => `<url><loc>${esc(u.loc)}</loc>${iso(u.lastmod)}${(u.alternates ?? []).map((a) => `<xhtml:link rel="alternate" hreflang="${esc(a.hreflang)}" href="${esc(a.href)}"/>`).join('')}</url>`).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${body}</urlset>\n`;
  if (Buffer.byteLength(xml) > SITEMAP_HARD_MAX_BYTES) throw new Error('sitemap shard exceeds 50 MB');
  return xml;
}

export function buildSitemapIndex(refs: readonly SitemapRef[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${refs.map((r) => `<sitemap><loc>${esc(r.loc)}</loc>${iso(r.lastmod)}</sitemap>`).join('')}</sitemapindex>\n`;
}

/** Shard file name: `{type}-{cc}-{locale}-{n}.xml` (n starts at 1). */
export const SHARD_NAME = /^([a-z-]+)-([a-z]{2})-(ar|en)-(\d{1,4})\.xml$/;
export const shardName = (type: string, cc: string, locale: string, n: number): string => `${type}-${cc.toLowerCase()}-${locale}-${n}.xml`;
export function parseShardName(file: string): { type: string; cc: string; locale: 'ar' | 'en'; n: number } | null {
  const m = SHARD_NAME.exec(file);
  return m ? { type: m[1]!, cc: m[2]!, locale: m[3] as 'ar' | 'en', n: Number(m[4]) } : null;
}
