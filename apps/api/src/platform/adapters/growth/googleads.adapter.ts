import { arr, num, obj, str, type RealSpec } from './real-adapter';

const q = (r: { from: string; to: string }) => `SELECT campaign.name, segments.date, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions FROM campaign WHERE segments.date BETWEEN '${r.from}' AND '${r.to}'`;
/** Google Ads API reporting `GoogleAdsService.SearchStream` (VERIFY AT BUILD, version pinned at build). Reads cost, clicks, impressions by campaign and day. Conversion upload is not implemented. */
export const googleAdsSpec: RealSpec = {
  kind: 'googleads', api: 'GoogleAdsService.SearchStream', host: 'googleads.googleapis.com', pulls: ['spend', 'performance'],
  build: (r, secret, _w, account) => ({ url: `https://googleads.googleapis.com/v17/customers/${encodeURIComponent(account)}/googleAds:searchStream`, method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify({ query: q(r) }) }),
  parse: (json, what, r) => {
    const out = [];
    for (const chunk of arr(json)) for (const res of arr(obj(chunk).results)) {
      const o = obj(res); const key = str(obj(o.campaign).name); const day = str(obj(o.segments).date); const m = obj(o.metrics);
      if (what === 'spend') out.push({ day, dimensionKey: key, metric: 'spend_minor', value: Math.round(num(m.costMicros) / 10_000), currency: r.currency ?? 'EGP' });
      else for (const [k, v] of [['clicks', m.clicks], ['impressions', m.impressions], ['conversions', m.conversions]] as const) out.push({ day, dimensionKey: key, metric: k, value: num(v ?? 0) });
    }
    return out;
  },
};
