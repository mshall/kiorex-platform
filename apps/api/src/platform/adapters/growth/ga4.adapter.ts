import { arr, num, obj, str, type RealSpec } from './real-adapter';

/** GA4 Data API `runReport` (VERIFY AT BUILD). Read-only aggregates: sessions and conversions by day and default channel group. No Measurement Protocol push exists in this code. */
export const ga4Spec: RealSpec = {
  kind: 'ga4', api: 'properties.runReport', host: 'analyticsdata.googleapis.com', pulls: ['performance'],
  build: (r, secret, _w, account) => ({ url: `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(account)}:runReport`, method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify({ dateRanges: [{ startDate: r.from, endDate: r.to }], dimensions: [{ name: 'date' }, { name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }, { name: 'conversions' }] }) }),
  parse: (json) => {
    const out = [];
    for (const row of arr(obj(json).rows ?? [])) {
      const o = obj(row); const dv = arr(o.dimensionValues); const mv = arr(o.metricValues);
      const d = str(obj(dv[0]).value); const day = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`; const ch = `channel:${str(obj(dv[1]).value).toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
      out.push({ day, dimensionKey: ch, metric: 'sessions', value: num(obj(mv[0]).value) }, { day, dimensionKey: ch, metric: 'conversions', value: num(obj(mv[1]).value) });
    }
    return out;
  },
};
