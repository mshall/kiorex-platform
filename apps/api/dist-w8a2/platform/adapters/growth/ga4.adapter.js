"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ga4Spec = void 0;
const real_adapter_1 = require("./real-adapter");
exports.ga4Spec = {
    kind: 'ga4', api: 'properties.runReport', host: 'analyticsdata.googleapis.com', pulls: ['performance'],
    build: (r, secret, _w, account) => ({ url: `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(account)}:runReport`, method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify({ dateRanges: [{ startDate: r.from, endDate: r.to }], dimensions: [{ name: 'date' }, { name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }, { name: 'conversions' }] }) }),
    parse: (json) => {
        const out = [];
        for (const row of (0, real_adapter_1.arr)((0, real_adapter_1.obj)(json).rows ?? [])) {
            const o = (0, real_adapter_1.obj)(row);
            const dv = (0, real_adapter_1.arr)(o.dimensionValues);
            const mv = (0, real_adapter_1.arr)(o.metricValues);
            const d = (0, real_adapter_1.str)((0, real_adapter_1.obj)(dv[0]).value);
            const day = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
            const ch = `channel:${(0, real_adapter_1.str)((0, real_adapter_1.obj)(dv[1]).value).toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
            out.push({ day, dimensionKey: ch, metric: 'sessions', value: (0, real_adapter_1.num)((0, real_adapter_1.obj)(mv[0]).value) }, { day, dimensionKey: ch, metric: 'conversions', value: (0, real_adapter_1.num)((0, real_adapter_1.obj)(mv[1]).value) });
        }
        return out;
    },
};
//# sourceMappingURL=ga4.adapter.js.map