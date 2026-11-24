"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.completeProblems = completeProblems;
exports.parity = parity;
const page_model_1 = require("../page-model");
const text_1 = require("../text");
const ARABIC = /[؀-ۿ]/;
const LATIN = /[A-Za-z]/;
const share = (s, re) => { const letters = s.match(/\p{L}/gu) ?? []; return letters.length ? letters.filter((l) => re.test(l)).length / letters.length : 0; };
function completeProblems(x) {
    const m = [];
    if (!x.title.trim())
        m.push(`${x.locale} title empty`);
    if (!x.description.trim())
        m.push(`${x.locale} description empty`);
    if (!x.h1.length)
        m.push(`${x.locale} heading missing`);
    if ((0, text_1.wordCount)(x.text) < 10)
        m.push(`${x.locale} text too short`);
    const mine = x.locale === 'ar' ? share(x.text, ARABIC) : share(x.text, LATIN);
    if (x.text.trim() && mine < 0.5)
        m.push(`${x.locale} text is not mostly ${x.locale === 'ar' ? 'Arabic' : 'English'}`);
    return m;
}
function parity(p, c) {
    const other = c.pages.get((0, page_model_1.pageId)(p.pageKey, p.locale === 'ar' ? 'en' : 'ar'));
    const problems = [];
    const complete = completeProblems;
    problems.push(...complete(p));
    if (!other)
        problems.push(`${p.locale === 'ar' ? 'en' : 'ar'} page missing`);
    else
        problems.push(...complete(other).filter((m) => !problems.includes(m)));
    return problems.length ? [{ id: 'parity-ar-en', ok: false, severity: 'block', detail: problems.slice(0, 4).join('; ') }] : [{ id: 'parity-ar-en', ok: true, severity: 'block' }];
}
//# sourceMappingURL=parity-ar-en.js.map