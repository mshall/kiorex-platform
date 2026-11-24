import { arr, num, obj, str, type RealSpec } from './real-adapter';

/** Page path to template group. Only the template leaves this function, never the path (a path can carry a provider slug). */
export const templateOf = (url: string): string => {
  const p = (() => { try { return new URL(url).pathname; } catch { return url; } })();
  if (/\/(doctors?|drs?|أطباء)(\/|$)/i.test(p)) return 'template:doctor';
  if (/\/(clinics?|عيادات)(\/|$)/i.test(p)) return 'template:clinic';
  if (/\/(find|search|listing|تخصص)/i.test(p)) return 'template:listing';
  if (/\/(lab|pharmac)/i.test(p)) return 'template:partner';
  return 'template:other';
};
/** Search Console Search Analytics query (VERIFY AT BUILD). In only: clicks and impressions by day and template. Query strings are not requested. */
export const searchConsoleSpec: RealSpec = {
  kind: 'searchconsole', api: 'searchAnalytics.query', host: 'searchconsole.googleapis.com', pulls: ['performance'],
  build: (r, secret, _w, account) => ({ url: `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(account)}/searchAnalytics/query`, method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify({ startDate: r.from, endDate: r.to, dimensions: ['date', 'page'], rowLimit: 5000 }) }),
  parse: (json) => {
    const acc = new Map<string, number>();
    for (const row of arr(obj(json).rows ?? [])) {
      const o = obj(row); const keys = arr(o.keys); const day = str(keys[0]); const t = templateOf(str(keys[1]));
      for (const [m, v] of [['clicks', o.clicks], ['impressions', o.impressions]] as const) acc.set(`${day}|${t}|${m}`, (acc.get(`${day}|${t}|${m}`) ?? 0) + num(v));
    }
    return [...acc].map(([k, value]) => { const [day, dimensionKey, metric] = k.split('|') as [string, string, string]; return { day, dimensionKey, metric, value }; });
  },
};
