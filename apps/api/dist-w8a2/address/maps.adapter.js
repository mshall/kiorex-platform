"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapsAdapter = exports.AmazonMapsAdapter = exports.mapsProblems = exports.UnconfiguredMapsAdapter = exports.MockMapsAdapter = void 0;
const node_crypto_1 = require("node:crypto");
const config_1 = require("../common/config");
const problems_1 = require("../common/providers/problems");
const outbound_http_1 = require("../common/outbound-http");
const maps_amazon_1 = require("../common/providers/vendors/maps-amazon");
class MockMapsAdapter {
    mode = 'mock';
    async geocode(q) {
        const h = (0, node_crypto_1.createHash)('sha1').update(`${q.governorate}|${q.district}`).digest();
        const lat = 29.9 + (h[0] / 255) * 0.25;
        const lng = 31.15 + (h[1] / 255) * 0.35;
        return { lat: Math.round(lat * 1000) / 1000, lng: Math.round(lng * 1000) / 1000, accuracy: 'DISTRICT', provider: 'mock' };
    }
}
exports.MockMapsAdapter = MockMapsAdapter;
class UnconfiguredMapsAdapter {
    mode = 'real';
    async geocode() {
        throw new Error('NEEDS_HUMAN: Amazon Location is not configured (Docs/NEEDS_HUMAN.md, Provider go-live)');
    }
}
exports.UnconfiguredMapsAdapter = UnconfiguredMapsAdapter;
exports.mapsProblems = problems_1.mapsProblems;
class AmazonMapsAdapter {
    env;
    fetchImpl;
    mode = 'real';
    constructor(env = process.env, fetchImpl = outbound_http_1.outboundFetch) {
        this.env = env;
        this.fetchImpl = fetchImpl;
    }
    async geocode(q) {
        const base = (this.env.MAPS_API_URL ?? '').replace(/\/+$/, '');
        const key = this.env.MAPS_API_KEY;
        const url = `${base}/v2/geocode${key ? `?key=${encodeURIComponent(key)}` : ''}`;
        const body = JSON.stringify((0, maps_amazon_1.amazonGeocodeBody)(q, this.env.MAPS_COUNTRY ?? 'EGY'));
        const sign = !key && this.env.MAPS_ACCESS_KEY_ID ? (0, maps_amazon_1.amazonSigner)(base, this.env.MAPS_ACCESS_KEY_ID, this.env.MAPS_SECRET_ACCESS_KEY ?? '') : undefined;
        const res = await this.fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(sign ? sign({ method: 'POST', url, body }) : {}) }, body, signal: AbortSignal.timeout(8000) });
        if (!res.ok)
            throw new Error(`MAPS_PROVIDER_HTTP_${res.status}`);
        const g = (0, maps_amazon_1.parseAmazonGeocode)(await res.json());
        if (!g)
            throw new Error('MAPS_NO_RESULT');
        return { ...g, provider: 'amazon-location' };
    }
}
exports.AmazonMapsAdapter = AmazonMapsAdapter;
const mapsAdapter = () => ((0, config_1.cfg)().mapsMode === 'mock' ? new MockMapsAdapter() : (0, exports.mapsProblems)().length ? new UnconfiguredMapsAdapter() : new AmazonMapsAdapter());
exports.mapsAdapter = mapsAdapter;
//# sourceMappingURL=maps.adapter.js.map