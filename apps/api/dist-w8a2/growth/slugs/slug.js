"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withSuffix = exports.SLUG_ENTITY_TYPES = exports.SLUG_PATTERN = void 0;
exports.slugify = slugify;
exports.candidateSlug = candidateSlug;
exports.SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/;
exports.SLUG_ENTITY_TYPES = ['DOCTOR', 'CLINIC', 'PHARMACY', 'LAB', 'SPECIALTY', 'CITY', 'DISTRICT'];
const RESERVED = new Set(['new', 'search', 'all', 'admin', 'api', 'app', 'login', 'preferences', 'sitemap', 'robots', 'static', 'assets']);
const AR = {
    ا: 'a', أ: 'a', إ: 'e', آ: 'a', ب: 'b', ت: 't', ث: 'th', ج: 'g', ح: 'h', خ: 'kh', د: 'd', ذ: 'z', ر: 'r', ز: 'z', س: 's', ش: 'sh', ص: 's', ض: 'd', ط: 't', ظ: 'z', ع: 'a', غ: 'gh',
    ف: 'f', ق: 'q', ك: 'k', ل: 'l', م: 'm', ن: 'n', ه: 'h', ة: 'a', و: 'w', ي: 'y', ى: 'a', ء: '', ئ: 'e', ؤ: 'o',
};
function slugify(input) {
    const mapped = [...input.normalize('NFKD').replace(/[ً-ٰٟـ]/g, '')].map((ch) => AR[ch] ?? ch).join('');
    let s = mapped.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
    if (s.length > 60)
        s = s.slice(0, 60).replace(/-+$/g, '');
    return s;
}
function candidateSlug(name, type, entityId) {
    const base = slugify(name ?? '');
    const ok = exports.SLUG_PATTERN.test(base) && !RESERVED.has(base);
    if (ok)
        return base;
    const tail = entityId.toLowerCase().replace(/[^a-z0-9]/g, '').slice(-8) || 'x0000000';
    return `${type.toLowerCase()}-${tail}`.slice(0, 60);
}
const withSuffix = (base, n) => { const suf = `-${n}`; return `${base.slice(0, 60 - suf.length).replace(/-+$/g, '')}${suf}`; };
exports.withSuffix = withSuffix;
//# sourceMappingURL=slug.js.map