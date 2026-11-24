import type { FraudRulesConfig } from './fraud-config';
import { ruleEnforced } from './fraud-config';
import { clamp01, type FiredSignal, type FraudBand, type FraudRuleId } from './signals';

/**
 * Scoring (GRW-P3-D): score = clipped weighted sum 0..100. Each fired rule contributes min(cap, weight x strength); contributions are sorted from the strongest and the
 * i-th counts `diminishing^i` of itself (diminishing returns: ten weak signals never beat one strong one by piling up). Pure, deterministic, monotone:
 * adding a signal, raising a strength or raising a weight never lowers the score.
 */
export interface Contribution { ruleId: FraudRuleId; contribution: number; enforced: boolean }
export interface Scored { score: number; band: FraudBand; contributions: Contribution[] }

export function contributionOf(cfg: FraudRulesConfig, s: Pick<FiredSignal, 'ruleId' | 'strength'>): number {
  const r = cfg.rules[s.ruleId];
  if (!r.enabled) return 0;
  return Math.min(r.cap, r.weight * clamp01(s.strength));
}

export function bandOf(score: number, bands: { review: number; hold: number }): FraudBand {
  return score >= bands.hold ? 'HOLD' : score >= bands.review ? 'REVIEW' : 'ALLOW';
}

export function scoreSignals(cfg: FraudRulesConfig, signals: readonly Pick<FiredSignal, 'ruleId' | 'strength'>[], only?: (id: FraudRuleId) => boolean): Scored {
  const parts = signals.filter((s) => !only || only(s.ruleId)).map((s) => ({ ruleId: s.ruleId, contribution: contributionOf(cfg, s), enforced: ruleEnforced(cfg, s.ruleId) }))
    .filter((p) => p.contribution > 0).sort((a, b) => b.contribution - a.contribution || a.ruleId.localeCompare(b.ruleId));
  let total = 0;
  parts.forEach((p, i) => { total += p.contribution * Math.pow(cfg.diminishing, i); });
  const score = Math.min(100, Math.max(0, Math.round(total)));
  return { score, band: bandOf(score, cfg.bands), contributions: parts };
}

/**
 * Shadow and enforce in one pass. `shadow` counts every rule; `enforced` counts only the rules switched to enforce. The action follows `enforced`;
 * `wouldHave` is what the shadow score would have done (recorded so the shadow report can show precision and volume before a rule is flipped).
 */
export function scoreBoth(cfg: FraudRulesConfig, signals: readonly FiredSignal[]): { shadow: Scored; enforced: Scored; wouldHaveBeenHeld: boolean } {
  const shadow = scoreSignals(cfg, signals);
  const enforced = scoreSignals(cfg, signals, (id) => ruleEnforced(cfg, id));
  return { shadow, enforced, wouldHaveBeenHeld: shadow.band === 'HOLD' && enforced.band !== 'HOLD' };
}
