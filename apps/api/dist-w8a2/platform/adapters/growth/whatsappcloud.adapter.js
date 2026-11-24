"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.whatsappCloudSpec = void 0;
const real_adapter_1 = require("./real-adapter");
exports.whatsappCloudSpec = {
    kind: 'whatsappcloud', api: '{waba}?fields=conversation_analytics', host: 'graph.facebook.com', pulls: ['performance'],
    build: (r, secret, _w, account) => {
        const ts = (d) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 1000);
        return { url: `https://graph.facebook.com/v20.0/${encodeURIComponent(account)}?fields=${encodeURIComponent(`conversation_analytics.start(${ts(r.from)}).end(${ts(r.to) + 86_399}).granularity(DAILY).dimensions(["CONVERSATION_CATEGORY"])`)}`, method: 'GET', headers: { authorization: `Bearer ${secret}` } };
    },
    parse: (json) => {
        const out = [];
        for (const blk of (0, real_adapter_1.arr)((0, real_adapter_1.obj)((0, real_adapter_1.obj)(json).conversation_analytics).data ?? []))
            for (const dp of (0, real_adapter_1.arr)((0, real_adapter_1.obj)(blk).data_points ?? [])) {
                const o = (0, real_adapter_1.obj)(dp);
                const day = new Date((0, real_adapter_1.num)(o.start) * 1000).toISOString().slice(0, 10);
                const cat = `category:${(0, real_adapter_1.str)(o.conversation_category).toLowerCase()}`;
                out.push({ day, dimensionKey: cat, metric: 'conversations', value: (0, real_adapter_1.num)(o.conversation) }, { day, dimensionKey: cat, metric: 'cost_micros', value: Math.round((0, real_adapter_1.num)(o.cost) * 1_000_000) });
            }
        return out;
    },
};
//# sourceMappingURL=whatsappcloud.adapter.js.map