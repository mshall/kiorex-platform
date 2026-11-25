"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.similarity = similarity;
const text_1 = require("../text");
const page_model_1 = require("../page-model");
function similarity(p, c) {
    const mine = c.uniqueShingles(p);
    if (mine.size < 3)
        return [{ id: 'similarity', ok: true, severity: 'block' }];
    const limit = c.cfg.maxSimilarityPercent / 100;
    let worst = { pct: 0, other: '' };
    const consider = (key, withContainment) => {
        const o = c.pages.get((0, page_model_1.pageId)(key, p.locale));
        if (!o)
            return;
        const theirs = c.uniqueShingles(o);
        const s = Math.max((0, text_1.jaccard)(mine, theirs), withContainment ? (0, text_1.containment)(mine, theirs) : 0);
        if (s > worst.pct)
            worst = { pct: s, other: key };
    };
    const pk = (0, page_model_1.parentKey)(p.pageKey);
    if (pk)
        consider(pk, true);
    for (const k of (0, page_model_1.siblingKeys)(p.pageKey, [...c.pages.keys()].filter((x) => x.endsWith(`|${p.locale}`)).map((x) => x.slice(0, -3))))
        consider(k, false);
    return worst.pct > limit ? [{ id: 'similarity', ok: false, severity: 'block', detail: `${Math.round(worst.pct * 100)}% of unique text matches ${worst.other}` }] : [{ id: 'similarity', ok: true, severity: 'block' }];
}
//# sourceMappingURL=similarity.js.map