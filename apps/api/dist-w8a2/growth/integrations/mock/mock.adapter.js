"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PULLS = exports.mockFor = exports.MockGrowthAdapter = exports.daysOf = exports.synth = void 0;
const node_crypto_1 = require("node:crypto");
const port_1 = require("../port");
Object.defineProperty(exports, "PULLS", { enumerable: true, get: function () { return port_1.PULLS; } });
const synth = (seed, lo, hi) => lo + ((0, node_crypto_1.createHash)('sha256').update(seed).digest().readUInt32BE(0) % (hi - lo + 1));
exports.synth = synth;
const daysOf = (r) => {
    const out = [];
    const end = Date.parse(`${r.to}T00:00:00Z`);
    for (let t = Date.parse(`${r.from}T00:00:00Z`); t <= end && out.length < 400; t += 86_400_000)
        out.push(new Date(t).toISOString().slice(0, 10));
    return out;
};
exports.daysOf = daysOf;
const TEMPLATES = ['template:doctor', 'template:clinic', 'template:listing', 'template:other'];
const CHANNELS = ['channel:organic_search', 'channel:direct', 'channel:paid_search', 'channel:referral'];
const CATEGORIES = ['category:marketing', 'category:utility', 'category:authentication', 'category:service'];
const campaignRows = (what) => (kind, r) => (0, exports.daysOf)(r).flatMap((day) => (r.dimensionKeys ?? []).flatMap((key) => {
    const s = `${kind}|${day}|${key}`;
    const imp = (0, exports.synth)(`${s}|imp`, 800, 9000);
    const clicks = Math.max(1, Math.floor(imp * (0, exports.synth)(`${s}|ctr`, 15, 60) / 1000));
    const cpc = (0, exports.synth)(`${s}|cpc`, 300, 1500);
    return what === 'spend'
        ? [{ day, dimensionKey: key, metric: 'spend_minor', value: clicks * cpc, currency: r.currency ?? 'EGP' }]
        : [{ day, dimensionKey: key, metric: 'impressions', value: imp }, { day, dimensionKey: key, metric: 'clicks', value: clicks }, { day, dimensionKey: key, metric: 'conversions', value: Math.floor(clicks * (0, exports.synth)(`${s}|cvr`, 20, 90) / 1000) }];
}));
const dimRows = (dims, metrics) => (kind, r) => (0, exports.daysOf)(r).flatMap((day) => dims.flatMap((d) => metrics.map(([m, lo, hi]) => ({ day, dimensionKey: d, metric: m, value: (0, exports.synth)(`${kind}|${day}|${d}|${m}`, lo, hi) }))));
const GEN = {
    googleads: { spend: campaignRows('spend'), performance: campaignRows('performance') },
    metaads: { spend: campaignRows('spend'), performance: campaignRows('performance') },
    tiktok: { spend: campaignRows('spend'), performance: campaignRows('performance') },
    searchconsole: { performance: dimRows(TEMPLATES, [['impressions', 400, 6000], ['clicks', 20, 400]]) },
    ga4: { performance: dimRows(CHANNELS, [['sessions', 50, 900], ['conversions', 2, 60]]) },
    playconsole: { performance: dimRows(['country:EG'], [['store_listing_views', 200, 1500], ['installs', 15, 140], ['uninstalls', 2, 30], ['crash_rate_bp', 5, 90]]) },
    appstoreconnect: { performance: dimRows(['country:EG'], [['impressions', 500, 4000], ['product_page_views', 80, 700], ['downloads', 8, 90]]) },
    whatsappcloud: { performance: dimRows(CATEGORIES, [['conversations', 5, 220], ['cost_micros', 0, 40_000_000]]) },
    fcmapns: { performance: dimRows(['platform:android', 'platform:ios'], [['push_accepted', 100, 2500], ['push_unregistered', 0, 40], ['push_failed', 0, 25]]) },
    crux: { coreVitals: dimRows(['template:doctor', 'template:clinic', 'template:all'], [['lcp_p75', 1800, 3200], ['inp_p75', 90, 280], ['cls_p75', 2, 14]]) },
};
class MockGrowthAdapter {
    kind;
    opts;
    mode = 'mock';
    constructor(kind, opts = {}) {
        this.kind = kind;
        this.opts = opts;
    }
    async health() { if (this.opts.failWith)
        throw this.opts.failWith; return { ok: true, mode: 'mock', detail: 'synthetic series, no network' }; }
    async run(what, r) {
        if (this.opts.failWith)
            throw this.opts.failWith;
        return GEN[this.kind][what]?.(this.kind, r, what) ?? [];
    }
    pullSpend(r) { return this.run('spend', r); }
    pullPerformance(r) { return this.run('performance', r); }
    pullCoreVitals(r) { return this.run('coreVitals', r); }
    async pushConversion() { return { accepted: false }; }
}
exports.MockGrowthAdapter = MockGrowthAdapter;
const mockFor = (kind, opts) => new MockGrowthAdapter(kind, opts);
exports.mockFor = mockFor;
//# sourceMappingURL=mock.adapter.js.map