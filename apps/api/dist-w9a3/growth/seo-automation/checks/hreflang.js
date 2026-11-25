"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hreflang = hreflang;
const page_model_1 = require("../page-model");
function hreflang(p, c) {
    const issues = [];
    const by = new Map(p.alternates.map((a) => [a.hreflang.toLowerCase(), a.href]));
    if (!by.size)
        issues.push('no hreflang');
    else {
        if (by.get(p.locale) !== p.expectedCanonical)
            issues.push(`no self reference for ${p.locale}`);
        const otherLoc = p.locale === 'ar' ? 'en' : 'ar';
        if (!by.has(otherLoc))
            issues.push(`no ${otherLoc} alternate`);
        if (!by.has('x-default'))
            issues.push('no x-default');
        for (const [l, h] of by)
            if (!/^https?:\/\//.test(h))
                issues.push(`hreflang ${l} is not absolute`);
        const other = c.pages.get((0, page_model_1.pageId)(p.pageKey, otherLoc));
        if (other && by.has(otherLoc)) {
            const back = new Map(other.alternates.map((a) => [a.hreflang.toLowerCase(), a.href]));
            if (back.get(p.locale) !== p.expectedCanonical)
                issues.push(`${otherLoc} page does not point back`);
            if (by.get(otherLoc) !== other.expectedCanonical)
                issues.push(`${otherLoc} alternate is not that page's canonical`);
        }
    }
    return issues.length ? [{ id: 'hreflang', ok: false, severity: 'block', detail: issues.join('; ') }] : [{ id: 'hreflang', ok: true, severity: 'block' }];
}
//# sourceMappingURL=hreflang.js.map