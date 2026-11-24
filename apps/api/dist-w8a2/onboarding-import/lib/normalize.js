"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.maskName = exports.maskPhone = exports.hasArabic = exports.latinDigits = void 0;
exports.normalizePhone = normalizePhone;
exports.parseDate = parseDate;
exports.parseNationalId = parseNationalId;
exports.normalizeGender = normalizeGender;
exports.nameKey = nameKey;
exports.splitName = splitName;
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const latinDigits = (s) => s.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d))).replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)));
exports.latinDigits = latinDigits;
function normalizePhone(raw, defaultCc = '20') {
    if (!raw || !raw.trim())
        return { value: null, valid: false, reason: 'EMPTY' };
    let d = (0, exports.latinDigits)(raw).replace(/[^\d+]/g, '');
    if (d.startsWith('00'))
        d = '+' + d.slice(2);
    let cc = defaultCc;
    let national;
    if (d.startsWith('+')) {
        const m = /^\+(20|966|971|965|974|973|968|962|961|964|249|218|212|213|216|1|44)(\d+)$/.exec(d);
        if (!m)
            return { value: d, valid: false, reason: 'BAD_PREFIX' };
        cc = m[1];
        national = m[2];
    }
    else if (d.startsWith(defaultCc) && d.length >= defaultCc.length + 9)
        national = d.slice(defaultCc.length);
    else
        national = d.replace(/^0/, '');
    if (cc === '20') {
        if (national.length < 10)
            return { value: '+' + cc + national, valid: false, reason: 'TOO_SHORT' };
        if (national.length > 10)
            return { value: '+' + cc + national, valid: false, reason: 'TOO_LONG' };
        if (!/^1[0125]\d{8}$/.test(national) && !/^[2-9]\d{9}$/.test(national))
            return { value: '+' + cc + national, valid: false, reason: 'BAD_PREFIX' };
    }
    else if (national.length < 7)
        return { value: '+' + cc + national, valid: false, reason: 'TOO_SHORT' };
    else if (national.length > 12)
        return { value: '+' + cc + national, valid: false, reason: 'TOO_LONG' };
    return { value: '+' + cc + national, valid: true };
}
const iso = (y, m, d) => { const dt = new Date(Date.UTC(y, m - 1, d)); return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null; };
function parseDate(raw, opts = {}) {
    if (!raw || !raw.trim())
        return { value: null, valid: false, reason: 'EMPTY' };
    const s = (0, exports.latinDigits)(raw.trim());
    const now = opts.now ?? new Date();
    const dayFirst = opts.dayFirst ?? true;
    let y, m, d;
    let m1;
    if ((m1 = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(s))) {
        y = +m1[1];
        m = +m1[2];
        d = +m1[3];
    }
    else if ((m1 = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s))) {
        const a = +m1[1];
        const b = +m1[2];
        y = +m1[3];
        if (y < 100)
            y += y > now.getUTCFullYear() % 100 ? 1900 : 2000;
        const first = dayFirst ? { d: a, m: b } : { d: b, m: a };
        const second = dayFirst ? { d: b, m: a } : { d: a, m: b };
        const r1 = iso(y, first.m, first.d);
        const r2 = iso(y, second.m, second.d);
        if (!r1 && !r2)
            return { value: null, valid: false, reason: 'UNPARSEABLE' };
        const val = r1 ?? r2;
        const amb = !!(r1 && r2 && r1 !== r2);
        return check({ value: val, valid: true, ...(amb ? { ambiguous: true, alt: r2 } : {}) }, now, opts.allowFuture);
    }
    else if (/^\d{5}$/.test(s)) {
        const dt = new Date(Date.UTC(1899, 11, 30) + +s * 86400000);
        return check({ value: dt.toISOString().slice(0, 10), valid: true }, now, opts.allowFuture);
    }
    else
        return { value: null, valid: false, reason: 'UNPARSEABLE' };
    const v = iso(y, m, d);
    if (!v)
        return { value: null, valid: false, reason: 'UNPARSEABLE' };
    return check({ value: v, valid: true }, now, opts.allowFuture);
}
function check(r, now, allowFuture) {
    const y = +r.value.slice(0, 4);
    if (y < 1900)
        return { ...r, valid: false, reason: 'OUT_OF_RANGE' };
    if (!allowFuture && new Date(r.value + 'T00:00:00Z').getTime() > now.getTime() + 86400000)
        return { ...r, valid: false, reason: 'FUTURE' };
    return r;
}
function parseNationalId(raw) {
    if (!raw)
        return { value: null, valid: false };
    const d = (0, exports.latinDigits)(raw).replace(/\D/g, '');
    if (!d)
        return { value: null, valid: false };
    if (d.length !== 14 || !/^[23]/.test(d))
        return { value: d, valid: false };
    const dob = iso((d[0] === '2' ? 1900 : 2000) + +d.slice(1, 3), +d.slice(3, 5), +d.slice(5, 7));
    const gov = +d.slice(7, 9);
    if (!dob || !((gov >= 1 && gov <= 35) || gov === 88))
        return { value: d, valid: false };
    return { value: d, valid: true, dob, gender: +d[12] % 2 === 1 ? 'MALE' : 'FEMALE' };
}
function normalizeGender(raw) {
    if (!raw)
        return null;
    const s = raw.trim().toLowerCase();
    if (['m', 'male', 'man', '1', 'ذكر', 'ذ', 'رجل'].includes(s))
        return 'MALE';
    if (['f', 'female', 'woman', '2', 'أنثى', 'انثى', 'ث', 'أنثي', 'سيدة'].includes(s))
        return 'FEMALE';
    return null;
}
function nameKey(s) {
    if (!s)
        return '';
    return s.normalize('NFKC').replace(/[ً-ٰٟـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[^\p{L}\p{N}\s]/gu, ' ').toLowerCase().replace(/\s+/g, ' ').trim();
}
const hasArabic = (s) => /[؀-ۿ]/.test(s);
exports.hasArabic = hasArabic;
function splitName(full) { const p = full.trim().split(/\s+/); return { first: p[0] ?? '', last: p.slice(1).join(' ') }; }
const maskPhone = (p) => (p ? p.replace(/\d(?=\d{3})/g, '•') : null);
exports.maskPhone = maskPhone;
const maskName = (n) => { if (!n)
    return null; const p = n.trim().split(/\s+/); return p.map((w, i) => (i === 0 ? w : w[0] + '•••')).join(' '); };
exports.maskName = maskName;
//# sourceMappingURL=normalize.js.map