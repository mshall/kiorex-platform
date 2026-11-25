"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LAB_PAGE_TEMPLATE = exports.VITAL_METRICS = void 0;
exports.percentile75 = percentile75;
exports.parseLighthouseSummary = parseLighthouseSummary;
exports.parseCruxRows = parseCruxRows;
exports.breaches = breaches;
exports.VITAL_METRICS = ['lcp_ms', 'inp_ms', 'cls', 'tbt_ms', 'perf_score'];
exports.LAB_PAGE_TEMPLATE = { home: 'home', 'specialty-hub': 'hub', 'city-hub': 'city-hub', doctor: 'doctor', clinic: 'clinic' };
function percentile75(values) {
    const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    if (!v.length)
        return null;
    return v[Math.max(0, Math.ceil(0.75 * v.length) - 1)];
}
function parseLighthouseSummary(json) {
    if (!Array.isArray(json))
        return [];
    const by = new Map();
    for (const r of json) {
        if (!r || typeof r !== 'object' || r.factor !== 'mobile')
            continue;
        const t = exports.LAB_PAGE_TEMPLATE[String(r.page)];
        if (!t)
            continue;
        const cell = by.get(t) ?? { lcp_ms: [], inp_ms: [], cls: [], tbt_ms: [], perf_score: [] };
        for (const [m, v] of [['lcp_ms', r.lcp], ['cls', r.cls], ['tbt_ms', r.tbt], ['inp_ms', r.inp], ['perf_score', r.perf]])
            if (typeof v === 'number' && Number.isFinite(v))
                cell[m].push(v);
        by.set(t, cell);
    }
    const out = [];
    for (const [t, cell] of [...by].sort(([a], [b]) => (a < b ? -1 : 1)))
        for (const m of exports.VITAL_METRICS) {
            const p = m === 'perf_score' ? (cell[m].length ? Math.min(...cell[m]) : null) : percentile75(cell[m]);
            if (p !== null)
                out.push({ templateKind: t, metric: m, p75: Math.round(p * 1000) / 1000, source: 'LAB', sampleSize: cell[m].length });
        }
    return out;
}
function parseCruxRows(rows, sampleSize = 0) {
    const out = [];
    for (const r of rows) {
        const t = /^template:([a-z-]+)$/.exec(r.dimensionKey)?.[1];
        if (!t || !Number.isFinite(r.value))
            continue;
        const m = r.metric === 'lcp_p75' ? 'lcp_ms' : r.metric === 'inp_p75' ? 'inp_ms' : r.metric === 'cls_p75' ? 'cls' : null;
        if (!m)
            continue;
        out.push({ templateKind: t, metric: m, p75: m === 'cls' ? Math.round(r.value) / 100 : r.value, source: 'FIELD', sampleSize });
    }
    return out;
}
function breaches(points, b) {
    const limit = { lcp_ms: b.lcpMs, inp_ms: b.inpMs, cls: b.cls, tbt_ms: b.tbtMs, perf_score: b.perfScore };
    return points.filter((p) => (p.metric === 'perf_score' ? p.p75 < limit.perf_score : p.p75 > limit[p.metric]) && !(p.source === 'FIELD' && p.metric === 'tbt_ms'))
        .map((p) => ({ templateKind: p.templateKind, metric: p.metric, source: p.source, value: p.p75, budget: limit[p.metric] }));
}
//# sourceMappingURL=vitals.js.map