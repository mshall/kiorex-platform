"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cruxSpec = void 0;
const real_adapter_1 = require("./real-adapter");
const P75 = (m) => (0, real_adapter_1.num)((0, real_adapter_1.obj)((0, real_adapter_1.obj)(m).percentiles).p75);
exports.cruxSpec = {
    kind: 'crux', api: 'records:queryRecord', host: 'chromeuxreport.googleapis.com', pulls: ['coreVitals'],
    build: (_r, secret, _w, account) => ({ url: `https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${encodeURIComponent(secret)}`, method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ origin: account, formFactor: 'PHONE' }) }),
    parse: (json, _w, r) => {
        const m = (0, real_adapter_1.obj)((0, real_adapter_1.obj)((0, real_adapter_1.obj)(json).record).metrics);
        return [['lcp_p75', m.largest_contentful_paint], ['inp_p75', m.interaction_to_next_paint], ['cls_p75', m.cumulative_layout_shift]].map(([metric, v]) => ({ day: r.to, dimensionKey: 'template:all', metric: metric, value: P75(v) }));
    },
};
//# sourceMappingURL=crux.adapter.js.map