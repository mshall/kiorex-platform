"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchConsoleSpec = exports.templateOf = void 0;
const real_adapter_1 = require("./real-adapter");
const templateOf = (url) => {
    const p = (() => { try {
        return new URL(url).pathname;
    }
    catch {
        return url;
    } })();
    if (/\/(doctors?|drs?|أطباء)(\/|$)/i.test(p))
        return 'template:doctor';
    if (/\/(clinics?|عيادات)(\/|$)/i.test(p))
        return 'template:clinic';
    if (/\/(find|search|listing|تخصص)/i.test(p))
        return 'template:listing';
    if (/\/(lab|pharmac)/i.test(p))
        return 'template:partner';
    return 'template:other';
};
exports.templateOf = templateOf;
exports.searchConsoleSpec = {
    kind: 'searchconsole', api: 'searchAnalytics.query', host: 'searchconsole.googleapis.com', pulls: ['performance'],
    build: (r, secret, _w, account) => ({ url: `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(account)}/searchAnalytics/query`, method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify({ startDate: r.from, endDate: r.to, dimensions: ['date', 'page'], rowLimit: 5000 }) }),
    parse: (json) => {
        const acc = new Map();
        for (const row of (0, real_adapter_1.arr)((0, real_adapter_1.obj)(json).rows ?? [])) {
            const o = (0, real_adapter_1.obj)(row);
            const keys = (0, real_adapter_1.arr)(o.keys);
            const day = (0, real_adapter_1.str)(keys[0]);
            const t = (0, exports.templateOf)((0, real_adapter_1.str)(keys[1]));
            for (const [m, v] of [['clicks', o.clicks], ['impressions', o.impressions]])
                acc.set(`${day}|${t}|${m}`, (acc.get(`${day}|${t}|${m}`) ?? 0) + (0, real_adapter_1.num)(v));
        }
        return [...acc].map(([k, value]) => { const [day, dimensionKey, metric] = k.split('|'); return { day, dimensionKey, metric, value }; });
    },
};
//# sourceMappingURL=searchconsole.adapter.js.map