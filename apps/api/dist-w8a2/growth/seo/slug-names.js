"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.proposeSlug = proposeSlug;
const slug_1 = require("../slugs/slug");
const arabic_1 = require("./arabic");
const RESERVED = new Set(['new', 'search', 'all', 'admin', 'api', 'app', 'login', 'preferences', 'sitemap', 'robots', 'static', 'assets']);
function proposeSlug(names, type, entityId) {
    const bs = (names.bookingSlug ?? '').trim().toLowerCase();
    if (bs && slug_1.SLUG_PATTERN.test(bs) && !RESERVED.has(bs))
        return { slug: bs, source: 'BOOKING_SLUG' };
    const en = names.nameEn ? (0, slug_1.slugify)((0, arabic_1.stripLatinHonorifics)((0, arabic_1.transliterateArabic)(names.nameEn))) : '';
    if (slug_1.SLUG_PATTERN.test(en) && !RESERVED.has(en))
        return { slug: en, source: 'NAME_EN' };
    const ar = names.nameAr ? (0, slug_1.slugify)((0, arabic_1.transliterateArabic)(names.nameAr)) : '';
    if (slug_1.SLUG_PATTERN.test(ar) && !RESERVED.has(ar))
        return { slug: ar, source: 'NAME_AR' };
    return { slug: (0, slug_1.candidateSlug)(null, type, entityId), source: 'FALLBACK' };
}
//# sourceMappingURL=slug-names.js.map