import { RECOMMENDATION_POLICY as P, type RecommendationInputs, type RuleProposal } from '../recommendation.types';

/** The landing kinds (page types, not people) and the experiment surface a copy test would sit on. Surfaces come from the P3-A closed registry. */
const SURFACE_OF: Record<string, string> = { HOME: 'landing.home.hero_copy', PROVIDER: 'landing.provider.cta_label', SEARCH: 'landing.search.empty_state', SIGNUP: 'signup.value_proposition' };

/**
 * Bid-neutral content suggestion (GRW-P3-E). When one landing kind converts views to registrations at less than half the average of the others (with at least 1000 views and k registrations
 * behind each), suggest a COPY experiment on that surface. It changes no bid and no budget, and it names a page type, never a person group or a health topic.
 */
export function contentRule(i: RecommendationInputs): RuleProposal[] {
  const rows = i.landings.filter((l) => SURFACE_OF[l.landingKind] && l.views >= 1000);
  if (rows.length < 2) return [];
  const rate = (l: { views: number; registrations: number }) => (l.registrations * 10_000) / l.views;
  const out: RuleProposal[] = [];
  for (const l of [...rows].sort((a, b) => (a.landingKind < b.landingKind ? -1 : 1))) {
    const others = rows.filter((o) => o !== l); const avg = others.reduce((s, o) => s + rate(o), 0) / others.length;
    if (l.registrations < P.k || others.some((o) => o.registrations < P.k) || avg <= 0 || rate(l) >= avg / 2) continue;
    const mine = Math.round(rate(l)); const theirs = Math.round(avg);
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
