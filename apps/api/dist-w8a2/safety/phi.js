"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectPhi = detectPhi;
exports.redactPhi = redactPhi;
exports.detectAbuse = detectAbuse;
const text_1 = require("./text");
const RE = [
    ['EMAIL', /[\w.+-]+@[\w-]+\.[\w.-]+/g],
    ['URL', /\bhttps?:\/\/\S+/gi],
    ['NATIONAL_ID', /(?<!\d)[23]\d{13}(?!\d)/g],
    ['PHONE', /(?<!\d)(?:\+?20|0)?1[0-25]\d{8}(?!\d)|(?<!\d)\+?\d[\d\s-]{8,13}\d(?!\d)/g],
    ['NAME_CLAIM', /\b(?:[Mm]y name is|[Ii] am|[Ii]'m)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?|(?:اسمي|انا)\s+[؀-ۿ]{2,}(?:\s+[؀-ۿ]{2,})?/g],
];
function arabicDigitsToAscii(s) {
    return s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}
function detectPhi(text) {
    const t = arabicDigitsToAscii(text);
    return RE.filter(([, re]) => { re.lastIndex = 0; return re.test(t); }).map(([k]) => k);
}
function redactPhi(text) {
    let out = arabicDigitsToAscii(text);
    let count = 0;
    for (const [kind, re] of RE) {
        out = out.replace(re, () => { count++; return `[${kind}]`; });
    }
    return { text: out, count };
}
const ABUSE = ['idiot', 'stupid', 'scam', 'fraud', 'thief', 'kill you', 'shut up', 'غبي', 'حرامي', 'نصاب', 'نصب', 'اقتلك', 'حيوان', 'كلب'];
const NABUSE = ABUSE.map(text_1.normalizeText);
function detectAbuse(text) {
    const n = (0, text_1.normalizeText)(text);
    return NABUSE.some((w) => n.includes(w));
}
//# sourceMappingURL=phi.js.map