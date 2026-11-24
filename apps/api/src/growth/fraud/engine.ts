import { FRAUD_RULES_LIST } from './rules';
import type { FraudRulesConfig } from './fraud-config';
import { scoreBoth, type Scored } from './scoring';
import type { FiredSignal, FraudAction, FraudBand, FraudCaseKind, FraudFeatures, FraudSurface } from './signals';

export interface Evaluation {
  signals: FiredSignal[];
  shadow: Scored;
  enforced: Scored;
  wouldHaveBeenHeld: boolean;
  /** the action to TAKE (follows the enforced score only) */
  action: FraudAction;
  /** the action the shadow score would have taken, recorded so the shadow report can show it */
  shadowAction: FraudAction;
  kind: FraudCaseKind;
}

export const actionFor = (cfg: FraudRulesConfig, surface: FraudSurface, band: FraudBand): FraudAction => (band === 'ALLOW' ? 'NONE' : cfg.actions[surface][band] ?? 'OPEN_CASE');

/** Run every rule that applies to `surface` over the features; pure. A rule that throws is skipped (fraud scoring must never take a request down). */
export function evaluateFraud(cfg: FraudRulesConfig, surface: FraudSurface, f: FraudFeatures): Evaluation {
  const signals: FiredSignal[] = [];
  for (const r of FRAUD_RULES_LIST) {
    if (!r.surfaces.includes(surface) || !cfg.rules[r.id].enabled) continue;
    try { const o = r.evaluate(f, cfg.thresholds); if (o && o.strength > 0) signals.push({ ruleId: r.id, kind: r.kind, strength: o.strength, reason: o.reason, evidence: o.evidence }); } catch { /* skipped */ }
  }
  const both = scoreBoth(cfg, signals);
  // a case belongs to the kind of its strongest signal; a provider-side finding is always a PROVIDER case (it is never acted on automatically)
  const strongest = [...signals].sort((a, b) => b.strength - a.strength)[0];
  const kind: FraudCaseKind = signals.some((s) => s.kind === 'PROVIDER') && strongest?.kind === 'PROVIDER' ? 'PROVIDER' : strongest?.kind ?? 'REFERRAL';
  // the PROVIDER surface is the only one a provider finding may act on; elsewhere a PROVIDER-only finding is just a case
  const effSurface: FraudSurface = kind === 'PROVIDER' ? 'PROVIDER_REVIEW' : surface;
  return { signals, ...both, kind, action: actionFor(cfg, effSurface, both.enforced.band), shadowAction: actionFor(cfg, effSurface, both.shadow.band) };
}
