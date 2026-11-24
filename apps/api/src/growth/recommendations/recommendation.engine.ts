import { checkAggregateOnly } from './assert-aggregate-only';
import { budgetRule, campaignRule, contentRule, holdoutRule, seoRule } from './rules';
import { RECOMMENDATION_KINDS, RECOMMENDATION_POLICY as P, type RecommendationInputs, type RuleProposal } from './recommendation.types';
import { healthWordIn } from '../automation/health-terms';

export interface EngineResult { proposals: RuleProposal[]; dropped: Array<{ fingerprint: string; reason: string }> }

/**
 * Deterministic rules first (GRW-P3-E). Runs every rule over the aggregates, drops anything that is not a member of the closed vocabulary or that fails the aggregate-only guard (the
 * guard runs on payload, evidence AND the generated text, so a rule bug can never leak a person or a health word), sorts by confidence and keeps the best few. PURE.
 */
export function runRules(i: RecommendationInputs): EngineResult {
  const all = [...budgetRule(i), ...campaignRule(i), ...contentRule(i), ...seoRule(i), ...holdoutRule(i)];
  const dropped: EngineResult['dropped'] = []; const keep: RuleProposal[] = [];
  for (const p of all) {
    if (!(RECOMMENDATION_KINDS as readonly string[]).includes(p.kind)) { dropped.push({ fingerprint: p.fingerprint, reason: 'UNKNOWN_KIND' }); continue; }
    const v = checkAggregateOnly({ payload: p.payload, evidence: p.evidenceRefs });
    const word = healthWordIn(`${p.rationale.en} ${p.rationale.ar}`);
    if (v.length || word) { dropped.push({ fingerprint: p.fingerprint, reason: v.length ? `${v[0]!.code}:${v[0]!.path}` : `HEALTH_WORD:${word}` }); continue; }
    keep.push(p);
  }
  keep.sort((a, b) => b.confidence - a.confidence || (a.fingerprint < b.fingerprint ? -1 : 1));
  return { proposals: keep.slice(0, P.maxPerRun), dropped };
}
