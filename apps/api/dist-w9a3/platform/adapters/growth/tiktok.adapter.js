"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tiktokSpec = void 0;
const real_adapter_1 = require("./real-adapter");
exports.tiktokSpec = {
    kind: 'tiktok', api: 'report/integrated/get', host: 'business-api.tiktok.com', pulls: ['spend', 'performance'],
    build: (r, secret, _w, account) => ({ url: `https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/?advertiser_id=${encodeURIComponent(account)}&report_type=BASIC&data_level=AUCTION_CAMPAIGN&dimensions=${encodeURIComponent('["campaign_id","stat_time_day"]')}&metrics=${encodeURIComponent('["spend","impressions","clicks"]')}&start_date=${r.from}&end_date=${r.to}`, method: 'GET', headers: { 'access-token': secret } }),
    parse: (json, what, r) => {
        const out = [];
        for (const row of (0, real_adapter_1.arr)((0, real_adapter_1.obj)((0, real_adapter_1.obj)(json).data).list ?? [])) {
            const o = (0, real_adapter_1.obj)(row);
            const d = (0, real_adapter_1.obj)(o.dimensions);
            const m = (0, real_adapter_1.obj)(o.metrics);
            const key = (0, real_adapter_1.str)(d.campaign_id);
            const day = (0, real_adapter_1.str)(d.stat_time_day).slice(0, 10);
            if (what === 'spend')
                out.push({ day, dimensionKey: key, metric: 'spend_minor', value: Math.round((0, real_adapter_1.num)(m.spend) * 100), currency: r.currency ?? 'EGP' });
            else
                out.push({ day, dimensionKey: key, metric: 'impressions', value: (0, real_adapter_1.num)(m.impressions) }, { day, dimensionKey: key, metric: 'clicks', value: (0, real_adapter_1.num)(m.clicks) });
        }
        return out;
    },
};
//# sourceMappingURL=tiktok.adapter.js.map