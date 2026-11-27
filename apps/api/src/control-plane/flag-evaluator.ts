/**
 * Flag evaluation delegates to @kiorex/contracts evaluateFlag (KX-08 §08: any-OFF-wins, launch-locked gate,
 * dependencies). This file only adapts the decision shape used by Kiorex modules.
 */
import { evaluateFlag as contractEvaluate, FlagSnapshotShape } from '@kiorex/contracts';

export type OffScope = 'GLOBAL' | 'MARKET' | 'ORG';

export interface SnapshotFlag {
  key: string;
  class: string;
  scopes: string[];
  dependsOn: string[];
  launchLocked: boolean;
  gateSatisfied: boolean;
  values: { global?: 'OFF'; markets: Record<string, 'OFF'>; orgs: Record<string, 'OFF'> };
  expiresAt?: string;
  /** Tenant-level flags only: cohorts the flag is OFF for (G-COHORT). Never serialised into the product snapshot; the service expands it to the member organisations there. */
  cohortOff?: Record<string, 'OFF'>;
}
export interface EvalContext { market?: string; orgId?: string; /** release cohort of the organisation (G-COHORT); FlagsService fills it from the organisation attribute when only orgId is given */ cohort?: string }
export interface EvalResult {
  effective: boolean;
  reason: 'ON' | 'OFF_GLOBAL' | 'OFF_MARKET' | 'OFF_ORG' | 'OFF_COHORT' | 'AWAITING_GATE' | 'DEPENDENCY_OFF' | 'UNKNOWN_FLAG';
  scope?: OffScope | 'COHORT' | 'GATE' | 'DEPENDENCY';
  blockedBy?: string;
}

const shapes = new WeakMap<Map<string, SnapshotFlag>, FlagSnapshotShape>();

export function evaluateFlag(flags: Map<string, SnapshotFlag>, key: string, ctx: EvalContext = {}): EvalResult {
  let shape = shapes.get(flags);
  if (!shape) {
    shape = { product: 'kiorex', version: 0, generatedAt: new Date(0).toISOString(), flags: [...flags.values()] as FlagSnapshotShape['flags'] };
    shapes.set(flags, shape);
  }
  const d = contractEvaluate(shape, key, { market: ctx.market, orgId: ctx.orgId });
  if (d.enabled) {
    // G-COHORT hook: a tenant-level flag switched OFF for a cohort is OFF for every organisation of that cohort (any-OFF-wins, never re-enables). No cohort given or none set = no effect.
    const c = ctx.cohort?.trim().toLowerCase();
    if (c && flags.get(key)?.cohortOff?.[c] === 'OFF') return { effective: false, reason: 'OFF_COHORT', scope: 'COHORT' };
    return { effective: true, reason: flags.has(key) ? 'ON' : 'UNKNOWN_FLAG' };
  }
  switch (d.reason) {
    case 'global_off': return { effective: false, reason: 'OFF_GLOBAL', scope: 'GLOBAL' };
    case 'market_off': return { effective: false, reason: 'OFF_MARKET', scope: 'MARKET' };
    case 'org_off': return { effective: false, reason: 'OFF_ORG', scope: 'ORG' };
    case 'dependency_off': return { effective: false, reason: 'DEPENDENCY_OFF', scope: 'DEPENDENCY', blockedBy: d.blockedBy };
    default: return { effective: false, reason: 'AWAITING_GATE', scope: 'GATE' };
  }
}
