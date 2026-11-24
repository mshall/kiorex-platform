"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.metaAdsSpec = void 0;
const real_adapter_1 = require("./real-adapter");
exports.metaAdsSpec = {
    kind: 'metaads', api: 'act_{id}/insights', host: 'graph.facebook.com', pulls: ['spend', 'performance'],
    build: (r, secret, _w, account) => ({ url: `https://graph.facebook.com/v20.0/act_${encodeURIComponent(account)}/insights?level=campaign&time_increment=1&fields=campaign_name,spend,impressions,clicks&time_range=${encodeURIComponent(JSON.stringify({ since: r.from, until: r.to }))}`, method: 'GET', headers: { authorization: `Bearer ${secret}` } }),
    parse: (json, what, r) => {
        const out = [];
        for (const row of (0, real_adapter_1.arr)((0, real_adapter_1.obj)(json).data ?? [])) {
            const o = (0, real_adapter_1.obj)(row);
            const key = (0, real_adapter_1.str)(o.campaign_name);
            const day = (0, real_adapter_1.str)(o.date_start);
            if (what === 'spend')
                out.push({ day, dimensionKey: key, metric: 'spend_minor', value: Math.round((0, real_adapter_1.num)(o.spend) * 100), currency: r.currency ?? 'EGP' });
            else
                out.push({ day, dimensionKey: key, metric: 'impressions', value: (0, real_adapter_1.num)(o.impressions) }, { day, dimensionKey: key, metric: 'clicks', value: (0, real_adapter_1.num)(o.clicks) });
        }
        return out;
    },
};
//# sourceMappingURL=metaads.adapter.js.map