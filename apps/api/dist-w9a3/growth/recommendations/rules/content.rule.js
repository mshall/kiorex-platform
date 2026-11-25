"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.contentRule = contentRule;
const recommendation_types_1 = require("../recommendation.types");
const SURFACE_OF = { HOME: 'landing.home.hero_copy', PROVIDER: 'landing.provider.cta_label', SEARCH: 'landing.search.empty_state', SIGNUP: 'signup.value_proposition' };
function contentRule(i) {
    const rows = i.landings.filter((l) => SURFACE_OF[l.landingKind] && l.views >= 1000);
    if (rows.length < 2)
        return [];
    const rate = (l) => (l.registrations * 10_000) / l.views;
    const out = [];
    for (const l of [...rows].sort((a, b) => (a.landingKind < b.landingKind ? -1 : 1))) {
        const others = rows.filter((o) => o !== l);
        const avg = others.reduce((s, o) => s + rate(o), 0) / others.length;
        if (l.registrations < recommendation_types_1.RECOMMENDATION_POLICY.k || others.some((o) => o.registrations < recommendation_types_1.RECOMMENDATION_POLICY.k) || avg <= 0 || rate(l) >= avg / 2)
            continue;
        const mine = Math.round(rate(l));
        const theirs = Math.round(avg);
        out.push({
            kind: 'CONTENT_SUGGESTION', fingerprint: `content:${l.landingKind}`,
            payload: { landingKind: l.landingKind, surface: SURFACE_OF[l.landingKind], viewToRegistrationBp: mine, averageOthersBp: theirs, views: l.views, registrations: l.registrations, window: i.window, action: 'COPY_EXPERIMENT' },
            rationale: {
                en: `${l.landingKind} pages turn ${mine / 100}% of views into registrations, under half of the other page types (${theirs / 100}%). Consider a copy experiment on ${SURFACE_OF[l.landingKind]}.`,
                ar: `صفحات ${l.landingKind} بتحوّل ${mine / 100}% من المشاهدات إلى تسجيلات، أقل من نصف أنواع الصفحات التانية (${theirs / 100}%). فكّر تعمل تجربة صياغة على ${SURFACE_OF[l.landingKind]}.`,
            },
            evidenceRefs: [{ source: 'growth-metrics', ref: `landing:${l.landingKind}`, window: `${i.window.from}..${i.window.to}` }], confidence: Math.min(75, 40 + Math.floor(l.registrations / 5)),
        });
    }
    return out;
}
//# sourceMappingURL=content.rule.js.map