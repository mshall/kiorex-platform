import { arr, num, obj, str, type RealSpec } from './real-adapter';

/** TikTok Marketing API integrated report (VERIFY AT BUILD). Events API upload is not implemented. */
export const tiktokSpec: RealSpec = {
  kind: 'tiktok', api: 'report/integrated/get', host: 'business-api.tiktok.com', pulls: ['spend', 'performance'],
  build: (r, secret, _w, account) => ({ url: `https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/?advertiser_id=${encodeURIComponent(account)}&report_type=BASIC&data_level=AUCTION_CAMPAIGN&dimensions=${encodeURIComponent('["campaign_id","stat_time_day"]')}&metrics=${encodeURIComponent('["spend","impressions","clicks"]')}&start_date=${r.from}&end_date=${r.to}`, method: 'GET', headers: { 'access-token': secret } }),
  parse: (json, what, r) => {
    const out = [];
    for (const row of arr(obj(obj(json).data).list ?? [])) {
      const o = obj(row); const d = obj(o.dimensions); const m = obj(o.metrics); const key = str(d.campaign_id); const day = str(d.stat_time_day).slice(0, 10);
      if (what === 'spend') out.push({ day, dimensionKey: key, metric: 'spend_minor', value: Math.round(num(m.spend) * 100), currency: r.currency ?? 'EGP' });
      else out.push({ day, dimensionKey: key, metric: 'impressions', value: num(m.impressions) }, { day, dimensionKey: key, metric: 'clicks', value: num(m.clicks) });
    }
    return out;
  },
};
