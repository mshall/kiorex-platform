import type { Alternate, Locale, PageQuery } from './url-policy';
import type { PageData } from './site-data.types';
import { sha256Base64 } from './headers';

/** Escape for HTML text and attribute values. */
export const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** JSON for a <script type="application/json|application/ld+json"> body: no `</script>` breakout, no U+2028/9. */
export const safeJson = (v: unknown): string => JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

export interface ClientAssets {
  /** Whole public stylesheet, inlined (critical CSS; it is small by budget). */
  css: string;
  script: string | null;
  modulePreloads: string[];
  fontPreloads: string[];
}

export interface DocumentInput {
  locale: Locale; cc: string; canonical: string; alternates: Alternate[]; indexable: boolean;
  title: string; description: string; ogImage: string; siteName: string;
  jsonLd: unknown[]; bodyHtml: string;
  state: { locale: Locale; cc: string; type: string; path: string; query: PageQuery; data: PageData; experiments?: Record<string, { experiment: string; variant: string }> };
  assets: ClientAssets;
  /** noindex even if the page is indexable (staging, flag OFF, fallbacks). */
  forceNoindex?: boolean;
  /** Search Console / Bing ownership meta tags (home page only; tokens come from configuration). */
  verification?: { google?: string | null; bing?: string | null };
}

export const robotsMeta = (indexable: boolean): string => (indexable ? 'index,follow,max-image-preview:large,max-snippet:-1' : 'noindex,follow');

export function composeDocument(i: DocumentInput): { html: string; styleHash: string } {
  const dir = i.locale === 'ar' ? 'rtl' : 'ltr';
  const styleHash = sha256Base64(i.assets.css);
  const ogLocale = i.locale === 'ar' ? 'ar_EG' : 'en_US';
  const altLocale = i.locale === 'ar' ? 'en_US' : 'ar_EG';
  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(i.title)}</title>`,
    `<meta name="description" content="${escapeHtml(i.description)}">`,
    `<meta name="robots" content="${robotsMeta(i.indexable && !i.forceNoindex)}">`,
    `<link rel="canonical" href="${escapeHtml(i.canonical)}">`,
    ...i.alternates.map((a) => `<link rel="alternate" hreflang="${escapeHtml(a.hreflang)}" href="${escapeHtml(a.href)}">`),
    '<meta name="theme-color" content="#3730A3">',
    `<meta property="og:type" content="website"><meta property="og:site_name" content="${escapeHtml(i.siteName)}">`,
    `<meta property="og:title" content="${escapeHtml(i.title)}"><meta property="og:description" content="${escapeHtml(i.description)}">`,
    `<meta property="og:url" content="${escapeHtml(i.canonical)}"><meta property="og:image" content="${escapeHtml(i.ogImage)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">`,
    `<meta property="og:locale" content="${ogLocale}"><meta property="og:locale:alternate" content="${altLocale}">`,
    `<meta property="og:image:alt" content="${escapeHtml(i.title)}">`,
    `<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(i.title)}"><meta name="twitter:description" content="${escapeHtml(i.description)}"><meta name="twitter:image" content="${escapeHtml(i.ogImage)}">`,
    ...(i.verification?.google ? [`<meta name="google-site-verification" content="${escapeHtml(i.verification.google)}">`] : []),
    ...(i.verification?.bing ? [`<meta name="msvalidate.01" content="${escapeHtml(i.verification.bing)}">`] : []),
    '<link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="manifest" href="/manifest.webmanifest">',
    ...i.assets.fontPreloads.map((f) => `<link rel="preload" as="font" type="font/woff2" href="${escapeHtml(f)}" crossorigin>`),
    ...i.assets.modulePreloads.map((m) => `<link rel="modulepreload" href="${escapeHtml(m)}">`),
    `<style>${i.assets.css}</style>`,
    ...i.jsonLd.map((j) => `<script type="application/ld+json">${safeJson(j)}</script>`),
  ].join('');
  const html = `<!doctype html><html lang="${i.locale}" dir="${dir}"><head>${head}</head><body><div id="root">${i.bodyHtml}</div><script type="application/json" id="kx-public-state">${safeJson(i.state)}</script>${i.assets.script ? `<script type="module" src="${escapeHtml(i.assets.script)}"></script>` : ''}</body></html>`;
  return { html, styleHash };
}
