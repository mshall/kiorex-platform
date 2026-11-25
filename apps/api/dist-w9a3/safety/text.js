"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeText = normalizeText;
function normalizeText(s) {
    return s
        .toLowerCase()
        .normalize('NFKC')
        .replace(/[ً-ٰٟـ]/g, '')
        .replace(/[أإآ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه')
        .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
        .replace(/\s+/g, ' ')
        .trim();
}
//# sourceMappingURL=text.js.map