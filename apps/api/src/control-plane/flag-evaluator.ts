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
}
export interface EvalContext { market?: string; orgId?: string }
export interface EvalResult {
  effective: boolean;
  reason: 'ON' | 'OFF_GLOBAL' | 'OFF_MARKET' | 'OFF_ORG' | 'AWAITING_GATE' | 'DEPENDENCY_OFF' | 'UNKNOWN_FLAG';
  scope?: OffScope | 'GATE' | 'DEPENDENCY';
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
  if (d.enabled) return { effective: true, reason: flags.has(key) ? 'ON' : 'UNKNOWN_FLAG' };
  switch (d.reason) {
    case 'global_off': return { effective: false, reason: 'OFF_GLOBAL', scope: 'GLOBAL' };
    case 'market_off': return { effective: false, reason: 'OFF_MARKET', scope: 'MARKET' };
    case 'org_off': return { effective: false, reason: 'OFF_ORG', scope: 'ORG' };
    case 'dependency_off': return { effective: false, reason: 'DEPENDENCY_OFF', scope: 'DEPENDENCY', blockedBy: d.blockedBy };
    default: return { effective: false, reason: 'AWAITING_GATE', scope: 'GATE' };
  }
}
