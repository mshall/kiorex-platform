import { awsRegionFromHost, signV4 } from './sigv4';

/**
 * Amazon Location Service geocoding (Places v2). MAPS_PROVIDER=amazon, MAPS_API_URL=https://places.geo.<region>.amazonaws.com,
 * either MAPS_API_KEY (Amazon Location API key, sent as ?key=) or MAPS_ACCESS_KEY_ID/MAPS_SECRET_ACCESS_KEY (SigV4, service `geo-places`).
 *   POST /v2/geocode?key=...  { QueryText, MaxResults:1, BiasPosition?, Filter:{ IncludeCountries:['EGY'] } } -> { ResultItems:[{ Position:[lng,lat], PlaceType, MatchScores }] }
 */
export function amazonGeocodeBody(q: { governorate: string; district: string; street?: string }, country = 'EGY') {
  return { QueryText: [q.street, q.district, q.governorate].filter(Boolean).join(', '), MaxResults: 1, Filter: { IncludeCountries: [country] } };
}
export function parseAmazonGeocode(json: any): { lat: number; lng: number; accuracy: 'DISTRICT' | 'ADDRESS' } | null {
  const it = json?.ResultItems?.[0]; const pos = it?.Position;
  if (!Array.isArray(pos) || typeof pos[0] !== 'number' || typeof pos[1] !== 'number') return null;
  const t = String(it.PlaceType ?? '');
  return { lng: Math.round(pos[0] * 1e5) / 1e5, lat: Math.round(pos[1] * 1e5) / 1e5, accuracy: /Point|Interpolated|Street|Address/i.test(t) ? 'ADDRESS' : 'DISTRICT' };
}
export function amazonSigner(apiUrl: string, accessKeyId: string, secretAccessKey: string) {
  const region = awsRegionFromHost(new URL(apiUrl).host);
  return region ? (r: { method: string; url: string; body: string }) => signV4({ ...r, accessKeyId, secretAccessKey, region, service: 'geo-places', headers: { 'content-type': 'application/json' } }) : undefined;
}
