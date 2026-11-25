"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HEALTH_WORD_RE = void 0;
exports.healthWordIn = healthWordIn;
const safety_public_1 = require("../../safety/safety-public");
const STOP = new Set(['medicine', 'general', 'family', 'sports', 'management', 'diseases', 'surgery', 'health']);
const enWords = new Set();
for (const c of safety_public_1.SPECIALTY_CODES) {
    for (const w of c.split('_'))
        if (w.length >= 4 && !STOP.has(w))
            enWords.add(w);
    for (const w of safety_public_1.SPECIALTY_LABELS[c].en.toLowerCase().split(/[^a-z]+/))
        if (w.length >= 4 && !STOP.has(w))
            enWords.add(w);
}
const AR_STOP = new Set(['الطب', 'طب', 'وال', 'جراحة']);
const strip = (w) => w.replace(/^(وال|بال|لل|ال|و)/, '');
const arWords = new Set();
for (const c of safety_public_1.SPECIALTY_CODES)
    for (const w of safety_public_1.SPECIALTY_LABELS[c].ar.split(/[^\u0621-\u064A]+/)) {
        const t = strip(w);
        if (t.length >= 3 && !AR_STOP.has(t) && !AR_STOP.has(w))
            arWords.add(t);
    }
const GENERIC_EN = ['specialt', 'doctor', 'clinician', 'physician', 'provider', 'diagnos', 'prescri', 'medicat', 'drug', 'pharmac', 'symptom', 'disease', 'treatment', 'insur', 'cancer', 'diabet', 'pregnan', 'hiv', 'covid', 'surgery', 'therap', 'patient list', 'nurse'];
for (const w of ['طبيب', 'دكتور', 'تخصص', 'مرض', 'علاج', 'دواء', 'أدوية', 'تحليل', 'حمل', 'سرطان', 'سكر', 'سكري', 'عيادة', 'صيدلية', 'أعراض', 'تشخيص', 'ممرض', 'ممرضة', 'روشتة'])
    arWords.add(w);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
exports.HEALTH_WORD_RE = new RegExp(`(${[...enWords, ...GENERIC_EN].map(esc).join('|')}|\\blabs?\\b|\\border(s|ed)?\\b|\\bclinic\\b)`, 'i');
function healthWordIn(text) {
    const m = exports.HEALTH_WORD_RE.exec(text);
    if (m)
        return m[1];
    for (const w of text.split(/[^\u0621-\u064A]+/)) {
        if (w.length >= 3 && (arWords.has(w) || arWords.has(strip(w))))
            return w;
    }
    return null;
}
//# sourceMappingURL=health-terms.js.map