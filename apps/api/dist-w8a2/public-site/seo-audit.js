"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.locsOf = exports.JSONLD_FORBIDDEN_KEYS = exports.JSONLD_ALLOWED_TYPES = void 0;
exports.parseHead = parseHead;
exports.jsonLdIssues = jsonLdIssues;
exports.auditPages = auditPages;
const attr = (tag, name) => { const m = new RegExp(`\\s${name}=("([^"]*)"|'([^']*)')`, 'i').exec(tag); return m ? (m[2] ?? m[3] ?? '') : null; };
const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function parseHead(html) {
    const head = /<head>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? '';
    const metas = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
    const byName = (n) => unesc(attr(metas.find((m) => attr(m, 'name') === n) ?? '', 'content') ?? '');
    const prop = (p) => unesc(attr(metas.find((m) => attr(m, 'property') === p) ?? '', 'content') ?? '');
    const links = [...head.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
    const og = {};
    const twitter = {};
    for (const m of metas) {
        const p = attr(m, 'property');
        const n = attr(m, 'name');
        if (p?.startsWith('og:'))
            og[p.slice(3)] ??= unesc(attr(m, 'content') ?? '');
        if (n?.startsWith('twitter:'))
            twitter[n.slice(8)] = unesc(attr(m, 'content') ?? '');
    }
    const jsonLd = [...head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)].map((m) => {
        const raw = m[1];
        try {
            return { raw, value: JSON.parse(raw.replace(/\\u003c/g, '<').replace(/\\u003e/g, '>').replace(/\\u0026/g, '&')) };
        }
        catch (e) {
            return { raw, value: null, error: e.message };
        }
    });
    const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
    const main = body.replace(/<script[\s\S]*?<\/script>/gi, '');
    return {
        title: unesc(/<title>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? ''), description: byName('description'), robots: byName('robots'),
        canonical: unesc(attr(links.find((l) => attr(l, 'rel') === 'canonical') ?? '', 'href') ?? ''),
        alternates: links.filter((l) => attr(l, 'rel') === 'alternate' && attr(l, 'hreflang')).map((l) => ({ hreflang: attr(l, 'hreflang'), href: unesc(attr(l, 'href') ?? '') })),
        og, twitter, jsonLd,
        h1: [...main.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => unesc(m[1].replace(/<[^>]+>/g, '').trim())),
        lang: /<html[^>]*\slang="([^"]*)"/i.exec(html)?.[1] ?? '', dir: /<html[^>]*\sdir="([^"]*)"/i.exec(html)?.[1] ?? '',
        links: [...main.matchAll(/<a\b[^>]*\shref="([^"]+)"/gi)].map((m) => unesc(m[1])),
        images: [...main.matchAll(/<img\b[^>]*>/gi)].map((m) => ({ src: attr(m[0], 'src') ?? '', width: attr(m[0], 'width'), height: attr(m[0], 'height'), alt: attr(m[0], 'alt'), loading: attr(m[0], 'loading'), fetchpriority: attr(m[0], 'fetchpriority') })),
        blockingStylesheets: links.filter((l) => attr(l, 'rel') === 'stylesheet').length,
        blockingScripts: [...html.matchAll(/<script\b[^>]*\ssrc=[^>]*>/gi)].filter((m) => !/\stype="module"|\sasync|\sdefer/i.test(m[0])).length,
    };
}
exports.JSONLD_ALLOWED_TYPES = ['Organization', 'WebSite', 'BreadcrumbList', 'ListItem', 'CollectionPage', 'ItemList', 'Physician', 'Dentist', 'MedicalBusiness', 'MedicalClinic', 'Pharmacy', 'PostalAddress', 'AggregateRating', 'ImageObject'];
exports.JSONLD_FORBIDDEN_KEYS = ['telephone', 'email', 'faxNumber', 'streetAddress', 'postalCode', 'geo', 'latitude', 'longitude', 'hasMap', 'openingHours', 'openingHoursSpecification', 'review', 'priceRange', 'paymentAccepted', 'medicalAudience', 'healthPlanNetworkId', 'isAcceptingNewPatientsFrom', 'sameAs'];
function jsonLdIssues(block, host) {
    const out = [];
    const walk = (v, path) => {
        if (Array.isArray(v))
            return v.forEach((x, i) => walk(x, `${path}[${i}]`));
        if (!v || typeof v !== 'object')
            return;
        const o = v;
        for (const k of Object.keys(o)) {
            if (exports.JSONLD_FORBIDDEN_KEYS.includes(k))
                out.push(`${path}.${k} is forbidden`);
            walk(o[k], `${path}.${k}`);
        }
        const t = o['@type'];
        if (typeof t === 'string' && !exports.JSONLD_ALLOWED_TYPES.includes(t))
            out.push(`${path} type ${t} is not allowed`);
        if (t === 'AggregateRating' && !(Number(o.ratingValue) >= 1 && Number(o.ratingValue) <= 5 && Number(o.reviewCount) > 0))
            out.push(`${path} AggregateRating is not valid`);
        for (const k of ['url', 'item'])
            if (typeof o[k] === 'string' && /^https?:\/\//.test(o[k]) && !o[k].startsWith(host))
                out.push(`${path}.${k} points outside ${host}`);
    };
    const r = block;
    if (!r || r['@context'] !== 'https://schema.org')
        out.push('@context must be https://schema.org');
    if (!r || typeof r['@type'] !== 'string')
        out.push('@type is required');
    walk(block, '$');
    if (r?.['@type'] === 'BreadcrumbList' && !(Array.isArray(r.itemListElement) && r.itemListElement.length >= 2))
        out.push('BreadcrumbList needs at least two items');
    return out;
}
const PRIVATE_HREF = /^\/(search|doctors\/|pharmacy|lab(\/|$)|account|appointments|checkout|records|auth|telemedicine|services|waitlist|care-plans|notifications|preferences|_p\/|_site\/|api\/)/;
const isNamespace = (p) => /^\/(ar|en)\/[a-z]{2}(\/|$)/.test(p);
const path = (u, host) => u.replace(host, '');
async function auditPages(pages, o) {
    const issues = [];
    const add = (code, url, message, severity = 'error') => issues.push({ code, url, message, severity });
    const maxHtml = o.maxHtmlBytes ?? 200_000;
    const listed = new Set(o.sitemapUrls);
    const byUrl = new Map(pages.map((p) => [p.url, { p, h: p.status === 200 ? parseHead(p.html) : null }]));
    const titles = new Map();
    const descriptions = new Map();
    for (const { p, h } of byUrl.values()) {
        const where = path(p.url, o.host);
        if (p.status !== 200 || !h) {
            add('STATUS', p.url, `sitemap URL answered ${p.status}`);
            continue;
        }
        const loc = /^\/(ar|en)\//.exec(where)?.[1] ?? '';
        if (!h.title)
            add('TITLE_MISSING', p.url, 'no <title>');
        else if (h.title.length > 60)
            add('TITLE_LONG', p.url, `title is ${h.title.length} characters`);
        if (!h.description)
            add('DESCRIPTION_MISSING', p.url, 'no meta description');
        else if (h.description.length > 155)
            add('DESCRIPTION_LONG', p.url, `description is ${h.description.length} characters`);
        if (/noindex/i.test(h.robots) || /noindex/i.test(p.headers['x-robots-tag'] ?? ''))
            add('SITEMAP_NOINDEX', p.url, 'a sitemap URL must be indexable');
        if (h.canonical !== p.url)
            add('CANONICAL', p.url, `canonical is ${h.canonical || 'missing'}`);
        if (h.lang !== loc || h.dir !== (loc === 'ar' ? 'rtl' : 'ltr'))
            add('LANG_DIR', p.url, `lang=${h.lang} dir=${h.dir} for locale ${loc}`);
        if (h.h1.length !== 1)
            add('H1', p.url, `${h.h1.length} h1 elements`);
        for (const k of ['title', 'description', 'url', 'image'])
            if (!h.og[k])
                add('OG_MISSING', p.url, `og:${k} missing`);
        if (h.twitter.card !== 'summary_large_image')
            add('TWITTER_CARD', p.url, 'twitter:card missing');
        if (h.og.url !== h.canonical)
            add('OG_URL', p.url, 'og:url differs from the canonical');
        const alt = new Map(h.alternates.map((a) => [a.hreflang, a.href]));
        for (const l of ['ar', 'en', 'x-default'])
            if (!alt.has(l))
                add('HREFLANG_MISSING', p.url, `hreflang ${l} missing`);
        if (alt.get(loc) !== p.url)
            add('HREFLANG_SELF', p.url, 'hreflang for its own locale is not self-referencing');
        for (const a of h.alternates) {
            if (!/^https?:\/\//.test(a.href))
                add('HREFLANG_ABSOLUTE', p.url, `${a.hreflang} href is not absolute`);
            const other = byUrl.get(a.href);
            if (a.hreflang !== 'x-default' && other?.h && other.h.alternates.find((x) => x.hreflang === loc)?.href !== p.url)
                add('HREFLANG_RECIPROCAL', p.url, `${a.hreflang} alternate does not link back`);
            if (!listed.has(a.href))
                add('HREFLANG_NOT_IN_SITEMAP', p.url, `${a.hreflang} alternate ${a.href} is not in the sitemap`);
        }
        for (const j of h.jsonLd) {
            if (j.error) {
                add('JSONLD_PARSE', p.url, j.error);
                continue;
            }
            for (const m of jsonLdIssues(j.value, o.host))
                add('JSONLD', p.url, m);
        }
        titles.set(`${loc}|${h.title}`, [...(titles.get(`${loc}|${h.title}`) ?? []), p.url]);
        descriptions.set(`${loc}|${h.description}`, [...(descriptions.get(`${loc}|${h.description}`) ?? []), p.url]);
        if (Buffer.byteLength(p.html) > maxHtml)
            add('CWV_HTML_SIZE', p.url, `HTML is ${Buffer.byteLength(p.html)} bytes`, 'warn');
        if (h.blockingStylesheets)
            add('CWV_BLOCKING_CSS', p.url, 'render-blocking stylesheet link');
        if (h.blockingScripts)
            add('CWV_BLOCKING_JS', p.url, 'render-blocking script');
        for (const im of h.images) {
            if (!im.width || !im.height)
                add('CWV_IMG_DIMENSIONS', p.url, `image ${im.src} has no width and height (layout shift)`);
            if (im.alt === null)
                add('IMG_ALT', p.url, `image ${im.src} has no alt attribute`);
        }
        if (h.images.filter((im) => im.loading === 'eager' || im.fetchpriority === 'high').length > 1)
            add('CWV_EAGER_IMAGES', p.url, 'more than one eager/high priority image');
        if (h.images.some((im, i) => i > 0 && !im.loading && im.fetchpriority !== 'high'))
            add('CWV_IMG_LAZY', p.url, 'below-the-fold image without loading="lazy"', 'warn');
    }
    for (const [k, urls] of titles)
        if (urls.length > 1)
            add('DUPLICATE_TITLE', urls.join(' , '), `title "${k.split('|')[1]}" is used by ${urls.length} pages`);
    for (const [k, urls] of descriptions)
        if (urls.length > 1)
            add('DUPLICATE_DESCRIPTION', urls.join(' , '), `description "${k.split('|')[1]}" is used by ${urls.length} pages`, 'warn');
    if (o.statusOf) {
        const seen = new Map();
        for (const { p, h } of byUrl.values()) {
            if (!h)
                continue;
            for (const href of new Set(h.links)) {
                const clean = href.split('#')[0].split('?')[0];
                if (!clean.startsWith('/') || !isNamespace(clean) || PRIVATE_HREF.test(clean))
                    continue;
                if (!seen.has(clean))
                    seen.set(clean, await o.statusOf(clean));
                const st = seen.get(clean);
                if (st >= 400)
                    add('BROKEN_LINK', p.url, `${href} answers ${st}`);
                else if (st >= 300)
                    add('REDIRECTING_LINK', p.url, `${href} answers ${st} (link the final URL)`, 'warn');
            }
        }
    }
    return issues;
}
const locsOf = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
exports.locsOf = locsOf;
//# sourceMappingURL=seo-audit.js.map