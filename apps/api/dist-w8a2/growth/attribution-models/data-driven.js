"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dataDrivenPpm = exports.DEFAULT_DATA_DRIVEN = void 0;
exports.dataDriven = dataDriven;
const models_1 = require("./models");
exports.DEFAULT_DATA_DRIVEN = { minConversions: 1000, minNodeK: 10 };
const START = '(start)';
const CONV = '(conversion)';
const NULLS = '(null)';
const OTHER = 'OTHER';
function convProbability(nodes, trans, removed) {
    const p = new Map();
    for (const n of nodes)
        p.set(n, 0);
    p.set(START, 0);
    for (let it = 0; it < 400; it++) {
        let delta = 0;
        for (const n of [START, ...nodes]) {
            if (n === removed)
                continue;
            const row = trans.get(n);
            if (!row)
                continue;
            let tot = 0;
            for (const v of row.values())
                tot += v;
            if (tot === 0)
                continue;
            let acc = 0;
            for (const [to, v] of row) {
                const val = to === CONV ? 1 : to === NULLS || to === removed ? 0 : (p.get(to) ?? 0);
                acc += (v / tot) * val;
            }
            delta = Math.max(delta, Math.abs(acc - (p.get(n) ?? 0)));
            p.set(n, acc);
        }
        if (delta < 1e-12)
            break;
    }
    return p.get(START) ?? 0;
}
function dataDriven(converting, nonConverting, cfg = exports.DEFAULT_DATA_DRIVEN) {
    const withTouches = converting.filter((c) => c.touches.length > 0);
    if (converting.length < cfg.minConversions)
        return { ok: false, reason: 'INSUFFICIENT_VOLUME', conversions: converting.length, needed: cfg.minConversions };
    const seen = new Map();
    const bump = (kinds) => { for (const k of new Set(kinds))
        seen.set(k, (seen.get(k) ?? 0) + 1); };
    for (const c of withTouches)
        bump(c.touches.map((t) => t.kind));
    for (const n of nonConverting)
        bump(n.kinds);
    const folded = [...seen].filter(([, n]) => n < cfg.minNodeK).map(([k]) => k).sort();
    const fold = new Set(folded);
    const map = (k) => (fold.has(k) ? OTHER : k);
    const trans = new Map();
    const nodeSet = new Set();
    const add = (a, b) => { let r = trans.get(a); if (!r)
        trans.set(a, (r = new Map())); r.set(b, (r.get(b) ?? 0) + 1); };
    const feed = (kinds, end) => { const ks = kinds.map(map); ks.forEach((k) => nodeSet.add(k)); let prev = START; for (const k of ks) {
        add(prev, k);
        prev = k;
    } add(prev, end); };
    for (const c of withTouches)
        feed(c.touches.map((t) => t.kind), CONV);
    for (const n of nonConverting)
        feed(n.kinds, NULLS);
    const nodes = [...nodeSet].sort();
    if (nodes.length < 2)
        return { ok: false, reason: 'INSUFFICIENT_VOLUME', conversions: converting.length, needed: cfg.minConversions };
    const full = convProbability(nodes, trans, null);
    const effect = {};
    let sum = 0;
    for (const n of nodes) {
        const e = full > 0 ? Math.max(0, 1 - convProbability(nodes, trans, n) / full) : 0;
        effect[n] = e;
        sum += e;
    }
    const share = {};
    for (const n of nodes)
        share[n] = sum > 0 ? effect[n] / sum : 1 / nodes.length;
    const weightsFor = (kinds) => {
        const raw = kinds.map((k) => share[map(k)] ?? 0);
        const counts = new Map();
        for (const k of kinds)
            counts.set(map(k), (counts.get(map(k)) ?? 0) + 1);
        const w = kinds.map((k) => (share[map(k)] ?? 0) / (counts.get(map(k)) ?? 1));
        const tot = w.reduce((a, b) => a + b, 0) || raw.reduce((a, b) => a + b, 0);
        return tot > 0 ? w.map((x) => x / tot) : kinds.map(() => 1 / kinds.length);
    };
    return { ok: true, conversions: converting.length, nodes, effect, share, folded, weightsFor };
}
const dataDrivenPpm = (r, kinds, apportion) => apportion(models_1.ONE_MILLION, r.weightsFor(kinds));
exports.dataDrivenPpm = dataDrivenPpm;
//# sourceMappingURL=data-driven.js.map