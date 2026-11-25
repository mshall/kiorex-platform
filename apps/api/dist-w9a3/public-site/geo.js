"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.specialtyFromSegment = exports.specialtySegment = void 0;
exports.slugifyPlace = slugifyPlace;
exports.placeLabel = placeLabel;
exports.arabicPlaceSlug = arabicPlaceSlug;
const seo_public_1 = require("../growth/seo/seo-public");
function slugifyPlace(v) {
    if (!v)
        return null;
    if (/[\u0600-\u06FF]/.test(v)) {
        const known = arabicPlaceSlug(v);
        if (known)
            return known;
        v = (0, seo_public_1.transliterateArabic)(v);
    }
    const s = v.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    return s.length >= 2 ? s : null;
}
const specialtySegment = (code) => code.replace(/_/g, '-');
exports.specialtySegment = specialtySegment;
const specialtyFromSegment = (seg) => seg.replace(/-/g, '_');
exports.specialtyFromSegment = specialtyFromSegment;
const GOVERNORATES_AR = {
    cairo: 'القاهرة', giza: 'الجيزة', alexandria: 'الإسكندرية', qalyubia: 'القليوبية', 'sharm-el-sheikh': 'شرم الشيخ', 'south-sinai': 'جنوب سيناء',
    dakahlia: 'الدقهلية', sharqia: 'الشرقية', gharbia: 'الغربية', monufia: 'المنوفية', beheira: 'البحيرة', suez: 'السويس', 'port-said': 'بورسعيد', ismailia: 'الإسماعيلية', luxor: 'الأقصر', aswan: 'أسوان',
};
const AREAS_AR = {
    'nasr-city': 'مدينة نصر', maadi: 'المعادي', heliopolis: 'مصر الجديدة', zamalek: 'الزمالك', dokki: 'الدقي', mohandessin: 'المهندسين', 'new-cairo': 'القاهرة الجديدة', 'sheikh-zayed': 'الشيخ زايد',
    '6th-of-october': 'السادس من أكتوبر', downtown: 'وسط البلد', shubra: 'شبرا', 'fifth-settlement': 'التجمع الخامس', agouza: 'العجوزة', 'rehab-city': 'مدينة الرحاب',
};
function placeLabel(kind, name) {
    const seg = slugifyPlace(name) ?? '';
    const ar = (kind === 'city' ? GOVERNORATES_AR : AREAS_AR)[seg];
    return { en: name, ar: ar ?? name };
}
const REVERSE = new Map([...Object.entries(GOVERNORATES_AR), ...Object.entries(AREAS_AR)].map(([slug, ar]) => [(0, seo_public_1.normalizeArabic)(ar), slug]));
function arabicPlaceSlug(v) { return REVERSE.get((0, seo_public_1.normalizeArabic)(v)) ?? null; }
//# sourceMappingURL=geo.js.map