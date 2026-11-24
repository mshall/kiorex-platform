import { arr, num, obj, str, type RealSpec } from './real-adapter';

/** Meta Marketing API insights (VERIFY AT BUILD). Spend arrives in major units of the account currency and is stored in minor units. Conversions API upload is not implemented. */
export const metaAdsSpec: RealSpec = {
  kind: 'metaads', api: 'act_{id}/insights', host: 'graph.facebook.com', pulls: ['spend', 'performance'],
  build: (r, secret, _w, account) => ({ url: `https://graph.facebook.com/v20.0/act_${encodeURIComponent(account)}/insights?level=campaign&time_increment=1&fields=campaign_name,spend,impressions,clicks&time_range=${encodeURIComponent(JSON.stringify({ since: r.from, until: r.to }))}`, method: 'GET', headers: { authorization: `Bearer ${secret}` } }),
  parse: (json, what, r) => {
    const out = [];
    for (const row of arr(obj(json).data ?? [])) {
      const o = obj(row); const key = str(o.campaign_name); const day = str(o.date_start);
      if (what === 'spend') out.push({ day, dimensionKey: key, metric: 'spend_minor', value: Math.round(num(o.spend) * 100), currency: r.currency ?? 'EGP' });
      else out.push({ day, dimensionKey: key, metric: 'impressions', value: num(o.impressions) }, { day, dimensionKey: key, metric: 'clicks', value: num(o.clicks) });
    }
    return out;
  },
};
