"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.thinContent = thinContent;
const PLACEHOLDER = /coming soon|lorem ipsum|\bTBD\b|under construction|page not found|undefined|\[object Object\]|{{|}}|قريبا|قريباً|قريبًا|سيتم الإضافة|تحت الإنشاء|لا توجد نتائج/i;
function thinContent(p, c) {
    const out = [];
    const min = c.cfg.minUniqueWords[p.templateKind];
    const unique = c.uniqueWordCount(p);
    out.push(unique >= min ? { id: 'thin-content', ok: true, severity: 'block' } : { id: 'thin-content', ok: false, severity: 'block', detail: `${unique} unique words, ${min} needed` });
    const placeholder = PLACEHOLDER.exec(`${p.title} ${p.description} ${p.text}`)?.[0];
    const empty = p.h1.length === 0 || !p.text.trim() || (p.liveProviders !== undefined && p.liveProviders === 0 && ['hub', 'city', 'district', 'care-district', 'city-hub', 'district-hub', 'same-day', 'telemedicine'].includes(p.templateKind));
    out.push(placeholder || empty ? { id: 'empty-page', ok: false, severity: 'block', detail: placeholder ? `placeholder text: ${placeholder}` : 'no heading, no text or no provider' } : { id: 'empty-page', ok: true, severity: 'block' });
    if (p.availableProviders !== undefined && ['same-day', 'telemedicine'].includes(p.templateKind)) {
        out.push(p.availableProviders >= c.minAvailableProviders ? { id: 'available-providers', ok: true, severity: 'block' } : { id: 'available-providers', ok: false, severity: 'block', detail: `${p.availableProviders} available, ${c.minAvailableProviders} needed` });
    }
    return out;
}
//# sourceMappingURL=thin-content.js.map