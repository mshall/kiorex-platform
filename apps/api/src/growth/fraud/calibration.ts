import type { FraudRulesConfig } from './fraud-config';
import { FRAUD_RULE_IDS, type FraudRuleId } from './signals';

/** Labelled outcome counts of one rule (flagged = cases the rule appeared in; confirmed and dismissed = the labelled ones among them). */
export interface RuleStats { flagged: number; confirmed: number; dismissed: number }
export interface RuleReport { ruleId: FraudRuleId; flagged: number; labelled: number; confirmed: number; dismissed: number; precision: number | null; pending: number; weight: number; enforce: boolean }

export const MIN_LABELLED = 20;

export const precisionOf = (s: RuleStats): number | null => (s.confirmed + s.dismissed === 0 ? null : s.confirmed / (s.confirmed + s.dismissed));

/** The shadow report: precision and volume by rule, shown only as a number when reviewers have labelled enough cases. */
export function shadowReport(cfg: FraudRulesConfig, stats: Partial<Record<FraudRuleId, RuleStats>>): RuleReport[] {
  return FRAUD_RULE_IDS.map((id) => {
    const s = stats[id] ?? { flagged: 0, confirmed: 0, dismissed: 0 };
    const labelled = s.confirmed + s.dismissed;
    return { ruleId: id, flagged: s.flagged, labelled, confirmed: s.confirmed, dismissed: s.dismissed, precision: labelled >= MIN_LABELLED ? Math.round((s.confirmed / labelled) * 1000) / 1000 : null, pending: Math.max(0, s.flagged - labelled), weight: cfg.rules[id].weight, enforce: cfg.rules[id].enforce };
  });
}

export interface WeightChange { ruleId: FraudRuleId; from: number; to: number; precision: number; labelled: number }

/**
 * Propose weight changes from labelled outcomes: precision >= 0.9 raises a weight by 10 percent, below 0.7 lowers it by 10, below 0.5 by 25. A rule with fewer than MIN_LABELLED labels is
 * never touched. The proposal changes WEIGHTS ONLY: it never flips `enforce`, bands, actions or thresholds, and it is only ever a DRAFT for the maker-checker (never applied here).
 */
export function proposeWeights(cfg: FraudRulesConfig, stats: Partial<Record<FraudRuleId, RuleStats>>, minLabelled = MIN_LABELLED): { changes: WeightChange[]; payload: { rules: Record<string, { weight: number }> } } {
  const changes: WeightChange[] = [];
  for (const id of FRAUD_RULE_IDS) {
    const s = stats[id]; if (!s) continue;
    const labelled = s.confirmed + s.dismissed; const p = precisionOf(s);
    if (p === null || labelled < minLabelled) continue;
    const factor = p >= 0.9 ? 1.1 : p >= 0.7 ? 1 : p >= 0.5 ? 0.9 : 0.75;
    const from = cfg.rules[id].weight; const to = Math.min(100, Math.max(0, Math.round(from * factor)));
    if (to !== from) changes.push({ ruleId: id, from, to, precision: Math.round(p * 1000) / 1000, labelled });
  }
  return { changes, payload: { rules: Object.fromEntries(changes.map((c) => [c.ruleId, { weight: c.to }])) } };
}

/** Fairness guard (weekly): the HOLD rate per group, aggregate only. A group under k = 10 is masked; a group whose rate is more than `ratio` times the lowest visible rate is flagged for human review. */
export interface GroupRate { group: string; total: number; held: number }
export interface FairnessRow { group: string; total: number | '<10'; held: number | '<10'; rate: number | null; flagged: boolean }
export function fairnessRows(groups: GroupRate[], o: { k?: number; ratio?: number } = {}): FairnessRow[] {
  const k = o.k ?? 10; const ratio = o.ratio ?? 2;
  const visible = groups.filter((g) => g.total >= k);
  const rates = visible.map((g) => g.held / g.total);
  const lowest = rates.length ? Math.min(...rates.filter((r) => r > 0), ...(rates.every((r) => r === 0) ? [0] : [])) : 0;
  return groups.map((g) => {
    if (g.total < k) return { group: g.group, total: '<10' as const, held: '<10' as const, rate: null, flagged: false };
    const r = g.held / g.total;
    return { group: g.group, total: g.total, held: g.held < k && g.held > 0 ? '<10' as const : g.held, rate: Math.round(r * 1000) / 1000, flagged: visible.length >= 2 && lowest > 0 && r >= lowest * ratio };
  });
}
