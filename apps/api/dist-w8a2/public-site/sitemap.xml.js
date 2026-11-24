"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shardName = exports.SHARD_NAME = exports.SITEMAP_HARD_MAX_BYTES = exports.SITEMAP_HARD_MAX_URLS = void 0;
exports.buildUrlset = buildUrlset;
exports.buildSitemapIndex = buildSitemapIndex;
exports.parseShardName = parseShardName;
exports.SITEMAP_HARD_MAX_URLS = 50_000;
exports.SITEMAP_HARD_MAX_BYTES = 50 * 1024 * 1024;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const iso = (d) => (d && !Number.isNaN(d.getTime()) ? `<lastmod>${d.toISOString()}</lastmod>` : '');
function buildUrlset(urls, maxUrls = 10_000) {
    if (urls.length > Math.min(maxUrls, exports.SITEMAP_HARD_MAX_URLS))
        throw new Error(`sitemap shard exceeds ${maxUrls} URLs`);
    const body = urls.map((u) => `<url><loc>${esc(u.loc)}</loc>${iso(u.lastmod)}${(u.alternates ?? []).map((a) => `<xhtml:link rel="alternate" hreflang="${esc(a.hreflang)}" href="${esc(a.href)}"/>`).join('')}</url>`).join('');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${body}</urlset>\n`;
    if (Buffer.byteLength(xml) > exports.SITEMAP_HARD_MAX_BYTES)
        throw new Error('sitemap shard exceeds 50 MB');
    return xml;
}
function buildSitemapIndex(refs) {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${refs.map((r) => `<sitemap><loc>${esc(r.loc)}</loc>${iso(r.lastmod)}</sitemap>`).join('')}</sitemapindex>\n`;
}
exports.SHARD_NAME = /^([a-z-]+)-([a-z]{2})-(ar|en)-(\d{1,4})\.xml$/;
const shardName = (type, cc, locale, n) => `${type}-${cc.toLowerCase()}-${locale}-${n}.xml`;
exports.shardName = shardName;
function parseShardName(file) {
    const m = exports.SHARD_NAME.exec(file);
    return m ? { type: m[1], cc: m[2], locale: m[3], n: Number(m[4]) } : null;
}
//# sourceMappingURL=sitemap.xml.js.map