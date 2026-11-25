"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.totalsOf = void 0;
exports.weightsOf = weightsOf;
exports.aggregateModel = aggregateModel;
const market_day_1 = require("../campaigns/market-day");
const data_driven_1 = require("./data-driven");
const models_1 = require("./models");
const windows_1 = require("./windows");
function weightsOf(model, path, opts, dd) {
    const touches = path.touches.length ? path.touches : [(0, models_1.UNATTRIBUTED_TOUCH)(path.at)];
    if (model === 'DATA_DRIVEN') {
        if (!dd || !dd.ok)
            throw new Error('DATA_DRIVEN needs an ok data-driven result');
        return path.touches.length ? { touches, ppm: (0, data_driven_1.dataDrivenPpm)(dd, touches.map((t) => t.kind), models_1.apportion) } : { touches, ppm: [models_1.ONE_MILLION] };
    }
    return { touches, ppm: (0, models_1.creditPath)(model, touches, path.at, opts) };
}
function aggregateModel(model, paths, zone, opts = models_1.DEFAULT_MODEL_OPTIONS, windows = windows_1.DEFAULT_WINDOWS, dd) {
    const out = new Map();
    for (const p of paths) {
        const { touches, ppm } = weightsOf(model, p, opts, dd);
        const rev = (0, models_1.apportion)(Math.max(0, p.revenueMinor), ppm);
        const day = (0, market_day_1.localDay)(p.at, zone);
        const seen = new Set();
        touches.forEach((t, i) => {
            if (ppm[i] <= 0)
                return;
            const key = `${day}|${t.kind}|${t.ref}|${t.campaignId}`;
            let r = out.get(key);
            if (!r)
                out.set(key, (r = { day, model, sourceKind: t.kind, sourceRef: t.ref, campaignId: t.campaignId, conversionsPpm: 0, revenueMinor: 0, paths: 0, windowDays: (0, windows_1.windowDaysFor)(t.kind, windows) }));
            r.conversionsPpm += ppm[i];
            r.revenueMinor += rev[i];
            if (!seen.has(key)) {
                seen.add(key);
                r.paths += 1;
            }
        });
    }
    return [...out.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.sourceKind < b.sourceKind ? -1 : a.sourceKind > b.sourceKind ? 1 : a.sourceRef < b.sourceRef ? -1 : a.sourceRef > b.sourceRef ? 1 : a.campaignId < b.campaignId ? -1 : 1));
}
const totalsOf = (rows) => ({ conversionsPpm: rows.reduce((s, r) => s + r.conversionsPpm, 0), revenueMinor: rows.reduce((s, r) => s + r.revenueMinor, 0) });
exports.totalsOf = totalsOf;
//# sourceMappingURL=aggregate.js.map