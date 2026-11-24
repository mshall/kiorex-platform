"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildLinkGraph = buildLinkGraph;
exports.findOrphans = findOrphans;
exports.fixOrphans = fixOrphans;
exports.enforceAnchorVariety = enforceAnchorVariety;
const link_rules_1 = require("./link-rules");
const page_model_1 = require("./page-model");
function buildLinkGraph(nodes, o) {
    const all = new Map(nodes.map((n) => [n.key, n]));
    const edges = [];
    const dropped = { notLinkable: 0, duplicate: 0, capKind: 0, capPage: 0 };
    const order = [...nodes].sort((a, b) => (a.key < b.key ? -1 : 1));
    for (const n of order) {
        if (!n.linkable)
            continue;
        const seen = new Set();
        const perKind = new Map();
        let total = 0;
        const cands = (0, link_rules_1.candidatesFor)(n, all, { topDoctors: o.topDoctors, clinicDoctors: o.clinicDoctors, related: o.related })
            .sort((a, b) => link_rules_1.ANCHOR_KINDS.indexOf(a.kind) - link_rules_1.ANCHOR_KINDS.indexOf(b.kind) || a.rank - b.rank || (a.to < b.to ? -1 : 1));
        for (const c of cands) {
            const t = all.get(c.to);
            if (!t || !t.linkable) {
                dropped.notLinkable++;
                continue;
            }
            if (seen.has(c.to)) {
                dropped.duplicate++;
                continue;
            }
            if (link_rules_1.CROSS_LINK_KINDS.includes(c.kind) && (perKind.get(c.kind) ?? 0) >= o.maxPerAnchorKind) {
                dropped.capKind++;
                continue;
            }
            if (total >= o.maxPerPage) {
                dropped.capPage++;
                continue;
            }
            seen.add(c.to);
            perKind.set(c.kind, (perKind.get(c.kind) ?? 0) + 1);
            total++;
            edges.push({ fromKey: c.from, toKey: c.to, rule: c.rule, anchorKind: c.kind, rank: c.rank });
        }
    }
    return { edges, dropped };
}
function findOrphans(nodes, inbound) {
    return nodes.filter((n) => n.linkable && n.type !== 'home' && !(inbound.get(n.key) ?? 0)).map((n) => n.key).sort();
}
function fixOrphans(orphans, nodes, existing, o) {
    const all = new Map(nodes.map((n) => [n.key, n]));
    const count = new Map();
    for (const e of existing)
        count.set(e.fromKey, (count.get(e.fromKey) ?? 0) + 1);
    const out = [];
    for (const k of orphans) {
        const parent = [(0, page_model_1.parentKey)(k), 'home:'].find((p) => !!p && !!all.get(p)?.linkable);
        if (!parent || (count.get(parent) ?? 0) >= o.maxPerPage)
            continue;
        if (existing.some((e) => e.fromKey === parent && e.toKey === k))
            continue;
        out.push({ fromKey: parent, toKey: k, rule: 'ORPHAN_FIX', anchorKind: 'ORPHAN_FIX', rank: 900 });
        count.set(parent, (count.get(parent) ?? 0) + 1);
    }
    return out;
}
function enforceAnchorVariety(edges, anchorOf, minVariety) {
    const byFrom = new Map();
    for (const e of edges)
        byFrom.set(e.fromKey, [...(byFrom.get(e.fromKey) ?? []), e]);
    const kept = [];
    const dropped = [];
    for (const [, list] of byFrom) {
        if (list.length <= 10) {
            kept.push(...list);
            continue;
        }
        const distinct = new Set(list.map((e) => anchorOf(e.toKey).trim().toLowerCase())).size;
        if (distinct / list.length >= minVariety) {
            kept.push(...list);
            continue;
        }
        const seen = new Map();
        for (const e of list) {
            const a = anchorOf(e.toKey).trim().toLowerCase();
            const n = (seen.get(a) ?? 0) + 1;
            seen.set(a, n);
            (n > 1 ? dropped : kept).push(e);
        }
    }
    return { kept, dropped };
}
//# sourceMappingURL=link-graph.js.map