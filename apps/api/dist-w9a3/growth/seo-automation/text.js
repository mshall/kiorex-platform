"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wordCount = void 0;
exports.visibleText = visibleText;
exports.tokens = tokens;
exports.shingles = shingles;
exports.jaccard = jaccard;
exports.containment = containment;
const AR_DIACRITICS = /[ً-ٰٟـ]/g;
const TAGS = /<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi;
function visibleText(html) {
    return html.replace(TAGS, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}
function tokens(text) {
    const t = text.toLowerCase().replace(AR_DIACRITICS, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
    return t.match(/[\p{L}\p{N}]+/gu) ?? [];
}
function shingles(toks, n) {
    const out = new Set();
    if (toks.length < n) {
        if (toks.length)
            out.add(toks.join(' '));
        return out;
    }
    for (let i = 0; i + n <= toks.length; i++)
        out.add(toks.slice(i, i + n).join(' '));
    return out;
}
function jaccard(a, b) {
    if (!a.size && !b.size)
        return 0;
    let inter = 0;
    const [small, large] = a.size <= b.size ? [a, b] : [b, a];
    for (const x of small)
        if (large.has(x))
            inter++;
    return inter / (a.size + b.size - inter);
}
function containment(a, b) {
    if (!a.size)
        return 0;
    let inter = 0;
    for (const x of a)
        if (b.has(x))
            inter++;
    return inter / a.size;
}
const wordCount = (text) => tokens(text).length;
exports.wordCount = wordCount;
//# sourceMappingURL=text.js.map