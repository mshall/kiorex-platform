import { ONE_MILLION } from './models';
import type { ConvertingPath, NonConvertingPath } from './path-builder';

/**
 * DATA_DRIVEN attribution: a first-order Markov chain over source kinds with the removal effect (GRW-P3-B). PURE and deterministic (no randomness, fixed iteration).
 *
 * Gate: it is computed only with at least `minConversions` conversions in the 90-day window; below that the report says "insufficient volume" instead of a number.
 * Nodes seen in fewer than `minNodeK` paths are folded into one node OTHER so no node is built from a handful of people. Conversions with an empty path are not part of
 * the chain. Per path the weights are the node credit shares (removal effect over the sum of effects) times how often the node occurs in the path, normalised to one.
 */
export interface DataDrivenConfig { minConversions: number; minNodeK: number }
export const DEFAULT_DATA_DRIVEN: DataDrivenConfig = { minConversions: 1000, minNodeK: 10 };
const START = '(start)'; const CONV = '(conversion)'; const NULLS = '(null)'; const OTHER = 'OTHER';

export type DataDrivenResult =
  | { ok: false; reason: 'INSUFFICIENT_VOLUME'; conversions: number; needed: number }
  | { ok: true; conversions: number; nodes: string[]; effect: Record<string, number>; share: Record<string, number>; folded: string[]; weightsFor: (kinds: readonly string[]) => number[] };

/** Probability of absorbing in CONV from START, with `removed` redirected to NULL. Plain value iteration, 400 rounds (the chains here are tiny and acyclic-ish). */
function convProbability(nodes: readonly string[], trans: Map<string, Map<string, number>>, removed: string | null): number {
  const p = new Map<string, number>(); for (const n of nodes) p.set(n, 0); p.set(START, 0);
  for (let it = 0; it < 400; it++) {
    let delta = 0;
    for (const n of [START, ...nodes]) {
      if (n === removed) continue;
      const row = trans.get(n); if (!row) continue;
      let tot = 0; for (const v of row.values()) tot += v; if (tot === 0) continue;
      let acc = 0;
      for (const [to, v] of row) { const val = to === CONV ? 1 : to === NULLS || to === removed ? 0 : (p.get(to) ?? 0); acc += (v / tot) * val; }
      delta = Math.max(delta, Math.abs(acc - (p.get(n) ?? 0))); p.set(n, acc);
    }
    if (delta < 1e-12) break;
  }
  return p.get(START) ?? 0;
}

export function dataDriven(converting: readonly ConvertingPath[], nonConverting: readonly NonConvertingPath[], cfg: DataDrivenConfig = DEFAULT_DATA_DRIVEN): DataDrivenResult {
  const withTouches = converting.filter((c) => c.touches.length > 0);
  if (converting.length < cfg.minConversions) return { ok: false, reason: 'INSUFFICIENT_VOLUME', conversions: converting.length, needed: cfg.minConversions };
  // k floor: a node counts the paths it occurs in
  const seen = new Map<string, number>();
  const bump = (kinds: readonly string[]) => { for (const k of new Set(kinds)) seen.set(k, (seen.get(k) ?? 0) + 1); };
  for (const c of withTouches) bump(c.touches.map((t) => t.kind)); for (const n of nonConverting) bump(n.kinds);
  const folded = [...seen].filter(([, n]) => n < cfg.minNodeK).map(([k]) => k).sort();
  const fold = new Set(folded); const map = (k: string) => (fold.has(k) ? OTHER : k);
  const trans = new Map<string, Map<string, number>>(); const nodeSet = new Set<string>();
  const add = (a: string, b: string) => { let r = trans.get(a); if (!r) trans.set(a, (r = new Map())); r.set(b, (r.get(b) ?? 0) + 1); };
  const feed = (kinds: readonly string[], end: string) => { const ks = kinds.map(map); ks.forEach((k) => nodeSet.add(k)); let prev = START; for (const k of ks) { add(prev, k); prev = k; } add(prev, end); };
  for (const c of withTouches) feed(c.touches.map((t) => t.kind), CONV);
  for (const n of nonConverting) feed(n.kinds, NULLS);
  const nodes = [...nodeSet].sort();
  if (nodes.length < 2) return { ok: false, reason: 'INSUFFICIENT_VOLUME', conversions: converting.length, needed: cfg.minConversions };
  const full = convProbability(nodes, trans, null);
  const effect: Record<string, number> = {}; let sum = 0;
  for (const n of nodes) { const e = full > 0 ? Math.max(0, 1 - convProbability(nodes, trans, n) / full) : 0; effect[n] = e; sum += e; }
  const share: Record<string, number> = {}; for (const n of nodes) share[n] = sum > 0 ? effect[n]! / sum : 1 / nodes.length;
  const weightsFor = (kinds: readonly string[]) => {
    const raw = kinds.map((k) => share[map(k)] ?? 0); const counts = new Map<string, number>(); for (const k of kinds) counts.set(map(k), (counts.get(map(k)) ?? 0) + 1);
    // per path: each node's share is split over its occurrences, then the path is normalised to one
    const w = kinds.map((k) => (share[map(k)] ?? 0) / (counts.get(map(k)) ?? 1)); const tot = w.reduce((a, b) => a + b, 0) || raw.reduce((a, b) => a + b, 0);
    return tot > 0 ? w.map((x) => x / tot) : kinds.map(() => 1 / kinds.length);
  };
  return { ok: true, conversions: converting.length, nodes, effect, share, folded, weightsFor };
}

/** Integer ppm weights for one path under a data-driven result (sum ONE_MILLION). */
export const dataDrivenPpm = (r: Extract<DataDrivenResult, { ok: true }>, kinds: readonly string[], apportion: (t: number, w: number[]) => number[]) => apportion(ONE_MILLION, r.weightsFor(kinds));
