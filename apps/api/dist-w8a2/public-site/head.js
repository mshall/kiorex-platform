"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.robotsMeta = exports.safeJson = exports.escapeHtml = void 0;
exports.composeDocument = composeDocument;
const headers_1 = require("./headers");
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
exports.escapeHtml = escapeHtml;
const safeJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
exports.safeJson = safeJson;
const robotsMeta = (indexable) => (indexable ? 'index,follow,max-image-preview:large,max-snippet:-1' : 'noindex,follow');
exports.robotsMeta = robotsMeta;
function composeDocument(i) {
    const dir = i.locale === 'ar' ? 'rtl' : 'ltr';
    const styleHash = (0, headers_1.sha256Base64)(i.assets.css);
    const ogLocale = i.locale === 'ar' ? 'ar_EG' : 'en_US';
    const altLocale = i.locale === 'ar' ? 'en_US' : 'ar_EG';
    const head = [
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        `<title>${(0, exports.escapeHtml)(i.title)}</title>`,
        `<meta name="description" content="${(0, exports.escapeHtml)(i.description)}">`,
        `<meta name="robots" content="${(0, exports.robotsMeta)(i.indexable && !i.forceNoindex)}">`,
        `<link rel="canonical" href="${(0, exports.escapeHtml)(i.canonical)}">`,
        ...i.alternates.map((a) => `<link rel="alternate" hreflang="${(0, exports.escapeHtml)(a.hreflang)}" href="${(0, exports.escapeHtml)(a.href)}">`),
        '<meta name="theme-color" content="#3730A3">',
        `<meta property="og:type" content="website"><meta property="og:site_name" content="${(0, exports.escapeHtml)(i.siteName)}">`,
        `<meta property="og:title" content="${(0, exports.escapeHtml)(i.title)}"><meta property="og:description" content="${(0, exports.escapeHtml)(i.description)}">`,
        `<meta property="og:url" content="${(0, exports.escapeHtml)(i.canonical)}"><meta property="og:image" content="${(0, exports.escapeHtml)(i.ogImage)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">`,
        `<meta property="og:locale" content="${ogLocale}"><meta property="og:locale:alternate" content="${altLocale}">`,
        `<meta property="og:image:alt" content="${(0, exports.escapeHtml)(i.title)}">`,
        `<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${(0, exports.escapeHtml)(i.title)}"><meta name="twitter:description" content="${(0, exports.escapeHtml)(i.description)}"><meta name="twitter:image" content="${(0, exports.escapeHtml)(i.ogImage)}">`,
        ...(i.verification?.google ? [`<meta name="google-site-verification" content="${(0, exports.escapeHtml)(i.verification.google)}">`] : []),
        ...(i.verification?.bing ? [`<meta name="msvalidate.01" content="${(0, exports.escapeHtml)(i.verification.bing)}">`] : []),
        '<link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="manifest" href="/manifest.webmanifest">',
        ...i.assets.fontPreloads.map((f) => `<link rel="preload" as="font" type="font/woff2" href="${(0, exports.escapeHtml)(f)}" crossorigin>`),
        ...i.assets.modulePreloads.map((m) => `<link rel="modulepreload" href="${(0, exports.escapeHtml)(m)}">`),
        `<style>${i.assets.css}</style>`,
        ...i.jsonLd.map((j) => `<script type="application/ld+json">${(0, exports.safeJson)(j)}</script>`),
    ].join('');
    const html = `<!doctype html><html lang="${i.locale}" dir="${dir}"><head>${head}</head><body><div id="root">${i.bodyHtml}</div><script type="application/json" id="kx-public-state">${(0, exports.safeJson)(i.state)}</script>${i.assets.script ? `<script type="module" src="${(0, exports.escapeHtml)(i.assets.script)}"></script>` : ''}</body></html>`;
    return { html, styleHash };
}
//# sourceMappingURL=head.js.map