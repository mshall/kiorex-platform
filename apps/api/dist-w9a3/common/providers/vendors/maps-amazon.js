"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.amazonGeocodeBody = amazonGeocodeBody;
exports.parseAmazonGeocode = parseAmazonGeocode;
exports.amazonSigner = amazonSigner;
const sigv4_1 = require("./sigv4");
function amazonGeocodeBody(q, country = 'EGY') {
    return { QueryText: [q.street, q.district, q.governorate].filter(Boolean).join(', '), MaxResults: 1, Filter: { IncludeCountries: [country] } };
}
function parseAmazonGeocode(json) {
    const it = json?.ResultItems?.[0];
    const pos = it?.Position;
    if (!Array.isArray(pos) || typeof pos[0] !== 'number' || typeof pos[1] !== 'number')
        return null;
    const t = String(it.PlaceType ?? '');
    return { lng: Math.round(pos[0] * 1e5) / 1e5, lat: Math.round(pos[1] * 1e5) / 1e5, accuracy: /Point|Interpolated|Street|Address/i.test(t) ? 'ADDRESS' : 'DISTRICT' };
}
function amazonSigner(apiUrl, accessKeyId, secretAccessKey) {
    const region = (0, sigv4_1.awsRegionFromHost)(new URL(apiUrl).host);
    return region ? (r) => (0, sigv4_1.signV4)({ ...r, accessKeyId, secretAccessKey, region, service: 'geo-places', headers: { 'content-type': 'application/json' } }) : undefined;
}
//# sourceMappingURL=maps-amazon.js.map