"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.seoRule = seoRule;
const recommendation_types_1 = require("../recommendation.types");
function seoRule(i) {
    const out = [];
    for (const s of [...i.seo].sort((a, b) => (a.templateKind + a.locale < b.templateKind + b.locale ? -1 : 1))) {
        if (s.pages < recommendation_types_1.RECOMMENDATION_POLICY.k)
            continue;
        const failBp = Math.round((s.failingPages * 10_000) / s.pages);
        const indexedBp = s.submitted !== null && s.indexed !== null && s.submitted >= 100 ? Math.round((s.indexed * 10_000) / s.submitted) : null;
        const quality = s.failingPages >= recommendation_types_1.RECOMMENDATION_POLICY.k && failBp >= 2000;
        const coverage = indexedBp !== null && indexedBp < 6000;
        if (!quality && !coverage)
            continue;
        out.push({
            kind: 'SEO_GAP', fingerprint: `seo:${s.templateKind}:${s.locale}`,
            payload: { pageGroup: s.templateKind, locale: s.locale, pages: s.pages, failingPages: s.failingPages, failingBp: failBp, topFailedChecks: s.topFailedChecks.slice(0, 3), indexedBp, finding: quality ? 'QUALITY_GATE' : 'LOW_INDEXATION' },
            rationale: quality
                ? { en: `${s.failingPages} of ${s.pages} ${s.templateKind} pages (${failBp / 100}%) fail the SEO quality gate in ${s.locale}; the most common checks are ${s.topFailedChecks.slice(0, 3).join(', ') || 'not recorded'}. Consider fixing the template.`, ar: `${s.failingPages} من ${s.pages} صفحة (${failBp / 100}%) من نوع ${s.templateKind} بتفشل في بوابة جودة السيو بلغة ${s.locale}. فكّر تصلح القالب.` }
                : { en: `Only ${(indexedBp ?? 0) / 100}% of the submitted ${s.templateKind} pages are indexed in ${s.locale}. Consider reviewing the exclusion reasons.`, ar: `نسبة ${(indexedBp ?? 0) / 100}% بس من صفحات ${s.templateKind} المرسلة متفهرسة بلغة ${s.locale}. فكّر تراجع أسباب الاستبعاد.` },
            evidenceRefs: [{ source: 'seo-automation', ref: `${s.templateKind}:${s.locale}`, window: `${i.window.from}..${i.window.to}` }], confidence: quality ? Math.min(80, 50 + Math.floor(s.failingPages / 5)) : 55,
        });
    }
    return out;
}
//# sourceMappingURL=seo.rule.js.map