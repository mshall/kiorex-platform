import { ANCHOR_KINDS, CROSS_LINK_KINDS, candidatesFor, type AnchorKind, type Candidate, type GraphNode, type LinkRuleId } from './link-rules';
import { parentKey } from './page-model';

export interface LinkEdge { fromKey: string; toKey: string; rule: LinkRuleId; anchorKind: AnchorKind; rank: number }
export interface GraphOptions { maxPerPage: number; maxPerAnchorKind: number; topDoctors: number; clinicDoctors: number; related: Record<string, string[]> }
export interface GraphResult {
  edges: LinkEdge[];
  /** candidates dropped and why: the ops tab shows the counts */
  dropped: { notLinkable: number; duplicate: number; capKind: number; capPage: number };
}

/**
 * The internal link graph (GRW-P3-F): deterministic (same input, same output, same order), capped (at most `maxPerPage` links per page, at most `maxPerAnchorKind` of each CROSS-LINK role),
 * with links only to pages that pass the guard and the quality gate and never to the page itself. Stable ordering: strongest rule first, then rank, then the target key, so a nightly recompute
 * that finds nothing new produces byte-identical rows and no cache churn.
 */
export function buildLinkGraph(nodes: readonly GraphNode[], o: GraphOptions): GraphResult {
  const all = new Map(nodes.map((n) => [n.key, n]));
  const edges: LinkEdge[] = []; const dropped = { notLinkable: 0, duplicate: 0, capKind: 0, capPage: 0 };
  const order = [...nodes].sort((a, b) => (a.key < b.key ? -1 : 1));
  for (const n of order) {
    if (!n.linkable) continue; // a page that is not indexable shows no computed navigation (it is not part of the graph)
    const seen = new Set<string>(); const perKind = new Map<AnchorKind, number>(); let total = 0;
    const cands: Candidate[] = candidatesFor(n, all, { topDoctors: o.topDoctors, clinicDoctors: o.clinicDoctors, related: o.related })
      .sort((a, b) => ANCHOR_KINDS.indexOf(a.kind) - ANCHOR_KINDS.indexOf(b.kind) || a.rank - b.rank || (a.to < b.to ? -1 : 1));
    for (const c of cands) {
      const t = all.get(c.to);
      if (!t || !t.linkable) { dropped.notLinkable++; continue; }
      if (seen.has(c.to)) { dropped.duplicate++; continue; }
      if (CROSS_LINK_KINDS.includes(c.kind) && (perKind.get(c.kind) ?? 0) >= o.maxPerAnchorKind) { dropped.capKind++; continue; }
      if (total >= o.maxPerPage) { dropped.capPage++; continue; }
      seen.add(c.to); perKind.set(c.kind, (perKind.get(c.kind) ?? 0) + 1); total++;
      edges.push({ fromKey: c.from, toKey: c.to, rule: c.rule, anchorKind: c.kind, rank: c.rank });
    }
  }
  return { edges, dropped };
}

/** Pages (other than home) that no linking page points to. `inbound` = every internal href found in the rendered HTML of the indexable pages, as page keys (computed links included once built). */
export function findOrphans(nodes: readonly GraphNode[], inbound: ReadonlyMap<string, number>): string[] {
  return nodes.filter((n) => n.linkable && n.type !== 'home' && !(inbound.get(n.key) ?? 0)).map((n) => n.key).sort();
}

/**
 * Orphan repair: the parent page (or the home page) links to an orphan with the ORPHAN_FIX role. It is counted against the page total but not against the cross-link cap of three,
 * and it is skipped when the parent is itself not linkable or already at the page cap. Returns the extra edges (never touches the existing ones).
 */
export function fixOrphans(orphans: readonly string[], nodes: readonly GraphNode[], existing: readonly LinkEdge[], o: Pick<GraphOptions, 'maxPerPage'>): LinkEdge[] {
  const all = new Map(nodes.map((n) => [n.key, n])); const count = new Map<string, number>();
  for (const e of existing) count.set(e.fromKey, (count.get(e.fromKey) ?? 0) + 1);
  const out: LinkEdge[] = [];
  for (const k of orphans) {
    const parent = [parentKey(k), 'home:'].find((p): p is string => !!p && !!all.get(p)?.linkable);
    if (!parent || (count.get(parent) ?? 0) >= o.maxPerPage) continue;
    if (existing.some((e) => e.fromKey === parent && e.toKey === k)) continue;
    out.push({ fromKey: parent, toKey: k, rule: 'ORPHAN_FIX', anchorKind: 'ORPHAN_FIX', rank: 900 });
    count.set(parent, (count.get(parent) ?? 0) + 1);
  }
  return out;
}

/** No keyword stuffing: on a page with more than ten links, the share of DISTINCT anchor texts must reach `minVariety`; later repeats of an anchor are the ones dropped. */
export function enforceAnchorVariety(edges: readonly LinkEdge[], anchorOf: (toKey: string) => string, minVariety: number): { kept: LinkEdge[]; dropped: LinkEdge[] } {
  const byFrom = new Map<string, LinkEdge[]>();
  for (const e of edges) byFrom.set(e.fromKey, [...(byFrom.get(e.fromKey) ?? []), e]);
  const kept: LinkEdge[] = []; const dropped: LinkEdge[] = [];
  for (const [, list] of byFrom) {
    if (list.length <= 10) { kept.push(...list); continue; }
    const distinct = new Set(list.map((e) => anchorOf(e.toKey).trim().toLowerCase())).size;
    if (distinct / list.length >= minVariety) { kept.push(...list); continue; }
    const seen = new Map<string, number>();
    for (const e of list) { const a = anchorOf(e.toKey).trim().toLowerCase(); const n = (seen.get(a) ?? 0) + 1; seen.set(a, n); (n > 1 ? dropped : kept).push(e); }
  }
  return { kept, dropped };
}
