"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.googleAdsSpec = void 0;
const real_adapter_1 = require("./real-adapter");
const q = (r) => `SELECT campaign.name, segments.date, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions FROM campaign WHERE segments.date BETWEEN '${r.from}' AND '${r.to}'`;
exports.googleAdsSpec = {
    kind: 'googleads', api: 'GoogleAdsService.SearchStream', host: 'googleads.googleapis.com', pulls: ['spend', 'performance'],
    build: (r, secret, _w, account) => ({ url: `https://googleads.googleapis.com/v17/customers/${encodeURIComponent(account)}/googleAds:searchStream`, method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify({ query: q(r) }) }),
    parse: (json, what, r) => {
        const out = [];
        for (const chunk of (0, real_adapter_1.arr)(json))
            for (const res of (0, real_adapter_1.arr)((0, real_adapter_1.obj)(chunk).results)) {
                const o = (0, real_adapter_1.obj)(res);
                const key = (0, real_adapter_1.str)((0, real_adapter_1.obj)(o.campaign).name);
                const day = (0, real_adapter_1.str)((0, real_adapter_1.obj)(o.segments).date);
                const m = (0, real_adapter_1.obj)(o.metrics);
                if (what === 'spend')
                    out.push({ day, dimensionKey: key, metric: 'spend_minor', value: Math.round((0, real_adapter_1.num)(m.costMicros) / 10_000), currency: r.currency ?? 'EGP' });
                else
                    for (const [k, v] of [['clicks', m.clicks], ['impressions', m.impressions], ['conversions', m.conversions]])
                        out.push({ day, dimensionKey: key, metric: k, value: (0, real_adapter_1.num)(v ?? 0) });
            }
        return out;
    },
};
//# sourceMappingURL=googleads.adapter.js.map